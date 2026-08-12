require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");
const { assertDemoSeedAllowed } = require("./demoSeedGuard");

// Demo users are provisioned separately and persist only in MongoDB. Keep
// their identifiers here so dependent demo-data seeds can link records, but
// never keep passwords or create accounts from source code.
const userEmails = [
  "superadmin@inszoom.com",
  "admin@inszoom.com",
  "teamlead@inszoom.com",
  "casemanager@inszoom.com",
  "casemanager2@inszoom.com",
  "employer@inszoom.com",
  "employee@inszoom.com",
  "john.smith@email.com",
  "jane.doe@email.com",
  "carlos.rivera@email.com",
  "aisha.khan@email.com",
  "wei.zhang@email.com",
];

async function seedUsers() {
  const created = {};

  const existingUsers = await User.find({ email: { $in: userEmails } });
  for (const user of existingUsers) {
    created[user.email] = user;
  }

  const missingEmails = userEmails.filter((email) => !created[email]);
  if (missingEmails.length) {
    throw new Error(`Required seed users are missing from MongoDB: ${missingEmails.join(", ")}`);
  }

  console.log(`Loaded ${existingUsers.length} existing seed users from MongoDB.`);

  return created;
}

module.exports = seedUsers;

if (require.main === module) {
  assertDemoSeedAllowed();
  mongoose
    .connect(env.mongoUri)
    .then(() => seedUsers())
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed shared users:", error);
      process.exit(1);
    });
}
