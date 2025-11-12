### Models and core auth libs

```js
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { checkAndResetUsage } = require("../utils/limiter.js");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
```

**What it does**

* `User`: DB model for accounts. Every resolver that authenticates, checks usage, or updates subscription state will touch this.
* `jsonwebtoken`: signs and verifies JWTs. This is how the GraphQL context knows which user is calling a resolver.
* `bcrypt`: hashes and verifies passwords securely. You never store plain text passwords; you store a salted hash.
* `checkAndResetUsage`: a helper that zeroes `usageCount` at the start of a billing window and returns a current value. This prevents unbounded growth and enforces monthly caps.
* `crypto`: creates secure random bytes or hashes, typically for password-reset tokens or email verification codes.
* `nodemailer`: sends transactional emails, like reset-password links.

**Why it matters**
These are the pillars of your auth and quota system:

* JWT lets your resolvers trust `context.userId`.
* bcrypt protects user credentials.
* limiter ensures billing fairness.
* nodemailer closes the loop on account recovery.

### Stripe guarded initialization

```js
let stripe = null;
const key = process.env.STRIPE_SECRET_KEY;
if (typeof key === "string" && key.startsWith("sk_")) {
  stripe = require("stripe")(key);
} else {
  console.warn("⚠️  STRIPE_SECRET_KEY missing or invalid; Stripe disabled");
}
```

**What it does**

* Tries to enable Stripe only when a valid secret key exists.
* If you run locally or in tests without Stripe, your server still boots. Resolvers can check `if (!stripe) ...` and return a friendly message instead of crashing.

**Why it matters**
This pattern keeps dev, CI, and prod stable with the same codebase. You avoid “cannot initialize Stripe” errors when env vars are missing on your laptop or in unit tests.

### Nodemailer transporter (Yahoo)

```js
const transporter = nodemailer.createTransport({
  service: "Yahoo",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Your Yahoo app password
  },
  tls: {
    rejectUnauthorized: false,
  },
});
```

**What it does**

* Creates a mailer connected to Yahoo using your app password.
* You will use `transporter.sendMail(...)` in `requestPasswordReset` and maybe receipts.

**Why it matters**
Password resets and account emails are part of a credible SaaS flow. Having this wired means your `requestPasswordReset` mutation can actually deliver recovery links.

---

Excellent — this is one of the **most important** chunks of your backend because it ties together authentication, database queries, and how the frontend (or Whisper server) gets user state from GraphQL.

Let’s break it down line by line:

---

### **Structure overview**

```js
module.exports = {
  Query: {
    checkSubscriptionStatus: async (_, __, { user }) => {
      if (!user) throw new Error("Unauthorized");
      const foundUser = await User.findById(user._id);
      return foundUser?.subscriptionStatus === "active";
    },

    getUsageCount: async (_, __, { user }) => {
      if (!user) throw new Error("Unauthorized");
      const foundUser = await User.findById(user._id);
      return foundUser?.usageCount || 0;
    },
  },
}
```

This `Query` object defines **two resolvers** — one for checking a user’s subscription status, and one for fetching their token usage.
Each resolver maps **directly** to a query name you defined in `typeDefs`.

---

### **1. How GraphQL connects this code to your schema**

From your `typeDefs`:

```graphql
type Query {
  checkSubscriptionStatus: Boolean!
  getUsageCount: Int!
}
```

GraphQL automatically knows that when someone runs:

```graphql
query {
  getUsageCount
}
```

it should execute the `getUsageCount` function inside `Query` in this file.

So `typeDefs` declare *what’s available*, and the resolver here defines *how to get it.*

---

### **2. The resolver function signature**

Each resolver has three arguments:

```js
async (parent, args, context)
```

In the code, you’re ignoring the first two (`_`, `__`) and only using the third, `{ user }`.

* `parent` = data returned from the previous resolver (unused here).
* `args` = arguments passed into the query (unused here).
* `context` = the per-request object that includes useful data like:

  * The logged-in user (decoded from JWT)
  * Possibly a database connection or Stripe instance.

Your authentication middleware runs *before* this and injects `context.user` when a valid JWT is found.
That’s why you can safely do `{ user }` here.

---

### **3. The “Unauthorized” guard**

```js
if (!user) throw new Error("Unauthorized");
```

This is your first line of defense.
If someone tries to query usage or subscription without logging in, they get a clear `GraphQL error: Unauthorized`.
This prevents:

* random API calls from the internet
* your Whisper server accidentally calling without an auth header.

