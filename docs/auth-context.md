# Auth Context - How JWTs become `user` in your backend

This doc explains how your backend authenticates requests using JSON Web Tokens and turns them into a `user` object that resolvers and services can trust.

## File: `auth.js`

```js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const verifyToken = async (token) => {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    return user;
  } catch (err) {
    console.warn("🔒 Invalid or expired token:", err.message);
    return null;
  }
};

module.exports = verifyToken;
```

## What this file does

* Validates a Bearer token from the `Authorization` header.
* Decodes it with your `JWT_SECRET` and pulls the `id` claim.
* Looks up the user document by `_id` in MongoDB.
* Returns the user object if valid, or `null` on any failure.
* Centralizes auth so both GraphQL and the Whisper server can share the same logic.

---

## Where it is used

* **GraphQL server**: in the Apollo `context` function to populate `context.user`. Resolvers that require auth read `context.user`.
* **Whisper server**: before transcribing, to check that the caller is logged in and to get a user id for usage tracking.

---

## Code walkthrough

1. `require("dotenv").config()`
   Loads environment variables into `process.env`. You need `JWT_SECRET` set in `.env`.

2. `const verifyToken = async (token) => { ... }`
   Exposes one function that takes a token string. Returns a `User` document or `null`.

3. `if (!token) return null;`
   Missing token means unauthenticated. Callers should treat this as 401.

4. `jwt.verify(token, process.env.JWT_SECRET)`

* Verifies signature and expiry.
* Throws on invalid secret, tampering, or expiration.

5. `const user = await User.findById(decoded.id)`

* Pulls the MongoDB user document by id stored in the token.
* If a user was deleted or the id is stale, `user` will be `null`.

6. `catch (err) { ... return null; }`

* Any verification or DB error yields `null`.
* A warning is logged for visibility during debugging.

---

## Request lifecycle

```
Client (Extension) 
  -> sends Authorization: Bearer <JWT> 
  -> GraphQL/Whisper receives token 
  -> verifyToken(token) 
      - jwt.verify(..., JWT_SECRET) 
      - User.findById(decoded.id)
  -> returns user or null 
  -> resolvers/handlers allow or reject
```

---

## How to wire it into Apollo Server

**`index.js` (GraphQL)**

```js
const express = require("express");
const { ApolloServer } = require("apollo-server-express");
const verifyToken = require("./auth/auth"); // path to auth.js
const typeDefs = require("./schema/typeDefs");
const resolvers = require("./schema/resolvers");

async function start() {
  const app = express();

  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const header = req.headers.authorization || "";
      // Expect "Bearer <token>"
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      const user = await verifyToken(token);
      return { user, req };
    },
  });

  await apollo.start();
  apollo.applyMiddleware({ app, path: "/graphql" });

  app.listen(process.env.PORT || 4000, () =>
    console.log("GraphQL server ready")
  );
}

start();
```

**Resolver example using `context.user`:**

```js
const resolvers = {
  Query: {
    getUsageCount: async (_, __, { user }) => {
      if (!user) throw new Error("Unauthorized");
      const found = await User.findById(user._id);
      return found?.usageCount || 0;
    },
  },
};
```

---

## How to use it in the Whisper server

You already gate `/transcribe` with a Bearer token. If you want to share the exact same verification logic:

```js
const verifyToken = require("../path/to/auth");

app.post("/transcribe", upload.single("audio"), async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // proceed with usage checks and transcription...
});
```

---

## Security notes

* **Keep `JWT_SECRET` strong and private**. Rotate if you suspect exposure.
* **Set a token expiry** when issuing tokens during login or register. You do this already with `{ expiresIn: "7d" }`.
* **Do not trust the token alone**. Always re-fetch the user. This lets you revoke accounts and reflect role changes.
* **Treat `null` as unauthenticated**. Resolvers should throw `Unauthorized` rather than silently proceed.

---

## Common failure cases

* **Expired token**: `jwt.verify` throws. Caller sees 401 from your resolver or route.
* **User deleted**: token verifies but `User.findById` returns `null`. Treat as 401.
* **Wrong secret**: all tokens fail. Verify `.env` values across environments.
* **Missing header**: clients must send `Authorization: Bearer <JWT>`.

---

## Summary

* `auth.js` is the single place that turns a Bearer token into a trusted `user`.
* Apollo Server passes that `user` into every resolver through `context`.
* The Whisper server can reuse the same function for consistent auth.
* All protected operations should check `if (!user) throw new Error("Unauthorized")`.
