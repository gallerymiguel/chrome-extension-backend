// utils/limiter.js
async function checkAndResetUsage(
  user,
  incrementBy = 1000,
  monthlyLimit = 8000
) {
  const now = new Date();

  /* ───── Reset logic ──────────────────────────────────────────
     • Only trigger if the user already has a resetDate **and**
       we’ve passed it.
     • After the reset, push resetDate forward one month (you can
       tweak the interval if you bill differently).
  ----------------------------------------------------------------*/
  if (user.resetDate && now > user.resetDate) {
    user.usageCount = 0;
    user.resetDate  = new Date(now.setMonth(now.getMonth() + 1));
    console.log("🔄 Monthly usage reset; next resetDate:", user.resetDate);
  }

  /* ───── Limit guard ────────────────────────────────────────── */
  if (user.usageCount + incrementBy > monthlyLimit) {
    throw new Error("❌ Monthly usage limit reached. Try again next cycle.");
  }

  /* ───── Add the new usage ─────────────────────────────────── */
  user.usageCount += incrementBy;

  console.log("💾 Saving updated usage:", {
    usageCount: user.usageCount,
    resetDate:  user.resetDate,
  });

  try {
    await user.save();
    console.log("✅ User saved to MongoDB.");
  } catch (e) {
    console.error("❌ Failed to save user:", e);
  }
}

module.exports = { checkAndResetUsage };
