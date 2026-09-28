require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Case = require("../models/Case");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const stamp = Date.now();
  const email = `p4-employer-${stamp}@example.com`;
  const password = "TestPass123!@#";

  // Reuse the real create-case HTTP endpoint via fetch so the whole
  // atomic transaction (principal + N child cases + EmployerProfile +
  // EmployeeProfile per child) runs exactly as production does.
  const loginRes = await fetch("http://localhost:7000/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.argv[2], password: process.argv[3] }),
  });
  const { token } = await loginRes.json();
  const createRes = await fetch("http://localhost:7000/api/cases", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: "Visual Test Employer", clientEmail: email,
      visaType: "E-3", childCaseCount: 2, employerCompletionMode: "employer_completes",
      employerName: "Visual Test LLC", employerEmail: `visual-employer-${stamp}@example.com`,
    }),
  });
  const createBody = await createRes.json();
  if (!createBody.success) { console.log("CREATE FAILED", JSON.stringify(createBody)); process.exit(1); }
  const principalId = createBody.case._id;

  const user = await User.findOne({ email });
  user.password = password;
  user.mustSetPassword = false;
  user.isActive = true;
  user.isEmailVerified = true;
  await user.save();

  console.log(JSON.stringify({ principalId, email, password, caseNumber: createBody.case.caseNumber }));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
