// Passport information is never optional in any checklist: the passport
// number, issue/expiry dates, country of issuance, "valid passport" answers
// and every passport copy upload are always required (a question that is
// conditionally hidden is simply not asked, so it is not demanded either).
// Passport PHOTOS and questions about applying for / holding a second
// nationality's passport are not passport information, so they are left
// alone.
const NOT_PASSPORT_INFORMATION = /photo|nationalityDetails|everApplied|previouslyApplied|CertOrPassport/i;

function isPassportInformation(question = {}) {
  const text = `${question.key || ""} ${question.label || ""}`;
  return /passport/i.test(text) && !NOT_PASSPORT_INFORMATION.test(text);
}

module.exports = { isPassportInformation };
