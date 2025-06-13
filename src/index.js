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
// const bodyParser = require("body-parser");
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const webhookRouter = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 4000;
app.set("trust proxy", 1);
module.exports = app;

// 🔌 Connect to MongoDB
connectDB();
app.use("/webhook", webhookRouter);
// 🛡️ --- ADD CORS LOGGING + HEADER FIX HERE ---
const allowedOrigins = [
  "chrome-extension://bipdnlldaogehgnkegeifojojobendca",
  process.env.CLIENT_URL,
  "http://localhost:3000",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  next();
});

// ✅ CORS Middleware (as before)
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
app.options("*", cors()); // fallback

// 🧠 Apollo Server
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
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    },
  });

  if (require.main === module) {
    // run only when `node index.js`
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  }
}

startServer();
