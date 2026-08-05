const mongoose = require("mongoose");
const env = require("../config/env");
const Case = require("../models/Case");

const INDEXES = [
  { key: { primaryOwner: 1, createdAt: -1 }, name: "primaryOwner_1_createdAt_-1" },
  { key: { secondaryOwner: 1, createdAt: -1 }, name: "secondaryOwner_1_createdAt_-1" },
  { key: { assignedTeamLead: 1, createdAt: -1 }, name: "assignedTeamLead_1_createdAt_-1" },
  { key: { assignedCaseManager: 1, createdAt: -1 }, name: "assignedCaseManager_1_createdAt_-1" },
  { key: { teamId: 1, createdAt: -1 }, name: "teamId_1_createdAt_-1" },
];

async function main() {
  await mongoose.connect(env.mongoUri);
  const result = await Case.collection.createIndexes(INDEXES);
  console.log("Case list indexes ensured:", result);
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Failed to create case list indexes:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
