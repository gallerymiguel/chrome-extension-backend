const User = require("../models/User");
// const PaymentLog = require("../models/PaymentLog");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcrypt");
const { checkAndResetUsage } = require("../utils/limiter.js");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

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

  Mutation: {
    // Start a subscription using Stripe Checkout
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
    },

    incrementUsage: async (_, { amount }, { user }) => {
      if (!user) throw new Error("Unauthorized");
      const foundUser = await User.findById(user._id);
      if (!foundUser) throw new Error("User not found");
      await checkAndResetUsage(foundUser, amount);
      return true;
    },

    register: async (_, { email, password }) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) throw new Error("User already exists");

      console.log("REGISTER: Raw password:", password);

      // Password strength check
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=<>?/{}[\]~]).{8,}$/;
      if (!passwordRegex.test(password)) {
        throw new Error(
          "Password must be at least 8 characters, include 1 uppercase, 1 lowercase, 1 number, and 1 symbol."
        );
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      console.log("REGISTER: Hashed password:", hashedPassword);

      const newUser = await User.create({
        email,
        password: hashedPassword,
        subscriptionStatus: "inactive",
        usageCount: 0,
      });
      console.log("✅ New user created:", newUser.email);

      const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      return token;
    },

    login: async (_, { email, password }) => {
      const user = await User.findOne({ email });
      if (!user) throw new Error("Invalid credentials");
      console.log("LOGIN: Input password:", password);
      console.log("LOGIN: DB hashed password:", user.password);
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) throw new Error("Invalid credentials");

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      return token;
    },

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
    },
  },
};
