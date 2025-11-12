# Backend entrypoint: `index.js` (GraphQL API)

This file boots the GraphQL API, wires security and CORS, connects MongoDB, mounts the Stripe webhook route, and creates the Apollo context so resolvers know who the user is.

## 1) Imports and setup

```js
require("dotenv").config();
const express = require("express");
const { ApolloServer } = require("apollo-server-express");
const connectDB = require("./config/db");
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const webhookRouter = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 4000;
app.set("trust proxy", 1);
module.exports = app;
```

**What this does and why it matters**

* Loads environment variables early so everything that follows can read `process.env` values like `JWT_SECRET`, DB URI, Stripe keys.
* Creates the Express app and exports it so tests and tooling can import the configured server without opening a port.
* Sets `trust proxy` for deployments behind a proxy or platform load balancer so Express sees the real client IP for rate limiting.

## 2) Database and webhook

```js
connectDB();
app.use("/webhook", webhookRouter);
```

**Why**

* `connectDB()` establishes the MongoDB connection before requests hit resolvers. Your resolvers depend on `User` queries and usage tracking.
* The Stripe webhook route is mounted at `/webhook`. Stripe will call this endpoint with subscription events. Keeping it separate from GraphQL keeps the HTTP signature and raw body handling clean.

## 3) CORS allowlist and header shim

```js
const allowedOrigins = [
  "chrome-extension://bipdnlldaogehgnkegeifojojobendca",
  process.env.CLIENT_URL,
  "http://localhost:3000",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  next();
});
```

**Why**

* Your frontend lives in a few places: the Chrome extension origin, local dev URL, and your deployed client URL. This allowlist keeps CORS strict while still letting your own clients talk to the API.
* The small header shim ensures the right `Access-Control-Allow-Origin` is echoed before the main CORS middleware runs.

## 4) CORS, security headers, rate limiting, body parsing

```js
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json());
app.options("*", cors());
```

**Why**

* CORS middleware performs the formal preflight checks and enforces the allowlist.
* Helmet sets safe defaults for HTTP response headers.
* Rate limiting dampens brute force or abuse from a single IP.
* `express.json()` parses JSON bodies for GraphQL POST requests. You also call `app.options("*", cors())` so browsers can complete preflights cleanly.

## 5) Apollo Server with per request context

```js
const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const token = req.headers.authorization || "";
    if (!token) return { user: null };

    try {
      const decoded = jwt.verify(
        token.replace("Bearer ", ""),
        process.env.JWT_SECRET
      );
      const user = await User.findById(decoded.id);
      return { user };
    } catch (err) {
      console.warn("Token verification failed:", err.message);
      return { user: null };
    }
  },
});
```

**What happens**

* Every GraphQL request gets a `context` object. You extract the Authorization header, verify the JWT with `JWT_SECRET`, and load the user from MongoDB.
* Resolvers read `context.user`. If it is null, they can throw `Unauthorized`.
* This is the same identity that your Whisper server trusts when it calls mutations like `incrementUsage`.

## 6) Start and apply middleware

```js
async function startServer() {
  await server.start();

  server.applyMiddleware({
    app,
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    },
  });

  if (process.env.NODE_ENV === "test") {
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
      console.error("Uncaught Express error:", err.stack || err);
      res.status(500).json({ error: "internal" });
    });
  }

  if (require.main === module) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Listening on 0.0.0.0:${PORT}`);
    });
  }
}

startServer();
```

**Why**

* `server.start()` is required in Apollo Server 3 before applying middleware.
* `applyMiddleware` mounts `/graphql` onto your Express app and repeats the CORS policy at the GraphQL layer. That is useful if you ever mount other routes with different CORS.
* The test-only error handler prints full stack traces to CI logs without exposing internals in production.
* The `require.main` check lets you import `app` in tests without starting a listener. Running `node index.js` does open the port.

## How this ties into the rest of the system

* The Chrome extension and your Whisper server both call GraphQL at `/graphql`.
* The same JWT issued by `login` and `register` is verified in `context`, so resolvers like `getUsageCount`, `incrementUsage`, and `startSubscription` know which user is calling.
* Stripe sends subscription events to `/webhook`. That route updates `subscriptionStatus` so your resolvers can enforce plan logic.


