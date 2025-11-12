# `routes/webhook.js` — Stripe webhook: setup and signature verification

**Code covered:**

```js
const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/User");
const { log, warn, error } = require("../utils/logger");

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      error("⚠️ Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    log("🔔 Incoming event:", event.type);
```

## 1) Router and Stripe client

* `express.Router()` creates an isolated mini app for the webhook route. You mount it in `index.js` with `app.use("/webhook", webhookRouter)`. Keeping this logic separate avoids mixing raw body parsing with the JSON body parser used by GraphQL.
* `stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)` initializes the official Stripe SDK with your server secret so you can verify signatures and query subscriptions. This client must only run on the server.

**Why it matters:** Stripe sends signed events to your backend. You need a dedicated route and a server-secret Stripe client to safely verify and handle them.

## 2) Raw body middleware for Stripe

* `express.raw({ type: "application/json" })` tells Express to hand your handler the **unparsed raw bytes** of the request body.
* Stripe requires the exact raw payload to compute and verify the signature. If you used `express.json()` here, the body would be mutated and signature verification would fail.

**Why it matters:** This is the number one gotcha with Stripe webhooks. The raw body middleware must be applied on this route before any global JSON parser. That is why you mounted the webhook router early in `index.js`.

## 3) Signature extraction and event construction

* `const sig = req.headers["stripe-signature"];` pulls the HMAC signature that Stripe includes with every webhook.
* `stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)` verifies the signature against your **webhook signing secret** and returns a parsed `event` object if valid.

**Why it matters:** This is your authenticity check. It proves the request originated from Stripe and was not tampered with. If verification fails, you return HTTP 400 and stop.

## 4) Logging the event type

* `log("🔔 Incoming event:", event.type);` records what kind of event arrived, for example `checkout.session.completed`, `invoice.paid`, or `customer.subscription.updated`.

**Why it matters:** You will branch on `event.type` in the next section to update user records. Logging the type helps you debug and confirm Stripe is delivering what you expect.

---

## Handling Stripe events — `checkout.session.completed`

**Code covered:**

```js
switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object;
    const customerEmail = session.customer_email;
    const stripeCustomerId = session.customer;
    const subscriptionId = session.subscription;

    if (!customerEmail || !subscriptionId) break;

    await activateUserSubscription({
      customerEmail,
      stripeCustomerId,
      subscriptionId,
    });
    break;
  }
```

### What it does

This block fires when Stripe finishes a **Checkout Session** in `subscription` mode — meaning a user just paid for their plan successfully.
It extracts key fields from the session object (`customer_email`, `customer`, `subscription`) and then calls your helper function `activateUserSubscription()` to update that user’s record in MongoDB.

### Why it matters

Stripe doesn’t automatically update your database. The webhook is what tells your backend,
“Hey, a payment just went through — mark this user as subscribed.”
This ensures your user’s `subscriptionStatus` flips to `"active"` *only after Stripe confirms payment.*

Without this webhook:

* The app could mark users as subscribed before payment clears.
* You’d have no way to recover from cancellations, refunds, or billing issues automatically.

### Line-by-line breakdown

* `event.data.object` — the raw Stripe Checkout session payload.
* `customer_email` — used to find the corresponding MongoDB `User` by email.
* `customer` — the Stripe-generated customer ID (you store this in `user.stripeCustomerId` for later lookup).
* `subscription` — the subscription object ID that Stripe uses to manage renewals and cancellations.
* The `if (!customerEmail || !subscriptionId)` guard ensures that incomplete sessions don’t crash your webhook or cause false activations.
* `activateUserSubscription()` is your own abstraction that:

  * Locates the `User` document via email,
  * Sets `subscriptionStatus` to `"active"`,
  * Saves `stripeCustomerId` and `subscriptionId`,
  * Persists the updated user to MongoDB.

### How it fits the system

This function is the **first step** in your billing lifecycle:

1. The frontend or Chrome extension opens a Stripe Checkout session.
2. The user completes payment on Stripe’s site.
3. Stripe POSTs this event to your `/webhook`.
4. The backend verifies the signature, receives the event, and calls `activateUserSubscription()`.
5. The user is now officially active in your database, so resolvers like `checkSubscriptionStatus` will return `true`.

