const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  console.log('🔍 MONGO_URI =', uri);

  if (uri) {
    try {
      await mongoose.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('✅ MongoDB connected');
    } catch (err) {
      console.error('❌ MongoDB connection failed:', err.message);
      // don’t exit here—just log
    }
  } else {
    console.warn('⚠️  No MONGO_URI set; skipping DB connection');
  }
};

module.exports = connectDB;
