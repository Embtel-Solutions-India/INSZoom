require("dotenv").config();

const mongoose = require("mongoose");
const env = require("../config/env");
const seedCases = require("./seedCases");

async function seedAll() {
  await mongoose.connect(env.mongoUri);
  await seedCases(); // seedCases -> seedClients -> seedUsers, run in dependency order
  await mongoose.disconnect();
}

if (require.main === module) {
  seedAll()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed database:", error);
      process.exit(1);
    });
}

module.exports = seedAll;
