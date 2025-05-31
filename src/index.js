require("dotenv").config();
const express = require("express");
const { ApolloServer } = require("apollo-server-express");
const connectDB = require("./config/db");
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const verifyToken = require("./utils/auth");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 4000;
app.set("trust proxy", 1);

// 🔌 Connect to MongoDB
connectDB();

// ✅ Stripe webhook body parser MUST come BEFORE express.json
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("📥 Stripe event received:", event.type);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerEmail = session.customer_email;
      const stripeCustomerId = session.customer;

      const updatedUser = await User.findOneAndUpdate(
        { email: customerEmail },
        {
          subscriptionStatus: "active",
          stripeCustomerId: stripeCustomerId,
        }
      );

      if (updatedUser) {
        console.log("✅ User subscription activated:", updatedUser.email);
      } else {
        console.warn("⚠️ User not found for email:", customerEmail);
      }
      break;
    }

    case "invoice.paid":
      console.log("💰 Invoice paid!");
      break;
    case "invoice.payment_failed":
      console.log("❌ Payment failed!");
      break;
    case "customer.subscription.deleted":
      console.log("🔁 Subscription cancelled.");
      break;
    default:
      console.log(`ℹ️ Event type: ${event.type}`);
  }

  res.status(200).json({ received: true });
});

// 🛡 Middleware for everything ELSE (AFTER webhook)
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        "https://next-auth-reset.vercel.app", // ✅ Your deployed frontend
        "http://localhost:3000",              // ✅ Local dev frontend (optional)
      ];

      if (
        !origin || 
        origin.startsWith("chrome-extension://") || 
        origin === "null" || 
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
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
app.options("*", cors()); // Fallback CORS

// 🧠 Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const token = req.headers.authorization || "";
    if (!token) return { user: null };

    try {
      console.log("🪪 Received Authorization header:", token);
      const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
      console.log("🧾 Decoded JWT:", decoded);
      const user = await User.findById(decoded.id);
      console.log("🔍 Fetched user:", user);
      return { user };
    } catch (err) {
      console.warn("🔒 Invalid token in context:", err.message);
      return { user: null };
    }
  },
});

async function startServer() {
  await server.start();

  server.applyMiddleware({
    app,
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin.startsWith("chrome-extension://") || origin === "null") {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    },
  });

  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}${server.graphqlPath}`);
  });
}

startServer();