---

## Handling `"customer.subscription.created"`

**Code covered:**

```js
case "customer.subscription.created": {
  const subscription = event.data.object;
  const subscriptionId = subscription.id;
  const stripeCustomerId = subscription.customer;

  /* Fetch the customer to get email */
  let customerEmail = null;
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    customerEmail = customer.email;
  } catch (err) {
    error("❌ Couldn’t fetch customer:", err.message);
  }

  if (!customerEmail) {
    warn("⚠️ No email on customer record; skipping DB update");
    break;
  }

  await activateUserSubscription({
    customerEmail,
    stripeCustomerId,
    subscriptionId,
    currentPeriodEndUnix: subscription.current_period_end,
  });
  break;
}
```

### What it does

This block runs when Stripe sends a `customer.subscription.created` event — which happens when a **subscription object** itself is created (e.g., via API, billing portal, or Stripe dashboard), not necessarily through the checkout flow.

This ensures that even if the user’s subscription was started **outside of your normal checkout flow**, your database still updates properly.

### Why it matters

Sometimes subscriptions get created outside the `/checkout.session.completed` event (e.g., admin-created subscriptions, renewals from saved payment methods, or retries after network issues).
If you only listened for `checkout.session.completed`, those cases would never mark the user as active.
This event fills that gap by syncing your user state directly with Stripe whenever a new subscription object appears.

### Line-by-line breakdown

* `event.data.object` — the actual `subscription` object from Stripe.
* `subscription.id` — the unique ID that identifies this user’s plan in Stripe.
* `subscription.customer` — the Stripe Customer ID associated with this subscription.
* The code then calls `stripe.customers.retrieve()` to get the **customer’s email**, since Stripe’s subscription payload doesn’t always include it directly.

  * If the email fetch fails, the function logs an error and skips the update (preventing broken DB writes).
* Once the email is known, it calls `activateUserSubscription()` again, passing:

  * `customerEmail` — to match the user in MongoDB,
  * `stripeCustomerId` — for future lookups,
  * `subscriptionId` — for linking the record to Stripe,
  * `currentPeriodEndUnix` — so your system knows when the current billing period ends (helpful if you later automate renewal handling).

### How it fits the system

This acts as a **backup activation** path:

* If a user pays through Checkout, the previous handler activates them.
* If a subscription is created any other way (portal, Stripe dashboard, API, retry flow), *this* handler still syncs their MongoDB record.

That redundancy keeps your subscription data consistent with Stripe — a must-have for production billing reliability.

---

## Handling `"invoice.payment_failed"`

**Code covered:**

```js
case "invoice.payment_failed": {
  const { customer } = event.data.object; // Stripe customer ID

  // ① Fetch the Stripe customer to get an email (purely for logs)
  let customerEmail = null;
  try {
    const custObj = await stripe.customers.retrieve(customer);
    customerEmail = custObj.email;
  } catch (err) {
    warn("⚠️ Couldn’t fetch customer email:", err.message);
  }

  // ② Flip status → inactive  clear resetDate
  const updated = await User.findOneAndUpdate(
    { stripeCustomerId: customer },
    { subscriptionStatus: "inactive", resetDate: null }
  );

  if (updated) {
    log(
      `❌ Payment failed – deactivated: ${
        customerEmail || updated.email || "(email unknown)"
      }`
    );
  } else {
    warn(`ℹ️ Payment-failed event for unknown customer ${customer}`);
  }
  break;
}
```

---

### What it does

This case runs whenever Stripe emits an `"invoice.payment_failed"` event — meaning a recurring subscription charge didn’t go through (e.g., the card expired or funds were insufficient).

Your backend immediately reacts by marking that user as **inactive**, effectively pausing their premium access until payment is resolved.

---

### Why it matters

Stripe may retry payments automatically, but your app should never keep granting unlimited API access if the user hasn’t actually paid.
This webhook acts as your **safety cutoff** — ensuring billing failures directly affect backend authorization.

