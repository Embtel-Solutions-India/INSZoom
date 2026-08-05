require("dotenv").config();
const mongoose = require("mongoose");
const Case = require("../models/Case");
const participantService = require("../modules/cases/case-participant.service");

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/immigration_crm";
  await mongoose.connect(uri);
}

function migrateCase(caseData) {
  const before = caseData.participants?.length || 0;
  if (caseData.employerUser || caseData.companyId || caseData.employer || caseData.organization) {
    participantService.ensureParticipant(caseData, {
      role: "employer",
      userId: caseData.employerUser,
      companyId: caseData.companyId || caseData.employer || caseData.organization,
      name: caseData.petitionerName,
      status: "active",
      progress: { status: caseData.employerEmployeeWorkflow?.employerStatus || "not_started" },
    });
  }
  if (caseData.employeeUser || caseData.user || caseData.employeeInvite?.email || caseData.beneficiary) {
    participantService.ensureParticipant(caseData, {
      role: "employee",
      userId: caseData.employeeUser || caseData.user,
      beneficiaryId: caseData.beneficiary,
      email: caseData.employeeInvite?.email || caseData.clientEmail,
      name: caseData.employeeInvite?.name || caseData.clientName,
      phone: caseData.employeeInvite?.phone,
      status: caseData.employeeInvite?.status === "sent" ? "invited" : "active",
      invite: caseData.employeeInvite,
      progress: { status: caseData.employerEmployeeWorkflow?.employeeStatus || "not_started" },
    });
  }
  if (caseData.petitionerUser) {
    participantService.ensureParticipant(caseData, {
      role: "petitioner",
      userId: caseData.petitionerUser,
      status: "active",
      progress: { status: caseData.familyWorkflow?.petitionerStatus || "not_started" },
    });
  }
  if (caseData.beneficiaryUser || caseData.beneficiaryInvite?.email) {
    participantService.ensureParticipant(caseData, {
      role: "beneficiary",
      userId: caseData.beneficiaryUser || caseData.user,
      email: caseData.beneficiaryInvite?.email,
      name: caseData.beneficiaryInvite?.name,
      phone: caseData.beneficiaryInvite?.phone,
      status: caseData.beneficiaryInvite?.status === "sent" ? "invited" : "active",
      invite: caseData.beneficiaryInvite,
      progress: { status: caseData.familyWorkflow?.beneficiaryStatus || "not_started" },
    });
  }
  return { before, after: caseData.participants?.length || 0 };
}

async function run() {
  await connect();
  const cursor = Case.find({
    $or: [
      { participants: { $exists: false } },
      { participants: { $size: 0 } },
      { employeeUser: { $exists: true, $ne: null } },
      { employerUser: { $exists: true, $ne: null } },
      { "employeeInvite.email": { $exists: true, $ne: "" } },
      { petitionerUser: { $exists: true, $ne: null } },
      { beneficiaryUser: { $exists: true, $ne: null } },
    ],
  }).cursor();

  let scanned = 0;
  let updated = 0;
  for await (const caseData of cursor) {
    scanned += 1;
    const { before, after } = migrateCase(caseData);
    if (after > before || caseData.isModified("participants")) {
      await caseData.save();
      updated += 1;
    }
  }
  console.log(JSON.stringify({ success: true, scanned, updated }));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(JSON.stringify({ success: false, message: error.message, stack: error.stack }));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
