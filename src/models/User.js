const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  subscriptionStatus: { type: String, default: 'inactive' },
  usageCount: { type: Number, default: 0 },
  stripeCustomerId: { type: String },
  resetDate: { type: Date }, 
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
});

module.exports = mongoose.model('User', userSchema);