So this matches the behavior in your Whisper server’s `/transcribe` route, which refuses to proceed if `!authToken`.

---

### **4. The actual logic**

#### `checkSubscriptionStatus`

```js
const foundUser = await User.findById(user._id);
return foundUser?.subscriptionStatus === "active";
```

This fetches the user’s record from MongoDB and returns `true` or `false` depending on whether the `subscriptionStatus` is `"active"`.

This is what your **Chrome extension** (or the Whisper backend) checks to decide whether to allow a transcription request or show an “Upgrade to Premium” prompt.


---

#### `getUsageCount`

```js
const foundUser = await User.findById(user._id);
return foundUser?.usageCount || 0;
```

This retrieves the current user’s usage count.
The Whisper server uses this in `/transcribe` before starting transcription:

```js
query { getUsageCount }
```

That’s how it enforces the 8000-token limit.

The `|| 0` ensures your backend won’t crash if `usageCount` is missing — it defaults gracefully.

---

### **5. Why this code matters**

This section is the **foundation** of your token system.

It links:

* the **auth layer** (JWT → `context.user`)
* the **database** (User collection)
* the **usage enforcement logic** in your Whisper server.

Without this bridge:

* You couldn’t track per-user limits.
* Anyone could spam Whisper requests and rack up API costs.
* The frontend wouldn’t know if a user was premium or free.

---

### **6. Where it fits in your system**

| Layer            | Role                                                |
| ---------------- | --------------------------------------------------- |
| Chrome extension | Sends requests with `Authorization: Bearer <token>` |
| Whisper server   | Calls `getUsageCount` before transcription          |
| GraphQL resolver | Validates JWT, fetches data from DB                 |
| MongoDB          | Stores `usageCount` and `subscriptionStatus`        |

That entire flow ensures **paywall integrity** and **resource fairness**.

---

### 🧠 **What this block does**

