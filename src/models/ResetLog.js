// models/ResetLog.js
const mongoose = require("mongoose");

const resetLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  usageAtReset: {
    type: Number,
    required: true,
  },
  resetDate: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ResetLog", resetLogSchema);