By setting `subscriptionStatus: "inactive"`, your GraphQL resolvers (`checkSubscriptionStatus`, etc.) will automatically reflect that the user is no longer active, disabling premium features (like Whisper transcription).

---

### Line-by-line breakdown

1. **Extracting the customer ID**

   ```js
   const { customer } = event.data.object;
   ```

   The event payload contains `customer`, which is the Stripe Customer ID.
   It’s the link between Stripe and your MongoDB record (`user.stripeCustomerId`).

2. **Retrieving the customer email**

   ```js
   const custObj = await stripe.customers.retrieve(customer);
   customerEmail = custObj.email;
   ```

   You pull the email mainly for logging. Even though you don’t use it in updates, it helps when diagnosing Stripe logs — you can see exactly which account failed.

3. **Updating your database**

   ```js
   const updated = await User.findOneAndUpdate(
     { stripeCustomerId: customer },
     { subscriptionStatus: "inactive", resetDate: null }
   );
   ```

   * Finds the MongoDB user by their `stripeCustomerId`.
   * Marks them **inactive**, disabling premium access.
   * Clears `resetDate`, ensuring their usage-limit timer resets properly when they resubscribe later.

4. **Logging the outcome**

   * If the user was found and updated, you log a clear message:

     ```
     ❌ Payment failed – deactivated: user@example.com
     ```
   * If no user matches the Stripe ID (rare, but possible), you log a warning — helps you track any mismatch between your DB and Stripe data.

---

### How it fits into the system

This is part of your **automatic lifecycle enforcement**:

* Stripe can’t bill → webhook triggers → your DB marks inactive → API access stops.
* When the user successfully pays again (in another webhook like `"invoice.payment_succeeded"`), you can flip them back to `"active"`.

Together, these events make your subscription system **self-healing** — the backend always stays in sync with Stripe without you manually editing user records.

---

## Handling "customer.subscription.deleted"

**Code covered:**

```js
case "customer.subscription.deleted": {
  const sub = event.data.object;
  const stripeCustomer = sub.customer; // customer ID

  let customerEmail = null;
  try {
    const custObj = await stripe.customers.retrieve(stripeCustomer);
    customerEmail = custObj.email;
  } catch (err) {
    warn("⚠️ Couldn’t fetch customer email:", err.message);
  }

  const updated = await User.findOneAndUpdate(
    { stripeCustomerId: stripeCustomer },
    { subscriptionStatus: "inactive", resetDate: null }
  );

  if (updated) {
    log(
      `🚫 Subscription cancelled for: ${
        customerEmail || updated.email || "(email unknown)"
      }`
    );
  } else {
    warn(`ℹ️ Cancellation event for unknown customer ${stripeCustomer}`);
  }
  break;
}
```

### What it does

This branch fires when Stripe reports that a subscription has been fully cancelled. That can happen if the user cancels in the billing portal, an admin cancels in Stripe, or the subscription is ended after a scheduled cancel_at_period_end. The handler finds the user by `stripeCustomerId` and marks them inactive, then clears `resetDate`.

### Why it matters

A cancelled subscription is a hard stop. You should not wait for invoice failures or retries. Flipping `subscriptionStatus` to `"inactive"` ensures your GraphQL resolvers and feature gates stop granting premium access immediately. Clearing `resetDate` avoids carrying an old cycle forward if the user signs up again later.

### Line by line

* `const sub = event.data.object` gets the subscription payload that was deleted.
* `const stripeCustomer = sub.customer` grabs the Stripe Customer ID used to locate your user.
* The `try` block retrieves the customer from Stripe to get an email for logs. Helpful for audits and support.
* `findOneAndUpdate({ stripeCustomerId: stripeCustomer }, { subscriptionStatus: "inactive", resetDate: null })` deactivates the user and resets their usage cycle marker.
* If a user is found, you log a clear cancellation message with the email when available. If not, you log that Stripe sent an event for a customer ID you do not recognize. That is a signal to investigate mapping or data drift.

### How it fits the system

You now cover the three core states:

