require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const env = require("../config/env");
const { assertDemoSeedAllowed } = require("./demoSeedGuard");

const users = [
  {
    name: "Super Admin",
    email: "superadmin@inszoom.com",
    password: "SuperAdmin123",
    role: "super_admin",
    department: "Management",
  },
  {
    name: "Admin User",
    email: "admin@inszoom.com",
    password: "Admin123",
    role: "admin",
    department: "Operations",
  },
  {
    name: "David Team Lead",
    email: "teamlead@inszoom.com",
    password: "TeamLead123",
    role: "team_lead",
    department: "Case Management",
  },
  {
    name: "John Case Manager",
    email: "casemanager@inszoom.com",
    password: "CaseManager123",
    role: "case_manager",
    department: "Case Management",
  },
  {
    name: "Second Case Manager",
    email: "casemanager2@inszoom.com",
    password: "CaseManager123",
    role: "case_manager",
    department: "Case Management",
  },
  {
    name: "Acme Corp Employer",
    email: "employer@inszoom.com",
    password: "Employer123",
    role: "employer",
    department: "Employer",
  },
  {
    name: "Priya Employee",
    email: "employee@inszoom.com",
    password: "Employee123",
    role: "employee",
    department: "Employee",
  },
  {
    name: "John Smith Client",
    email: "john.smith@email.com",
    password: "Client123",
    role: "client",
    department: "Client",
  },
  {
    name: "Jane Doe Client",
    email: "jane.doe@email.com",
    password: "Client123",
    role: "client",
    department: "Client",
  },
  {
    name: "Carlos Rivera",
    email: "carlos.rivera@email.com",
    password: "Client123",
    role: "client",
    department: "Client",
  },
  {
    name: "Aisha Khan",
    email: "aisha.khan@email.com",
    password: "Client123",
    role: "client",
    department: "Client",
  },
  {
    name: "Wei Zhang",
    email: "wei.zhang@email.com",
    password: "Client123",
    role: "client",
    department: "Client",
  },
];

async function seedUsers() {
  const created = {};

  for (const userData of users) {
    let user = await User.findOne({ email: userData.email }).select("+password");
    if (user) {
      user.name = user.name || userData.name;
      user.displayName = user.displayName || userData.name;
      user.role = user.role || userData.role;
      user.department = user.department || userData.department;
      user.isActive = true;
      if (!user.password) user.password = userData.password;
      await user.save();
    } else {
      user = await User.create({
        ...userData,
        displayName: userData.name,
        isActive: true,
        isEmailVerified: true,
        isDemoData: true,
      });
    }
    created[userData.email] = user;
  }

  console.log("Shared backend dummy users are ready:");
  users.forEach((user) => {
    console.log(`${user.email} (${user.role})`);
  });

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
