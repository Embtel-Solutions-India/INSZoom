require("dotenv").config();

const mongoose = require("mongoose");
const Company = require("../models/Company");
const Client = require("../models/Client");
const User = require("../models/User");
const env = require("../config/env");
const seedUsers = require("./seedUsers");
const { assertDemoSeedAllowed } = require("./demoSeedGuard");

async function seedCompany(users) {
  const employer = users["employer@inszoom.com"];

  let company = await Company.findOne({ ein: "12-3456789" });
  if (!company) {
    company = await Company.create({
      name: "Acme Corporation",
      legalName: "Acme Corporation Inc.",
      ein: "12-3456789",
      industry: "Software",
      numberOfEmployees: 250,
      website: "https://acme.example.com",
      status: "active",
      address: {
        street: "123 Market Street",
        city: "San Francisco",
        state: "CA",
        zipCode: "94105",
        country: "USA",
        isPrimary: true,
      },
      contact: { phone: "415-555-0100", email: "hr@acme.example.com" },
      hrManager: employer?._id,
      hrUsers: employer ? [employer._id] : [],
      source: "shared",
      isDemoData: true,
    });
  }

  // canAccessCase()'s employer branch checks user.companyId against the case's
  // companyId, so the employer test account needs to actually belong to this company.
  if (employer && !employer.companyId) {
    await User.updateOne({ _id: employer._id }, { $set: { companyId: company._id } });
  }

  return company;
}

async function seedClients(users) {
  const company = await seedCompany(users);

  const clientSeeds = [
    {
      email: "john.smith@email.com",
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1990-04-12",
      gender: "male",
      countryOfBirth: "India",
      countryOfCitizenship: "India",
      nationality: "Indian",
      primaryPhone: "212-555-0110",
      address: "45 Lexington Ave",
      city: "New York",
      state: "NY",
      zipCode: "10010",
      country: "USA",
      visaCategory: "H-1B",
      visaType: "H-1B",
      currentVisaStatus: "F-1 OPT",
      status: "active",
      assignedCaseManager: users["casemanager@inszoom.com"]?._id,
      companyId: company._id,
    },
    {
      email: "jane.doe@email.com",
      firstName: "Jane",
      lastName: "Doe",
      dateOfBirth: "1988-09-23",
      gender: "female",
      countryOfBirth: "Philippines",
      countryOfCitizenship: "Philippines",
      nationality: "Filipino",
      primaryPhone: "312-555-0199",
      address: "900 W Madison St",
      city: "Chicago",
      state: "IL",
      zipCode: "60607",
      country: "USA",
      visaCategory: "L-1A",
      visaType: "L-1A",
      currentVisaStatus: "L-1A",
      status: "active",
      assignedCaseManager: users["casemanager2@inszoom.com"]?._id,
      companyId: company._id,
    },
    {
      email: "carlos.rivera@email.com",
      firstName: "Carlos",
      lastName: "Rivera",
      dateOfBirth: "1992-01-30",
      gender: "male",
      countryOfBirth: "Mexico",
      countryOfCitizenship: "Mexico",
      nationality: "Mexican",
      primaryPhone: "713-555-0142",
      address: "500 Travis St",
      city: "Houston",
      state: "TX",
      zipCode: "77002",
      country: "USA",
      visaCategory: "O-1",
      visaType: "O-1",
      currentVisaStatus: "O-1",
      status: "active",
      assignedCaseManager: users["casemanager@inszoom.com"]?._id,
      companyId: company._id,
    },
    {
      email: "aisha.khan@email.com",
      firstName: "Aisha",
      lastName: "Khan",
      dateOfBirth: "1991-07-08",
      gender: "female",
      countryOfBirth: "Pakistan",
      countryOfCitizenship: "Pakistan",
      nationality: "Pakistani",
      primaryPhone: "617-555-0177",
      address: "10 Boylston St",
      city: "Boston",
      state: "MA",
      zipCode: "02116",
      country: "USA",
      visaCategory: "EB-2 NIW",
      visaType: "EB-2 NIW",
      currentVisaStatus: "H-1B",
      status: "active",
      assignedCaseManager: users["casemanager2@inszoom.com"]?._id,
      companyId: company._id,
    },
    {
      email: "wei.zhang@email.com",
      firstName: "Wei",
      lastName: "Zhang",
      dateOfBirth: "1985-11-19",
      gender: "male",
      countryOfBirth: "China",
      countryOfCitizenship: "China",
      nationality: "Chinese",
      primaryPhone: "206-555-0163",
      address: "1201 3rd Ave",
      city: "Seattle",
      state: "WA",
      zipCode: "98101",
      country: "USA",
      visaCategory: "PERM",
      visaType: "PERM",
      currentVisaStatus: "H-1B",
      status: "active",
      assignedCaseManager: users["casemanager@inszoom.com"]?._id,
      companyId: company._id,
    },
  ];

  const created = {};

  for (const clientData of clientSeeds) {
    const userAccount = users[clientData.email];
    let client = await Client.findOne({ email: clientData.email });
    if (!client) {
      client = await Client.create({
        ...clientData,
        user: userAccount?._id,
        isDemoData: true,
      });
    } else if (userAccount && !client.user) {
      client.user = userAccount._id;
      await client.save();
    }
    created[clientData.email] = client;
  }

  console.log("Shared backend dummy company + clients are ready:");
  console.log(`${company.name} (${company.ein})`);
  clientSeeds.forEach((c) => console.log(`${c.email} (${c.visaType})`));

  return { company, clients: created };
}

module.exports = seedClients;

if (require.main === module) {
  assertDemoSeedAllowed();
  mongoose
    .connect(env.mongoUri)
    .then(async () => {
      const users = await seedUsers();
      await seedClients(users);
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed shared clients:", error);
      process.exit(1);
    });
}