```js
startSubscription: async (_, __, { user }) => {
  if (!user) throw new Error("Unauthorized");

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/cancel`,
    customer_email: user.email,
  });

  return session.url;
},
```

This resolver creates a **Stripe Checkout Session** for your user.
It’s what lets someone go from your extension → pay on Stripe → return to your frontend as a subscriber.

---

### ⚙️ Step-by-step

1. **Authorization check**

   ```js
   if (!user) throw new Error("Unauthorized");
   ```

   * GraphQL only allows authenticated users (with a valid JWT) to start subscriptions.
   * Prevents random API calls from hitting Stripe.

2. **Creating the Stripe Checkout Session**

   ```js
   const session = await stripe.checkout.sessions.create({...})
   ```

   This tells Stripe:
   “Make a checkout page for one subscription item with this price, and send users back to my app when done.”

   Key options inside:

   * `mode: "subscription"` → ensures it charges *recurring*, not one-time.
   * `payment_method_types: ["card"]` → limits to card payments.
   * `line_items` → what the user is buying (the plan price is from your Stripe dashboard and referenced via `STRIPE_PRICE_ID`).
   * `success_url` → where Stripe redirects the user *after* a successful payment.
   * `cancel_url` → where to go if they click cancel.
   * `customer_email` → auto-fills their email on Stripe’s checkout page.

3. **Returning the session URL**

   ```js
   return session.url;
   ```

   This gives the frontend a one-time link to open the Stripe-hosted checkout.

---

### 💡 Why this is important

This mutation is your **gateway to monetization**:

* It directly connects your app’s authentication system with Stripe.
* It automatically associates the Stripe customer with your logged-in user via `customer_email`.
* It ensures you never expose secret keys to the frontend — only this backend resolver talks to Stripe.

---

### 🧱 How it fits in your system

| Layer            | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| Chrome Extension | Calls this mutation when the user clicks “Subscribe”  |
| GraphQL backend  | Creates Stripe session securely                       |
| Stripe           | Handles the payment and redirects back                |
| Whisper server   | Later checks subscription status before transcription |

So this function starts the **billing → subscription → access control** chain.

---

### 🧩 Security & best practices

* ✅ Never send your `STRIPE_SECRET_KEY` to the client. This resolver safely uses it server-side.
* ⚠️ Make sure `STRIPE_PRICE_ID` and `CLIENT_URL` are in your `.env` — missing them will throw.
* ⚙️ Use **webhooks** later to listen for `checkout.session.completed` events and mark the user as `subscriptionStatus: "active"` in MongoDB.

---


### 🧩 Purpose of `donate` Mutation

This mutation creates a **one-time payment** checkout session.
While `startSubscription` sets up a recurring plan, `donate` allows any logged-in (or even anonymous) user to make a single donation to support the project or pay for API usage manually.

---

### 🧠 Step-by-step breakdown

```js
donate: async (_, { amount }, { user }) => {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Support Developer Donation" },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.CLIENT_URL}/thank-you`,
    cancel_url: `${process.env.CLIENT_URL}/cancel`,
    ...(user?.email && { customer_email: user.email }),
  });

  return session.url;
}
```

#### 1. Arguments and context

* `_` and `{ user }` are the usual GraphQL placeholders (unused parent, context containing the logged-in user).
* `{ amount }` comes from the GraphQL mutation input (the user enters the donation amount in dollars).

#### 2. Stripe session creation

* `mode: "payment"` switches Stripe Checkout into **one-time** mode rather than recurring.
* `price_data` dynamically builds a product on the fly:

  * `"Support Developer Donation"` is the item name shown on the checkout page.
  * `unit_amount` converts the dollar amount into **cents** (Stripe expects integers).
* The `success_url` and `cancel_url` direct the donor back to your frontend.
* `...(user?.email && { customer_email: user.email })` conditionally includes their email if logged in — a neat shorthand that keeps it optional.

#### 3. Return value

`return session.url;` sends the unique Stripe Checkout link to the frontend, so it can redirect the user directly to payment.

---

### ⚙️ Why this mutation matters

* Demonstrates **Stripe flexibility**: one resolver for subscriptions, another for one-time payments.
* Keeps **all sensitive logic server-side** — no frontend access to Stripe secret keys.
* Great example of **dynamic checkout item creation**, unlike subscriptions that rely on pre-defined prices in Stripe Dashboard.
* Could later be expanded to log a `PaymentLog` record for analytics or thank-you emails.

---

### 🔒 Security and usage notes

* Always validate `amount` on the backend (e.g., enforce a min/max) to prevent abuse.
* Keep `STRIPE_SECRET_KEY` safe in your environment variables.
* If you re-enable logging, connect it to your `PaymentLog` model for tracking one-time contributions.

---

### 🧱 Where it fits in the system

| Layer              | Function                                                    |
| ------------------ | ----------------------------------------------------------- |
| Frontend           | Calls `donate(amount)` when user clicks “Support Developer” |
| GraphQL backend    | Creates Stripe Checkout session                             |
| Stripe             | Handles payment & redirect                                  |
| (Optional) MongoDB | Can record donation in `PaymentLog`                         |

---


### 🧩 Purpose of `incrementUsage`

This mutation updates how many tokens a user has spent.
Every time the Whisper server finishes a transcription, it calls this mutation to “add” that transcript’s estimated token count to the user’s running total in MongoDB.
It’s what enforces the daily/monthly usage limits and keeps OpenAI costs under control.

---

### 🧠 Step-by-step breakdown

```js
incrementUsage: async (_, { amount }, { user }) => {
  if (!user) throw new Error("Unauthorized");
  const foundUser = await User.findById(user._id);
  if (!foundUser) throw new Error("User not found");
  await checkAndResetUsage(foundUser, amount);
  return true;
}
```

#### 1. Auth guard

```js
if (!user) throw new Error("Unauthorized");
```

Only logged-in users can increase their usage count.
This matches the same pattern used in your queries (`getUsageCount`, `checkSubscriptionStatus`) to ensure every usage record is tied to a verified JWT user.

#### 2. Retrieve the user document

```js
const foundUser = await User.findById(user._id);
if (!foundUser) throw new Error("User not found");
```

Looks up the authenticated user in MongoDB.
If something went wrong (e.g., token valid but user deleted), the mutation stops cleanly.

#### 3. Core logic: `checkAndResetUsage(foundUser, amount)`

This function enforces **usage limits** for each user and automatically resets their monthly quota.
It’s called inside `incrementUsage()` after every transcription, keeping your billing system safe from overuse.

Essentially:

* It prevents users from exceeding their monthly allowance (`monthlyLimit`).
* It resets their count automatically once the month renews.
* It saves the updated usage data back into MongoDB.

---

### 🧠 Step-by-step breakdown

```js
async function checkAndResetUsage(
  user,
  incrementBy = 1000,
  monthlyLimit = 8000
) {
  const now = new Date();
```

This starts by getting the current date and sets default values:

* `incrementBy`: how much to increase the user’s usage (default 1000 tokens if not provided).
* `monthlyLimit`: the max usage allowed before blocking (default 8000 tokens).

Defaults make it flexible — you can reuse it with different plans later.

---

#### 🧮 1. Reset logic

```js
if (user.resetDate && now > user.resetDate) {
  user.usageCount = 0;
  user.resetDate  = new Date(now.setMonth(now.getMonth() + 1));
  console.log("🔄 Monthly usage reset; next resetDate:", user.resetDate);
}
```

This section resets the user’s usage when their reset date passes.

**How it works:**

* If the user has a `resetDate` (meaning they’ve already started a cycle) **and** today’s date is later than that date, it triggers a reset.
* It sets `usageCount` back to `0`.
* Then moves `resetDate` one month ahead from today (so resets happen automatically each month).

✅ **Purpose:**
This means you never have to manually reset usage. The server auto-rolls over monthly quotas for each user.

---

#### 🚫 2. Limit guard

```js
if (user.usageCount + incrementBy > monthlyLimit) {
  throw new Error("❌ Monthly usage limit reached. Try again next cycle.");
}
```

Before adding new usage, it checks if this transcription would exceed the monthly limit.
If yes, it throws an error that the GraphQL mutation passes back to the frontend — stopping the Whisper server from sending another transcription request.

✅ **Purpose:**
Protects your OpenAI API key and cost by preventing any user from going past their allowed token limit.

---

#### ➕ 3. Add new usage and save

```js
user.usageCount += incrementBy;

console.log("💾 Saving updated usage:", {
  usageCount: user.usageCount,
  resetDate:  user.resetDate,
});
```

It adds the new token usage to the user’s current total and logs the result for debugging.
At this point, you’ve validated the user, enforced limits, and prepared updated data.

---

#### 💾 4. Save to MongoDB

```js
try {
  await user.save();
  console.log("✅ User saved to MongoDB.");
} catch (e) {
  console.error("❌ Failed to save user:", e);
}
```

Finally, it saves the user document.
If MongoDB is unreachable or the save fails, the catch block logs an error but doesn’t crash the server.

✅ **Purpose:**
Makes sure every usage update is stored persistently and safely.

---

### ⚙️ Why it’s important

This function is the **traffic controller** of your token economy:

* Keeps users from overusing Whisper.
* Automatically resets monthly usage for convenience.
* Centralizes all usage-related logic in one place so you don’t duplicate it in multiple resolvers.

Without this, your billing system would break down — either allowing infinite free usage or forcing you to reset counters manually.

---


#### 4. Return value

```js
return true;
```

Simple confirmation for GraphQL.
When your Whisper server calls this mutation:

```js
mutation IncrementUsage($amount: Int!) {
  incrementUsage(amount: $amount)
}
```

it doesn’t need any data back — just a success boolean to confirm the count was updated.

---

### ⚙️ Why it’s important

* It’s the **backbone** of your paywall and token economy.
  Without it, your Whisper server could transcribe indefinitely without cost tracking.
* Keeps your **backend modular**: Whisper never touches the database directly — it just makes a GraphQL mutation.
* Centralizes all usage logic in one place (`limiter.js`), making future plan tiers or daily resets easy to modify.

---

### 🧱 Where it fits in the system

| Layer           | Function                                                      |
| --------------- | ------------------------------------------------------------- |
| Whisper server  | Calls `incrementUsage(amount)` after successful transcription |
| GraphQL backend | Validates user, updates DB, enforces limits                   |
| MongoDB         | Stores updated `usageCount`                                   |
| limiter.js      | Applies rules (add, cap, reset)                               |

---

### 🧩 Purpose of `register`

This mutation creates a **new user account** in your MongoDB database and returns a **JWT token** for authentication.
It’s part of your GraphQL backend’s authentication flow, alongside `login`.
Every other secured resolver (like `incrementUsage` or `startSubscription`) depends on this working correctly.

```js
    register: async (_, { email, password }) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) throw new Error("User already exists");

      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=<>?/{}[\]~]).{8,}$/;
      if (!passwordRegex.test(password)) {
        throw new Error(
          "Password must be at least 8 characters, include 1 uppercase, 1 lowercase, 1 number, and 1 symbol."
        );
      }

      const newUser = await User.create({
        email,
        password, // ⬅️ Raw password only—let pre-save hook handle it!
        subscriptionStatus: "inactive",
        usageCount: 0,
      });

      const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return token;
    },
