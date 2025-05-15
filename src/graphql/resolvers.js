const User = require("../models/User");
const PaymentLog = require("../models/PaymentLog");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcrypt");
const { checkAndResetUsage } = require("../utils/limiter.js");

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
    // Handle donations using Stripe Checkout
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

    // Increment usage count for the user
    incrementUsage: async (_, { amount }, { user }) => {
      if (!user) throw new Error("Unauthorized");

      const foundUser = await User.findById(user._id);
      if (!foundUser) throw new Error("User not found");

      console.log("📥 Incrementing usage by:", amount);

      await checkAndResetUsage(foundUser, amount);
      console.log("✅ User saved to MongoDB.");
      return true;
    },
    // Register a new user and return a JWT token
    register: async (_, { email, password }) => {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new Error("User already exists");
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await User.create({
        email,
        password: hashedPassword,
        subscriptionStatus: "none",
        usageCount: 0,
      });

      const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return token;
    },
    // Login an existing user and return a JWT token
    login: async (_, { email, password }) => {
      const user = await User.findOne({ email });
      if (!user) {
        throw new Error("Invalid credentials");
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        throw new Error("Invalid credentials");
      }

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return token;
    },
  },
};
