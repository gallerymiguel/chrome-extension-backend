const mongoose = require('mongoose');

const TEST_ALLOWED_MONGO_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const getMongoHostname = (uri) => {
  try {
    const parsedUri = new URL(uri);

    if (!["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol)) {
      return null;
    }

    return parsedUri.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
};

const assertSafeTestMongoUri = (uri) => {
  if (process.env.NODE_ENV !== "test") {
    return;
  }

  const hostname = getMongoHostname(uri);

  if (!hostname || !TEST_ALLOWED_MONGO_HOSTS.has(hostname)) {
    throw new Error("Refusing to connect to non-local MongoDB during tests");
  }
};

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  console.log("MongoDB URI configured:", Boolean(uri));

  if (uri) {
    assertSafeTestMongoUri(uri);

    try {
      await mongoose.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("MongoDB connected");
    } catch (err) {
      console.error("MongoDB connection failed:", err.message);
      // Do not exit here. Some local/dev flows can still boot without DB.
    }
  } else {
    console.warn("No MONGO_URI set; skipping DB connection");
  }
};

module.exports = connectDB;
