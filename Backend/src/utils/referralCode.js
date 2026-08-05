const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += ALPHABET[bytes[index] % ALPHABET.length];
  }
  return `USA${output}`;
}

async function generateUniqueReferralCode(User) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  return randomCode(10);
}

module.exports = { randomCode, generateUniqueReferralCode };
