// USCIS filing-address book, keyed by PackageDefinition.filingAddressKey.
// USCIS changes lockbox addresses periodically (by form, service center
// jurisdiction, premium processing, and filing method) — these are
// representative starting values, not a guarantee of current accuracy.
// Treat this file as admin-editable config, not code: an admin must verify
// against the current uscis.gov filing-address pages before relying on it
// for a real filing, and update this map (or its future DB-backed
// replacement) when USCIS publishes a change. Never hardcode an address
// inline elsewhere — always resolve through this module.

const FILING_ADDRESSES = {
  i129_h1b: {
    label: "USCIS — Form I-129 (H-1B)",
    usps: {
      name: "USCIS",
      line1: "P.O. Box 660611",
      city: "Dallas",
      state: "TX",
      zip: "75266",
    },
    courier: {
      name: "USCIS",
      line1: "Attn: I-129 H-1B",
      line2: "2501 S. State Hwy. 121 Business, Suite 400",
      city: "Lewisville",
      state: "TX",
      zip: "75067",
    },
  },
  i129_l1: {
    label: "USCIS — Form I-129 (L-1)",
    usps: {
      name: "USCIS",
      line1: "P.O. Box 660611",
      city: "Dallas",
      state: "TX",
      zip: "75266",
    },
    courier: {
      name: "USCIS",
      line1: "Attn: I-129 L-1",
      line2: "2501 S. State Hwy. 121 Business, Suite 400",
      city: "Lewisville",
      state: "TX",
      zip: "75067",
    },
  },
  i129_o1: {
    label: "USCIS — Form I-129 (O-1)",
    usps: {
      name: "USCIS",
      line1: "P.O. Box 660611",
      city: "Dallas",
      state: "TX",
      zip: "75266",
    },
    courier: {
      name: "USCIS",
      line1: "Attn: I-129 O-1",
      line2: "2501 S. State Hwy. 121 Business, Suite 400",
      city: "Lewisville",
      state: "TX",
      zip: "75067",
    },
  },
  i130: {
    label: "USCIS — Form I-130",
    usps: {
      name: "USCIS",
      line1: "P.O. Box 660078",
      city: "Dallas",
      state: "TX",
      zip: "75266",
    },
    courier: {
      name: "USCIS",
      line1: "Attn: I-130",
      line2: "2501 S. State Hwy. 121 Business, Suite 400",
      city: "Lewisville",
      state: "TX",
      zip: "75067",
    },
  },
  i140: {
    label: "USCIS — Form I-140",
    usps: {
      name: "USCIS",
      line1: "P.O. Box 660128",
      city: "Dallas",
      state: "TX",
      zip: "75266",
    },
    courier: {
      name: "USCIS",
      line1: "Attn: I-140",
      line2: "2501 S. State Hwy. 121 Business, Suite 400",
      city: "Lewisville",
      state: "TX",
      zip: "75067",
    },
  },
};

function formatAddress(address) {
  if (!address) return "";
  return [address.name, address.line1, address.line2, [address.city, address.state, address.zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("\n");
}

// method: "usps" | "fedex" | "ups" | "dhl" | "online" — courier services all
// use the physical/courier address; "online" has no mailing address at all.
function resolveFilingAddress(filingAddressKey, method = "usps") {
  const entry = FILING_ADDRESSES[filingAddressKey];
  if (!entry) return null;
  if (method === "online") return null;
  const address = method === "usps" ? entry.usps : entry.courier;
  return { key: filingAddressKey, label: entry.label, method, address, formatted: formatAddress(address) };
}

module.exports = { FILING_ADDRESSES, resolveFilingAddress, formatAddress };
