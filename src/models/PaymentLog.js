const mongoose = require('mongoose');

const paymentLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true, // Optional: Faster lookups
  },
  type: {
    type: String,
    enum: ['subscription', 'donation'],
    required: true,
    default: 'subscription',
  },
  amount: {
    type: Number,
    required: true,
    min: 0, // Prevent negative amounts
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('PaymentLog', paymentLogSchema);
