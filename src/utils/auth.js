const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const verifyToken = async (token) => {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    return user;
  } catch (err) {
    // ❶ err is now used, so no-unused-vars is happy
    console.warn("🔒 Invalid or expired token:", err.message); 
    return null;
  }
};

module.exports = verifyToken;