```
---

### 🧠 Step-by-step breakdown

```js
register: async (_, { email, password }) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) throw new Error("User already exists");
```

1. **Check for duplicates.**
   Looks in MongoDB to see if an account with that email already exists.
   If it does, throw an error early to prevent duplicate users.

---

```js
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=<>?/{}[\]~]).{8,}$/;
if (!passwordRegex.test(password)) {
  throw new Error(
    "Password must be at least 8 characters, include 1 uppercase, 1 lowercase, 1 number, and 1 symbol."
  );
}
```

2. **Password validation.**
   Before creating a new record, it enforces strong password rules:

   * at least 8 characters
   * one uppercase letter
   * one lowercase letter
   * one number
   * one special symbol

✅ **Why this matters:** It protects accounts from weak credentials and ensures that bcrypt (in your model pre-save hook) is hashing secure passwords.

---

```js
const newUser = await User.create({
  email,
  password, // raw password — pre-save hook will hash it automatically
  subscriptionStatus: "inactive",
  usageCount: 0,
});
```

3. **Create the user record.**

   * Saves `email` and the **raw password**, but since your Mongoose `User` model includes a **pre-save hook**, bcrypt automatically hashes it before storage.
   * Initializes `subscriptionStatus` to `"inactive"`, meaning the user hasn’t paid or started a plan yet.
   * Starts `usageCount` at `0`, so you can track Whisper tokens right from the first transcription.

✅ **Why this matters:** The defaults here tie the new user into your Stripe + limiter system automatically.

---

```js
const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
  expiresIn: "7d",
});
```

4. **Generate a JWT token.**
   Creates a signed token containing the user’s ID using your secret key.
   The 7-day expiration keeps sessions short-lived and secure.

✅ **Why this matters:** This token is what the Chrome extension or frontend attaches to every API call (`Authorization: Bearer <token>`).
That’s how your Whisper server and GraphQL backend know who’s using your API.

---

```js
return token;
```

5. **Return the token.**
   The frontend stores this in memory or localStorage, and uses it to authenticate future actions (like starting a subscription or fetching usage counts).

---

### ⚙️ Why it’s important

* It’s the foundation of your **authentication layer.**
* Automatically integrates password strength, hashing, and JWT authentication.
* Initializes user records in a way that fits perfectly with your **usage tracking** and **Stripe billing** system.
* Keeps security best practices cleanly separated — validation here, hashing in the model.

---

### 🧱 Where it fits in your system

| Layer           | Function                                                     |
| --------------- | ------------------------------------------------------------ |
| Frontend        | Sends email/password to `register` mutation                  |
| GraphQL backend | Validates, creates user, returns token                       |
| MongoDB         | Stores hashed password, subscription status, and usage count |
| Whisper server  | Requires this JWT for authentication                         |
| Stripe          | Uses user’s email to link payment data                       |

---


### 🧩 Purpose of `login`

The `login` mutation verifies a user’s credentials (email + password), checks them against the MongoDB `User` collection, and if valid, issues a new **JWT token**.
That token is what gives the user authenticated access to the rest of your system — exactly the same kind of token `register` returns for new users.

It’s the **entry point for existing users** to re-enter your ecosystem safely.

```js
    login: async (_, { email, password }) => {
      console.log("🚀 Login attempt for:", email);
      const user = await User.findOne({ email });
      if (!user) {
        console.log("❌ User not found:", email);
        throw new Error("Invalid credentials");
      }

      const isValid = await bcrypt.compare(password, user.password);

      if (!isValid) throw new Error("Invalid credentials");

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      return token;
    },