1. Activation on successful start (`checkout.session.completed` and `customer.subscription.created`).
2. Temporary loss of access on payment failure (`invoice.payment_failed`).
3. Final termination on cancellation (`customer.subscription.deleted`).

Together these keep MongoDB in lockstep with Stripe, so your auth and usage logic is always correct without manual cleanup.

---

## Handling `"charge.refunded"`

**Code covered:**

```js
case "charge.refunded": {
  const refund = event.data.object;
  const stripeCustomerId = refund.customer;

  if (!stripeCustomerId) {
    error("❌ Missing Stripe customer ID on refund event.");
    break;
  }

  // Cancel any active subscription
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "active",
  });

  if (subs.data.length) {
    const subId = subs.data[0].id;
    await stripe.subscriptions.cancel(subId);
    log(
      `🔒 Stripe subscription ${subId} cancelled for ${stripeCustomerId}`
    );
  }
}
```

---

### What it does

This event runs whenever a **refund** occurs — meaning Stripe issued money back to the customer (either manually by an admin or automatically after a dispute). When this happens, your backend looks up that customer’s active subscriptions and cancels them to ensure the refunded user doesn’t retain premium privileges.

---

### Why it matters

If a refund is processed but the user’s subscription remains active in your database, they’d still have paid access after getting their money back — a serious business logic bug.
This webhook guarantees refunds always **revoke benefits** by cancelling any related Stripe subscriptions automatically.

---

### Line by line

* `const refund = event.data.object;` gets the refund payload from Stripe.
* `const stripeCustomerId = refund.customer;` retrieves which customer was refunded.
* The `if (!stripeCustomerId)` guard ensures the event includes a valid Stripe customer; if not, it logs an error and exits gracefully.
* `await stripe.subscriptions.list({ customer: stripeCustomerId, status: "active" })` checks whether that customer still has any active subscriptions.
* If yes, the app calls `stripe.subscriptions.cancel(subId)` to terminate it.
* Finally, it logs the cancellation with:

  ```
  🔒 Stripe subscription sub_XXX cancelled for cus_XXX
  ```

---

### How it fits the system

This handler ensures **financial and access parity** — whenever Stripe refunds a charge, your backend immediately cancels the associated premium access.
It ties together the system’s integrity with Stripe’s records so your database, billing, and authentication layers all stay aligned.

---

## Completing `"charge.refunded"` – mark user as refunded

**Code covered:**

```js
// Mark user as refunded
/* ② mark user refunded AND clear resetDate safely */
const updatedUser = await User.findOneAndUpdate(
  { stripeCustomerId },
  {
    subscriptionStatus: "refunded",
    resetDate: null,
  },
  { new: true } // so we always have a doc to log
);

if (updatedUser) {
  log(`🔄 Subscription marked as refunded for ${updatedUser.email}`);
} else {
  warn(`❌ No user found for Stripe customer ID: ${stripeCustomerId}`);
}

break;
```

### What it does

After cancelling any active Stripe subscription for the refunded customer, you synchronize your app state by marking the matching MongoDB user as `refunded` and clearing `resetDate`. You then log the outcome.

### Why it matters

A refund is not just a cancellation. It is a different business state that can affect support flows or analytics. Storing `subscriptionStatus: "refunded"` lets you distinguish between inactive due to churn versus inactive due to refund. Clearing `resetDate` prevents stale usage windows from carrying over if the user returns later.

### Line by line

* `findOneAndUpdate({ stripeCustomerId }, { subscriptionStatus: "refunded", resetDate: null }, { new: true })` finds the user tied to this Stripe customer and updates status. The `new: true` option returns the updated doc for clean logging.
* If a user was found, you log that the account was marked refunded. If not, you warn that the webhook referenced a Stripe ID you do not recognize. That helps track down mapping issues.

### How it fits the system

Your refund handling now performs three steps in order: cancel any remaining subscription at Stripe, set the app user to refunded, and reset usage timing. This keeps billing state, authorization, and rate limits aligned with money flow.

---

## Default case and HTTP acknowledgment

**Code covered:**

```js
default:
  // log(`Unhandled event type: ${event.type}`);
}

res.json({ received: true });
```

