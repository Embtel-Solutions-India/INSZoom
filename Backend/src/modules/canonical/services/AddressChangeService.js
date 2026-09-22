// Captures a participant's OUTGOING (about-to-be-replaced) canonical
// address into that participant's own historical address record, at the
// exact moment a Case Manager approves a Change of Address submission -
// see case.controller.js's approveChangeOfAddress and
// changeOfAddressChecklist.js's file banner for the full design rationale.
//
// Deliberately reuses the existing addressHistory array already present on
// Beneficiary.js/Client.js (read generically by
// CanonicalBuilderService.js:381 - `profile.addressHistory = ... ||
// beneficiary.addressHistory || []`, so any USCIS form that already asks
// for a "previous address" can resolve it the same way it always has) and
// the new EmployerProfile.canonicalData.address.addressHistory (added
// alongside this feature, same shape). No second history/audit system.
//
// petitioner/joint_sponsor have no dedicated participant model to hold a
// structured addressHistory today (confirmed via inspection - family-
// workflow cases have no Company/EmployerProfile/Beneficiary-equivalent
// record for these two roles). For those two roles this is a deliberate,
// smaller-scope no-op: CanonicalProfileService.rebuild()'s own existing
// CanonicalHistoryService/canonicalHistory audit trail (Case.js:963,
// already populated on every rebuild via CanonicalComparisonService.compare)
// still records the change generically - just not as a form-mappable
// "previous address" field, since no USCIS form asks for a petitioner's or
// joint sponsor's prior address the way I-485/N-400 ask for the
// beneficiary's.
const Case = require("../../../models/Case");
const Beneficiary = require("../../../models/Beneficiary");
const Client = require("../../../models/Client");
const EmployerProfile = require("../../../models/EmployerProfile");

const CANONICAL_PREFIX_BY_TARGET_ROLE = {
  employee: "contact",
  beneficiary: "contact",
  client: "contact",
  employer: "company",
  petitioner: "petitioner",
  joint_sponsor: "jointSponsor",
};

function toHistoryEntry(address) {
  return {
    street: address.line1 || "",
    street2: address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    zipCode: address.zip || "",
    country: address.country || "",
    toDate: new Date().toISOString().slice(0, 10),
    current: false,
  };
}

function isNonEmptyAddress(address) {
  return Boolean(address && (address.line1 || address.city || address.state || address.zip));
}

// Returns the captured history entry, or null if there was nothing to
// preserve (a brand-new case with no address on file yet) or the role has
// no backing history record (petitioner/joint_sponsor - see file banner).
async function captureOutgoingAddress(caseId, { targetRole }, user, req) {
  const canonicalPrefix = CANONICAL_PREFIX_BY_TARGET_ROLE[targetRole];
  if (!canonicalPrefix) return null;

  const caseRecord = await Case.findById(caseId);
  if (!caseRecord) return null;

  const currentAddress = caseRecord.canonicalProfile?.profile?.[canonicalPrefix]?.address;
  if (!isNonEmptyAddress(currentAddress)) return null;
  const historyEntry = toHistoryEntry(currentAddress);

  if (canonicalPrefix === "contact") {
    if (caseRecord.beneficiary) {
      await Beneficiary.findByIdAndUpdate(caseRecord.beneficiary, { $push: { addressHistory: historyEntry } });
      return historyEntry;
    }
    if (caseRecord.user) {
      const client = await Client.findOne({ user: caseRecord.user }).select("_id");
      if (client) {
        await Client.updateOne({ _id: client._id }, { $push: { addressHistory: historyEntry } });
        return historyEntry;
      }
    }
    return null;
  }

  if (canonicalPrefix === "company") {
    if (!caseRecord.employerProfileId) return null;
    await EmployerProfile.updateOne(
      { _id: caseRecord.employerProfileId },
      { $push: { "canonicalData.address.addressHistory": historyEntry } }
    );
    return historyEntry;
  }

  // petitioner / joint_sponsor - no dedicated model; the generic
  // CanonicalHistoryService audit trail (already run on every
  // CanonicalProfileService.rebuild()) is the history for these two roles.
  return null;
}

module.exports = { captureOutgoingAddress, CANONICAL_PREFIX_BY_TARGET_ROLE };
