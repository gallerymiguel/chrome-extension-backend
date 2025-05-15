async function checkAndResetUsage(
  user,
  incrementBy = 1000,
  monthlyLimit = 8000
) {
  const now = new Date();

  if (!user.resetDate || now > user.resetDate) {
    user.usageCount = 0;
    user.resetDate = getNextResetDate(user.email);
  }

  if (user.usageCount + incrementBy > monthlyLimit) {
    throw new Error("❌ Monthly usage limit reached. Try again next cycle.");
  }

  user.usageCount += incrementBy;

  // ✅ Log what's about to be saved
  console.log("💾 Saving updated usage:", {
    usageCount: user.usageCount,
    resetDate: user.resetDate,
  });
  console.log("🕓 Now:", now);
  console.log("📅 Current resetDate:", user.resetDate);

  // ✅ Actually persist the update
  try {
    await user.save();
    console.log("✅ User saved to MongoDB.");
  } catch (e) {
    console.error("❌ Failed to save user:", e);
  }
}

function getNextResetDate(userEmail = "unknown") {
  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1);
  console.log(
    `🔄 Resetting usage for ${userEmail}. Next reset at: ${nextReset}`
  );
  return nextReset;
  
}

module.exports = { checkAndResetUsage };