### What it does

If the event type does not match any switch case, you hit `default`. You do not error, you just fall through and return a JSON acknowledgment `{ received: true }`.

### Why it matters

Stripe requires a 2xx response to consider the webhook delivered. If you throw or hang, Stripe will retry and you may process the same event multiple times. Returning a fast 200 confirms receipt and keeps retries under control. Keeping an optional log in `default` is useful during integration to discover events you have not mapped yet.

### Operational notes

* You already use `express.raw` and `stripe.webhooks.constructEvent`, so the signature is verified. That is the correct pattern.
* The handler is idempotent enough because you use `findOneAndUpdate` by customer id and set fields to known values. If you later add side effects, consider storing the last processed Stripe event id to avoid double work in rare retry cases.

---

## Helper: `activateUserSubscription(...)`

**Purpose**
Central place to flip a user to active, set their Stripe customer id, and compute the next reset date from the subscription period end. Using one helper avoids duplicating this logic across multiple webhook cases (`checkout.session.completed`, `customer.subscription.created`, and any future plan changes).

**Signature**

```js
async function activateUserSubscription({
  customerEmail,
  stripeCustomerId,
  subscriptionId,
  currentPeriodEndUnix,
})
```

Inputs come from Stripe events. `currentPeriodEndUnix` may be missing on some events, so the helper can fetch the subscription if needed.

### Step 1: Determine the correct period end

```js
let periodEndUnix = currentPeriodEndUnix;
let subObj = null;

if (!periodEndUnix) {
  subObj = await stripe.subscriptions.retrieve(subscriptionId);
  periodEndUnix =
    subObj.current_period_end ||
    subObj.items?.data?.[0]?.current_period_end ||
    subObj.billing_cycle_anchor ||
    null;
}
const resetDate = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
```

* Tries to use the event’s period end if present.
* Falls back to a live fetch from Stripe when not present.
* Converts Unix seconds to a JavaScript `Date`.
* This `resetDate` anchors your monthly usage window so token counters can reset on the real billing boundary.

### Step 2: Idempotency guard

```js
const existing = await User.findOne({ email: customerEmail });
if (
  existing &&
  existing.subscriptionStatus === "active" &&
  existing.resetDate &&
  resetDate &&
  existing.resetDate.getTime() === resetDate.getTime()
) {
  log("Already active with same resetDate – skipping update");
  return;
}
```

* If the user is already active and the stored `resetDate` matches the computed date, the helper exits early.
* This prevents double writes when Stripe retries events or when two event types arrive for the same start.

### Step 3: Update only what is needed

```js
const update = { subscriptionStatus: "active", stripeCustomerId, resetDate };

const updated = await User.findOneAndUpdate(
  { email: customerEmail },
  update,
  { new: true, upsert: false }
);
```

* Sets the user to active, stores the Stripe customer id for future correlation, and records `resetDate`.
* `upsert: false` avoids creating phantom users if Stripe fires before your app has registered the account.
* Logs success or a warning if the email did not match any user. That is your signal to investigate sign-up timing.

### Error handling

```js
} catch (err) {
  error("activateUserSubscription error:", err.message);
}
```

* Wraps the whole operation, so a Stripe hiccup does not crash webhook processing.
* Logs the message for audit and retry analysis.

### Why this helper matters

* One source of truth for activation rules.
* Consistent `resetDate` calculation across different Stripe events.
* Built-in idempotency so webhook retries are safe.
* Clean separation between Stripe concerns and MongoDB updates.

### Quick checks you can run

* Call with only `currentPeriodEndUnix` set. Expect a direct update without an extra Stripe fetch.
* Call with `currentPeriodEndUnix` missing. Expect a subscription fetch and then update.
* Call twice with the same inputs. Expect the second call to log skip due to matching `resetDate`.
* Call with an email that is not in MongoDB. Expect a warning and no upsert.

---

## Module export

```js
module.exports = router;
```

* Exposes the Express router so `index.js` can mount it at `/webhook`.
* Keeps webhook code isolated from the main app boot logic, which simplifies testing and lets you mock the router in unit tests.