```
---

### 🧠 Step-by-step breakdown

```js
console.log("🚀 Login attempt for:", email);
```

This logs every login attempt by email.
You add this mostly for debugging, but it’s also useful for backend logs in case you ever want to detect unusual login behavior or brute-force attempts later.

---

```js
const user = await User.findOne({ email });
if (!user) {
  console.log("❌ User not found:", email);
  throw new Error("Invalid credentials");
}
```

1. **Find the user by email.**
   Queries MongoDB using the `User` model.
   If no user exists with that email, it throws an “Invalid credentials” error (instead of “User not found”) — that’s intentional security practice.
   It prevents malicious actors from probing which emails exist in your system.

✅ **Why this matters:**
This is your first line of defense against credential stuffing or account enumeration.

---

```js
const isValid = await bcrypt.compare(password, user.password);
```

2. **Compare the entered password with the stored hashed password.**
   Uses bcrypt to safely compare — it never decrypts the stored password; it hashes the input and checks if they match.

✅ **Why this matters:**
This ensures even if your database were compromised, no one could use the stored password to log in anywhere else.

---

```js
if (!isValid) throw new Error("Invalid credentials");
```

3. **Handle bad password attempts.**
   If bcrypt comparison fails, the function immediately throws another “Invalid credentials” error.
   Again, this avoids leaking *which* field was wrong (email or password).

---

```js
const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
  expiresIn: "7d",
});
return token;
```

4. **Generate and return a JWT.**
   Creates a signed token with the user’s ID payload, using your `JWT_SECRET`.
   The token expires in 7 days for both security and convenience.
   Returning the token completes the login process — your frontend or Chrome extension will store it and attach it to every request.

✅ **Why this matters:**
This JWT is what lets your user interact with:

* `/transcribe` on your Whisper server
* `incrementUsage` and `getUsageCount` in GraphQL
* Stripe subscription routes

Without it, those requests would fail the authorization guard you added (`if (!user) throw new Error("Unauthorized")`).

---

### 🔐 Summary of the full login lifecycle

| Step | Function                                                            | Layer      |
| ---- | ------------------------------------------------------------------- | ---------- |
| 1    | User enters credentials on frontend                                 | Frontend   |
| 2    | Frontend calls `login(email, password)` mutation                    | GraphQL    |
| 3    | Resolver verifies email + password via bcrypt                       | Backend    |
| 4    | Creates and returns a JWT                                           | Backend    |
| 5    | JWT is stored and attached to future requests                       | Frontend   |
| 6    | Whisper server & backend use it to identify and limit user activity | Auth layer |

---

### ⚙️ Why this mutation matters

* It reuses the **same token logic** as `register`, ensuring consistency.
* It enforces secure credential checks via bcrypt (no plaintext ever compared).
* It supports your **JWT-based security model**, allowing multiple services (GraphQL, Whisper, Stripe) to trust a single source of truth.
* It’s essential for keeping your **usage limits, billing, and data access tied to real users**.

---

### 🧩 Purpose of `requestPasswordReset`

This mutation is the **first half of your password-reset system**.
It lets a user request a reset link if they forgot their password — but it does so in a way that never exposes internal secrets and keeps the temporary reset token secure.

The mutation:

1. Verifies the email exists.
2. Creates a cryptographically secure token.
3. Stores a **hashed** version of that token in MongoDB.
4. Emails the user a **non-hashed** version of the token embedded in a link.

That link points back to your frontend’s `/reset-password` route, where the user can choose a new password.
```js
    requestPasswordReset: async (_, { email }) => {
      const user = await User.findOne({ email });
      if (!user) throw new Error("No user found with that email.");

      // Generate token
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

      // Store hashed token in DB
      user.resetToken = hashedToken;
      user.resetTokenExpiry = Date.now() + 1000 * 60 * 60; // 1 hour
      await user.save();

      // Send raw token in email link (not hashed)
      const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;

      await transporter.sendMail({
        to: user.email,
        from: process.env.EMAIL_USER,
        subject: "Your Password Reset Link",
        html: `
      <h3>Password Reset Requested</h3>
      <p>Click <a href="${resetLink}">here</a> to reset your password.</p>
      <p>This link will expire in 1 hour.</p>
    `,
      });

      return "Password reset email sent.";
    },
