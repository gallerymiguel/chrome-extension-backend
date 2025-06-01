const mongoose = require("mongoose");

const resetLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true, // Optional: Faster queries
  },
  usageAtReset: {
    type: Number,
    required: true,
    min: 0, // Prevent negatives
  },
  resetDate: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ResetLog", resetLogSchema);
