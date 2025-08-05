// routes/webhook.js
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

    switch (event.type) {
      /* ────────────────────────────────
         When Checkout finishes in “subscription” mode
      ─────────────────────────────────*/
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

      /* ────────────────────────────────
         Fired any time a subscription is created,
         even if NOT through Checkout
      ─────────────────────────────────*/
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

      /* ── invoice failed: pause benefits ───────────────────────── */
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

      /* ── subscription cancelled outright ──────────────────────── */
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
      }

      default:
      // log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

/* ───────────────────────────────────────────────────────────
   Shared helper so the logic for activating a user lives once
   ──────────────────────────────────────────────────────────*/
async function activateUserSubscription({
  customerEmail,
  stripeCustomerId,
  subscriptionId,
  currentPeriodEndUnix,
}) {
  try {
    /* 1️⃣ Always determine the Unix period end first */
    let periodEndUnix = currentPeriodEndUnix; // may be undefined
    let subObj = null;

    if (!periodEndUnix) {
      subObj = await stripe.subscriptions.retrieve(subscriptionId);
      periodEndUnix =
        subObj.current_period_end ||
        subObj.items?.data?.[0]?.current_period_end ||
        subObj.billing_cycle_anchor ||
        null; // could still be null
    }
    const resetDate = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

    /* 2️⃣ Idempotency guard AFTER we know the date */
    const existing = await User.findOne({ email: customerEmail });
    if (
      existing &&
      existing.subscriptionStatus === "active" &&
      existing.resetDate &&
      resetDate &&
      existing.resetDate.getTime() === resetDate.getTime()
    ) {
      log("ℹ️ Already active with same resetDate – skipping update");
      return;
    }

    /* 3️⃣ Perform the update only if needed */
    const update = {
      subscriptionStatus: "active",
      stripeCustomerId,
      resetDate,
    };

    const updated = await User.findOneAndUpdate(
      { email: customerEmail },
      update,
      {
        new: true,
        upsert: false,
      }
    );

    if (updated) {
      log("✅ User subscription activated:", updated.email);
    } else {
      warn("❌ No user found for email:", customerEmail);
    }
  } catch (err) {
    error("❌ activateUserSubscription error:", err.message);
  }
}

module.exports = router;
