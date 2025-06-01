const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    match: [/.+\@.+\..+/, "Invalid email format"],
  },
  password: { type: String, required: true },
  subscriptionStatus: {
    type: String,
    enum: ["active", "inactive", "refunded", "cancelled"],
    default: "inactive",
  },
  usageCount: { type: Number, default: 0 },
  stripeCustomerId: { type: String },
  resetDate: { type: Date },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
});

// 🔒 Password hashing
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ✅ Password comparison method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
