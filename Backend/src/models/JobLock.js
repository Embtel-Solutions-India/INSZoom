const mongoose = require("mongoose");

// Backs withJobLock() in utils/jobLock.js — one document per named recurring
// job, claimed atomically so a slow tick can never overlap with the next
// setInterval fire, whether that fire comes from the same process or (if the
// backend is ever scaled horizontally) another instance sharing this DB.
const jobLockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    lockedAt: { type: Date, required: true },
    lockedUntil: { type: Date, required: true },
    // Ownership fencing token for the current holder — see jobLock.js's
    // renewLock/releaseLock for why a bare name+lockedUntil isn't enough.
    token: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JobLock", jobLockSchema);
