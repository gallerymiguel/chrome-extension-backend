### 🧩 Purpose of `User.js`

This defines the **MongoDB schema** for your users.
It represents each registered person using your Chrome extension or API — storing their credentials, subscription status, usage counts, Stripe data, and password reset info.

It’s also responsible for **security-critical logic**, like hashing passwords before saving and verifying them on login.

---

### 🧱 Schema fields explained

```js
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    match: [/.+@.+\..+/, "Invalid email format"],
  },
```

* **email:** required and unique — ensures no duplicates.
* Uses a basic regex to validate proper email format (e.g., [user@example.com](mailto:user@example.com)).
* This is how you identify users across your whole system — including Stripe billing and JWT payloads.

---

```js
password: { type: String, required: true },
```

* Stores the **hashed password** (never the plain text).
* Hashing happens automatically in the `pre("save")` hook below.
* You keep this separate from other fields to avoid accidental exposure.

---

```js
subscriptionStatus: {
  type: String,
  enum: ["active", "inactive", "refunded", "cancelled"],
  default: "inactive",
},
```

* Tracks whether a user currently has an active paid subscription.
* Works hand-in-hand with your Stripe `startSubscription` and `cancelSubscription` mutations.
* The `enum` ensures that only valid values are stored — no typos or random statuses.

---

```js
usageCount: { type: Number, default: 0 },
```

* Keeps track of how many tokens the user has consumed (used by your **Whisper limit system**).
* Updated through `incrementUsage` and the `checkAndResetUsage` utility.
* Initialized at `0` when a new user is created.

---

```js
stripeCustomerId: { type: String },
```

* Holds the Stripe customer ID once created.
* Allows future billing actions (refunds, plan changes, usage reports) to tie back to the right Stripe account.

---

```js
resetDate: { type: Date },
resetToken: { type: String },
resetTokenExpiry: { type: Date },
```

* Support for password-reset functionality.
* `resetDate` is also reused for your **monthly usage reset** logic — determining when to refresh a user’s quota in `limiter.js`.

---

### 🔒 Password hashing middleware

```js
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  console.log("🚨 Hashing password for user:", this.email);
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
```

This runs **before every `.save()`** on a user document.

* If the password hasn’t changed, it skips hashing (important for updates).
* If it’s a new password or a reset, it hashes it using bcrypt with a salt round of 10.
* Prevents you from ever storing plain-text passwords — even accidentally.

✅ **Why this matters:**
When a user registers or resets their password, this hook ensures the value in MongoDB is a secure one-way hash. Even if your database were compromised, the real passwords remain unrecoverable.

---

### ✅ Password comparison helper

```js
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};
```

This method is used during login. It compares the entered password (`candidatePassword`) with the stored hashed password using bcrypt’s comparison function.

✅ **Why this matters:**
This allows secure authentication without ever decrypting stored passwords — bcrypt compares them in a safe, non-reversible way.

---

### ⚙️ Why this file is critical

* It’s the **single source of truth** for all user data in your app.
* It ties together **authentication (bcrypt, JWT)**, **billing (Stripe)**, and **usage tracking (limiter.js)**.
* It enforces strong data consistency and security via Mongoose schema rules and middleware.
* Without this, your app couldn’t safely identify or limit users.

---

### 🧭 Where it fits in your system

| Layer                                | Function                                                   |
| ------------------------------------ | ---------------------------------------------------------- |
| GraphQL backend                      | Uses this model for all user-related queries and mutations |
| Auth mutations (`register`, `login`) | Create and validate users via this schema                  |
| Usage limiter (`limiter.js`)         | Reads and updates `usageCount` and `resetDate`             |
| Stripe integration                   | Uses `email` and `stripeCustomerId` to link subscriptions  |
| Password reset                       | Relies on `resetToken` and `resetTokenExpiry`              |

---