```
---

### 🧠 Step-by-step breakdown

```js
const user = await User.findOne({ email });
if (!user) throw new Error("No user found with that email.");
```

Checks if the email belongs to an existing user.
If not, it immediately throws an error.
You could later make this message generic (for privacy) — e.g., “If that account exists, a reset link will be sent.”

✅ **Why this matters:**
Prevents you from sending emails to invalid or malicious addresses and avoids wasting server resources.

---

```js
const rawToken = crypto.randomBytes(32).toString("hex");
const hashedToken = crypto
  .createHash("sha256")
  .update(rawToken)
  .digest("hex");
```

* `rawToken`: a random 32-byte value turned into a 64-character hexadecimal string — this is what you’ll email to the user.
* `hashedToken`: a SHA-256 hash of the raw token — this is what you’ll store in MongoDB.

✅ **Why this matters:**
Even if someone gained database access, they’d only see the **hashed** token.
That makes it practically impossible to guess or reuse the original link.

---

```js
user.resetToken = hashedToken;
user.resetTokenExpiry = Date.now() + 1000 * 60 * 60; // 1 hour
await user.save();
```

* Saves the hashed token and its expiration time in MongoDB.
* The expiration (1 hour) keeps the reset window short and secure.

✅ **Why this matters:**
Prevents old reset links from being reused indefinitely and limits damage if someone intercepts a link.

---

```js
const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;
```

Builds a reset URL pointing to your frontend.
You embed the **raw** token here — not the hashed one — since the user will send this raw token back in the next mutation (`resetPassword`) for verification.

✅ **Why this matters:**
The backend will later hash whatever token comes back and compare it to the stored hashedToken.
This keeps the whole system one-way and tamper-proof.

---

```js
await transporter.sendMail({
  to: user.email,
  from: process.env.EMAIL_USER,
  subject: "Your Password Reset Link",
  html: `
    <h3>Password Reset Requested</h3>
    <p>Click <a href="${resetLink}">here</a> to reset your password.</p>
    <p>This link will expire in 1 hour.</p>
  `,
});
```

Sends an email via your **Yahoo SMTP transporter** configured at the top of your resolvers file.
It contains the reset link and a clear expiration notice.

✅ **Why this matters:**
Keeps users informed and ensures reset links aren’t used after they expire.
It also leverages your existing secure environment variables for credentials, avoiding hard-coding anything sensitive.

---

```js
return "Password reset email sent.";
```

Confirms success to the frontend.
Your frontend can use this response to display a success message like “If that account exists, check your inbox.”

---

### 🔐 Security recap

| Risk                       | How you prevented it                               |
| -------------------------- | -------------------------------------------------- |
| Database leak of tokens    | You hash the token before saving                   |
| Link reuse or replay       | You store an expiry timestamp                      |
| Brute-force token guessing | 32 random bytes → 64-char hex = 2²⁵⁶ possibilities |
| Email disclosure           | (Optional) Can use a neutral success message       |
| Credential exposure        | No passwords or secret keys leave the backend      |

---

### ⚙️ Why this mutation is critical

* It’s the **on-ramp** to secure password resets — the rest of the flow (`resetPassword`) depends on this.
* It ties your **MongoDB model**, **crypto module**, and **nodemailer setup** together.
* It’s written in a way that’s ready for production — you could swap Yahoo for SendGrid or AWS SES later with zero logic changes.
* It shows you understand backend **token life cycles**, **hashing**, and **email flows** — all real DevOps-grade concerns.

---

### 🧩 Purpose of `resetPassword`

This mutation handles what happens **after** a user clicks the reset link from their email.
They arrive at your frontend’s `/reset-password` page, type in a new password, and submit it — that triggers this backend function.

Your resolver then:

1. Validates password strength
2. Hashes the incoming token
3. Confirms it matches a valid user in MongoDB
4. Replaces the user’s password with the new one
5. Deletes the reset token and expiry so the link can’t be reused
```js
    resetPassword: async (_, { token, newPassword }) => {
      // Password strength check
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=<>?/{}[\]~]).{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        throw new Error(
          "Password must be at least 8 characters, include 1 uppercase, 1 lowercase, 1 number, and 1 symbol."
        );
      }

      // Hash the incoming token from the URL
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      const user = await User.findOne({
        resetToken: hashedToken,
        resetTokenExpiry: { $gt: Date.now() },
      });

      if (!user) throw new Error("Invalid or expired token.");

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      user.resetToken = undefined;
      user.resetTokenExpiry = undefined;
      await user.save();

      return "Password reset successful.";
    },
