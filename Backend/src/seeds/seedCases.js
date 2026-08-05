require("dotenv").config();

const mongoose = require("mongoose");
const Case = require("../models/Case");
const env = require("../config/env");
const seedUsers = require("./seedUsers");
const seedClients = require("./seedClients");

const DAY_MS = 24 * 60 * 60 * 1000;

const caseSeeds = [
  {
    caseNumber: "SEED-2026-00001",
    clientEmail: "john.smith@email.com",
    visaType: "H-1B",
    petitionType: "H-1B",
    package: "full_service",
    stage: "intake",
    status: "assigned",
    priority: "high",
    daysAgo: 5,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
    linkEmployment: true,
  },
  {
    caseNumber: "SEED-2026-00002",
    clientEmail: "jane.doe@email.com",
    visaType: "L-1A",
    petitionType: "L-1A",
    package: "guided_review",
    stage: "documents_pending",
    status: "document_collection",
    priority: "medium",
    daysAgo: 12,
    assignedCaseManagerEmail: "casemanager2@inszoom.com",
    linkEmployment: true,
  },
  {
    caseNumber: "SEED-2026-00003",
    clientEmail: "john.smith@email.com",
    visaType: "I-485",
    petitionType: "I-485",
    package: "full_service",
    stage: "evidence",
    status: "in_review",
    priority: "medium",
    daysAgo: 25,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00004",
    clientEmail: "jane.doe@email.com",
    visaType: "EB-2 NIW",
    petitionType: "I-140",
    package: "full_service",
    stage: "form_preparation",
    status: "form_preparation",
    priority: "high",
    daysAgo: 40,
    assignedCaseManagerEmail: "casemanager2@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00005",
    clientEmail: "carlos.rivera@email.com",
    visaType: "O-1",
    petitionType: "O-1",
    package: "full_service",
    stage: "filing",
    status: "filed",
    priority: "urgent",
    daysAgo: 60,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00006",
    clientEmail: "aisha.khan@email.com",
    visaType: "EB-2 NIW",
    petitionType: "I-140",
    package: "guided_review",
    stage: "legal_review",
    status: "under_review",
    priority: "medium",
    daysAgo: 75,
    assignedCaseManagerEmail: "casemanager2@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00007",
    clientEmail: "wei.zhang@email.com",
    visaType: "PERM",
    petitionType: "PERM",
    package: "full_service",
    stage: "rfe",
    status: "rfe",
    priority: "high",
    daysAgo: 90,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00008",
    clientEmail: "wei.zhang@email.com",
    visaType: "I-140",
    petitionType: "I-140",
    package: "full_service",
    stage: "approved",
    status: "approved",
    priority: "medium",
    daysAgo: 110,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00009",
    clientEmail: "carlos.rivera@email.com",
    visaType: "TN",
    petitionType: "TN",
    package: "self_file",
    stage: "closed",
    status: "closed",
    priority: "low",
    daysAgo: 130,
    assignedCaseManagerEmail: "casemanager@inszoom.com",
  },
  {
    caseNumber: "SEED-2026-00010",
    clientEmail: "aisha.khan@email.com",
    visaType: "H-1B",
    petitionType: "H-1B",
    package: "guided_review",
    stage: "waiting_for_client",
    status: "on_hold",
    priority: "low",
    daysAgo: 150,
    assignedCaseManagerEmail: "casemanager2@inszoom.com",
  },
];

async function seedCases() {
  const users = await seedUsers();
  const { company, clients } = await seedClients(users);

  const created = {};
  const now = Date.now();

  for (const seed of caseSeeds) {
    const client = clients[seed.clientEmail];
    const clientUser = users[seed.clientEmail];

    let caseDoc = await Case.findOne({ caseNumber: seed.caseNumber });
    if (!caseDoc) {
      caseDoc = await Case.create({
        caseNumber: seed.caseNumber,
        user: clientUser?._id,
        clientProfile: client?._id,
        clientName: clientUser?.name,
        clientEmail: seed.clientEmail,
        visaType: seed.visaType,
        visaCategory: seed.visaType,
        caseType: "immigration",
        petitionType: seed.petitionType,
        package: seed.package,
        stage: seed.stage,
        status: seed.status,
        priority: seed.priority,
        employer: company?._id,
        organization: company?._id,
        companyId: company?._id,
        employerUser: seed.linkEmployment ? users["employer@inszoom.com"]?._id : undefined,
        employeeUser: seed.linkEmployment ? users["employee@inszoom.com"]?._id : undefined,
        createdBy: users[seed.assignedCaseManagerEmail]?._id,
        assignedCaseManager: users[seed.assignedCaseManagerEmail]?._id,
        assignedTeamLead: users["teamlead@inszoom.com"]?._id,
        primaryOwner: users[seed.assignedCaseManagerEmail]?._id,
      });

      // Bypass mongoose timestamps middleware so seeded cases carry a realistic,
      // staggered creation history for analytics/time-series charts.
      await Case.collection.updateOne(
        { _id: caseDoc._id },
        { $set: { createdAt: new Date(now - seed.daysAgo * DAY_MS) } }
      );
    }
    created[seed.caseNumber] = caseDoc;
  }

  console.log("Shared backend dummy cases are ready:");
  caseSeeds.forEach((c) => console.log(`${c.caseNumber} (${c.visaType}) -> ${c.clientEmail} [${c.status}]`));

  return created;
}

module.exports = seedCases;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedCases())
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed shared cases:", error);
      process.exit(1);
    });
}
