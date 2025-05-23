const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/User");

router.post(
  "/webhook",
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
      console.error("⚠️ Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerEmail = session.customer_email;
        const stripeCustomerId = session.customer;

        console.log("📥 Checkout session payload received!");
        console.log("📧 Email:", customerEmail);
        console.log("🆔 Stripe Customer ID:", stripeCustomerId);

        if (!customerEmail) {
          console.warn("⚠️ No email found in session.");
          break;
        }

        const updatedUser = await User.findOneAndUpdate(
          { email: customerEmail },
          {
            subscriptionStatus: "active",
            stripeCustomerId: stripeCustomerId,
          },
          { new: true } // ✅ return updated doc
        );

        if (updatedUser) {
          console.log("✅ User subscription activated:", updatedUser.email);
        } else {
          console.warn("❌ User not found in DB for email:", customerEmail);
        }

        break;
      }

      case "invoice.payment_failed": {
        const session = event.data.object;
        await User.findOneAndUpdate(
          { stripeCustomerId: session.customer },
          { subscriptionStatus: "inactive" }
        );
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

module.exports = router;