```
---

### 🧠 Step-by-step breakdown

```js
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=<>?/{}[\]~]).{8,}$/;
if (!passwordRegex.test(newPassword)) {
  throw new Error(
    "Password must be at least 8 characters, include 1 uppercase, 1 lowercase, 1 number, and 1 symbol."
  );
}
```

✅ **Purpose:** Prevent weak or common passwords.
This enforces the same standard you used in your `register` mutation.
Doing it here too is crucial because users could otherwise bypass that rule when resetting their password.

It ensures all accounts maintain the same baseline security policy.

---

```js
const hashedToken = crypto
  .createHash("sha256")
  .update(token)
  .digest("hex");
```

✅ **Purpose:** Protect the comparison process.
Remember how `requestPasswordReset` stored only the hashed version of the token?
Now, when the user’s browser sends back the **raw token** (from their email link), you hash it again with the same algorithm.
If both hashes match, that proves the user clicked a valid, untampered link.

This is what authenticates the password reset request — no login needed.

---

```js
const user = await User.findOne({
  resetToken: hashedToken,
  resetTokenExpiry: { $gt: Date.now() },
});
```

✅ **Purpose:** Validate both token match *and* expiration.
This MongoDB query ensures:

* `resetToken` matches the hashed token
* `resetTokenExpiry` is still in the future

If no document matches both, the link is invalid or expired, and the user has to restart the reset process.

---

```js
if (!user) throw new Error("Invalid or expired token.");
```

✅ **Purpose:** Fail fast and safely.
This stops the flow right here if the link is invalid or outdated, protecting you from token reuse, replay attacks, or brute force attempts.

---

```js
const hashedPassword = await bcrypt.hash(newPassword, 10);
user.password = hashedPassword;
user.resetToken = undefined;
user.resetTokenExpiry = undefined;
await user.save();
```

✅ **Purpose:** Replace the password safely.
This does three critical things:

1. Hashes the new password (never stores plain text).
2. Overwrites the old password with the new hashed one.
3. Removes both reset fields to permanently deactivate the reset link.

Without those last two lines, an old link could technically still be used again — this prevents that completely.

---

```js
return "Password reset successful.";
```

✅ **Purpose:** Confirm success to the frontend.
This tells the UI to redirect the user to the login page and show a confirmation like “Your password has been updated.”

---

### 🔐 Security summary

| Risk                 | How your code mitigates it           |
| -------------------- | ------------------------------------ |
| Weak passwords       | Enforced regex policy                |
| Token leaks          | Only hashed tokens stored            |
| Replay attacks       | Token + expiry cleared after use     |
| Brute-force guessing | Tokens expire within 1 hour          |
| Plaintext passwords  | All passwords hashed with bcrypt     |
| Link forgery         | Hash comparison ensures authenticity |

---

### ⚙️ Why this resolver is critical

* It closes the loop on the password reset system you started with `requestPasswordReset`.
* It proves you understand **stateful token validation** — the backend knows if a link is still valid.
* It maintains the same security standards as your login and register flows.
* It shows you know how to combine **cryptography**, **database integrity**, and **authentication best practices** in one resolver.

---
### **Purpose:** schedule Stripe to cancel the user’s active subscription at the end of the current billing period.
```js
    cancelSubscription: async (_, __, { user }) => {
      if (!user) throw new Error("Unauthorized");

      const foundUser = await User.findById(user._id);
      if (!foundUser || !foundUser.stripeCustomerId)
        throw new Error("No Stripe customer found.");

      // Find the active Stripe subscription
      const subscriptions = await stripe.subscriptions.list({
        customer: foundUser.stripeCustomerId,
        status: "active",
      });

      if (subscriptions.data.length === 0) {
        throw new Error("No active subscription found.");
      }

      const subscription = subscriptions.data[0];

      // Cancel the subscription at the end of the period
      const cancelled = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });

      return `Subscription will remain active until ${new Date(
        cancelled.current_period_end * 1000
      ).toLocaleDateString()}.`;
    }
```

### What it does (step by step)

1. **Auth guard**

```js
if (!user) throw new Error("Unauthorized");
```

Stops anonymous requests.

2. **Load the caller and ensure they’re linked to Stripe**

```js
const foundUser = await User.findById(user._id);
if (!foundUser || !foundUser.stripeCustomerId)
  throw new Error("No Stripe customer found.");
```

Without a `stripeCustomerId`, you cannot look up or cancel anything in Stripe.

3. **Find an active subscription for that customer**

```js
const subscriptions = await stripe.subscriptions.list({
  customer: foundUser.stripeCustomerId,
  status: "active",
});
if (subscriptions.data.length === 0)
  throw new Error("No active subscription found.");
const subscription = subscriptions.data[0];
```

You list active subs and grab the first one. This is fine for single-plan setups.

4. **Request cancellation at the end of the current period**

```js
const cancelled = await stripe.subscriptions.update(subscription.id, {
  cancel_at_period_end: true,
});
```

This sets a flag. The user keeps access until the current billing period ends, then Stripe turns it off.

5. **Return a human-readable confirmation**

```js
return `Subscription will remain active until ${new Date(
  cancelled.current_period_end * 1000
).toLocaleDateString()}.`;
```

`current_period_end` is a Unix timestamp (seconds). You convert to ms and format it.

---

### Why it matters

* This is the clean way to cancel a recurring plan without surprising the user.
* Your UI can show a banner like “Scheduled to cancel on MM/DD/YYYY,” while everything else keeps working until that date.

---
