// Conservative splitter for the ONE combined free-text address a family-visa
// (K-1/K-3) checklist collects per address ("Full Mailing address:", "Full
// Outside US address:", an employer's "Full Address of Employer", ...) into
// the street / unit / city / state / ZIP / province / postal code / country
// widgets USCIS forms have for each address block.
//
// The rule that shapes every decision here: NEVER GUESS. A component is only
// returned when the text actually shows it (a state abbreviation next to a
// ZIP, a known country name, an "Apt 4B" token). Anything ambiguous is left
// undefined so the PDF field stays blank for the case manager to complete -
// a wrong value on a federal form is worse than a blank.
//
// Input shapes handled (comma / newline / semicolon separated):
//   "12 Oak St Apt 4B, Columbus, OH 43004"
//   "12 Oak St, Apt 4B, Columbus, OH, 43004, USA"
//   "12 Oak St, Columbus OH 43004"
//   "5 Rue de la Paix, Lyon, Auvergne, 69001, France"      (non-US)
//   "Plot 4, Banjara Hills, Hyderabad, Telangana, India"   (non-US)
const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico", VI: "Virgin Islands",
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));

const COUNTRY_ALIASES = {
  usa: "United States", "u.s.a.": "United States", "u.s.a": "United States", us: "United States", "u.s.": "United States",
  "united states": "United States", "united states of america": "United States", america: "United States",
  uk: "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom",
  uae: "United Arab Emirates", russia: "Russia", "south korea": "South Korea", "north korea": "North Korea",
  vietnam: "Vietnam", "viet nam": "Vietnam", "czech republic": "Czechia", burma: "Myanmar",
};

let countryNameSet = null;
function knownCountries() {
  if (countryNameSet) return countryNameSet;
  countryNameSet = new Set(Object.keys(COUNTRY_ALIASES));
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of letters) {
      for (const b of letters) {
        const code = `${a}${b}`;
        const name = display.of(code);
        if (name && name !== code && !/unknown/i.test(name)) countryNameSet.add(name.toLowerCase());
      }
    }
  } catch {
    // Intl.DisplayNames unavailable - the alias list above still covers the common spellings.
  }
  return countryNameSet;
}

function canonicalCountry(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return undefined;
  const alias = COUNTRY_ALIASES[cleaned.toLowerCase()];
  return alias || cleaned;
}

function isCountry(text) {
  return knownCountries().has(String(text || "").trim().toLowerCase());
}

function isUsCountry(text) {
  return canonicalCountry(text) === "United States";
}

// "OH" / "ohio" -> "OH"; anything that is not a recognised US state -> undefined.
function stateCode(text) {
  const cleaned = String(text || "").replace(/\./g, "").trim();
  if (!cleaned) return undefined;
  const upper = cleaned.toUpperCase();
  if (US_STATES[upper]) return upper;
  return STATE_BY_NAME[cleaned.toLowerCase()];
}

const UNIT_PATTERN = /(?:^|[\s,])(apartment|apt|unit|suite|ste|floor|flr|fl|room|rm|#)\.?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*$/i;
const UNIT_ONLY = /^(apartment|apt|unit|suite|ste|floor|flr|fl|room|rm)\.?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]*)$|^#\s*([A-Za-z0-9][A-Za-z0-9-]*)$/i;

function unitTypeOf(word) {
  const w = String(word || "").toLowerCase();
  if (w.startsWith("ste") || w === "suite") return "Ste";
  if (w.startsWith("fl")) return "Flr";
  return "Apt"; // apartment / apt / unit / room / '#'
}

function splitUnit(street) {
  const match = UNIT_PATTERN.exec(street);
  if (!match) return { street };
  const before = street.slice(0, match.index).replace(/[\s,]+$/, "");
  if (!before) return { street };
  return { street: before, unitType: unitTypeOf(match[1]), unitNumber: match[2] };
}

const ZIP_ONLY = /^(\d{5})(?:-(\d{4}))?$/;

// "OH 43004", "Ohio 43004", "Columbus OH 43004", "Columbus, New York 10001" tail
// -> { zip, state, cityPart }. Only returns when the token before the ZIP is a
// real US state (1-3 words); anything else is not treated as a US tail.
function splitStateZip(text) {
  const tokens = String(text || "").trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const zipMatch = ZIP_ONLY.exec(tokens[tokens.length - 1]);
  if (!zipMatch) return null;
  const rest = tokens.slice(0, -1);
  for (let words = Math.min(3, rest.length); words >= 1; words -= 1) {
    const state = stateCode(rest.slice(-words).join(" "));
    if (state) {
      const cityPart = rest.slice(0, rest.length - words).join(" ");
      return { zip: zipMatch[1], state, cityPart: cityPart || undefined };
    }
  }
  return null;
}

// Returns { street, unitType, unitNumber, city, state, zip, province,
// postalCode, country, isUS } with only the components the text supports.
function parseAddress(text) {
  const raw = String(text ?? "").replace(/\r/g, "\n").trim();
  if (!raw) return null;
  let segments = raw.split(/\n|;|,/).map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return null;

  const result = {};
  const popCountry = () => {
    if (segments.length > 1 && isCountry(segments[segments.length - 1])) {
      result.country = canonicalCountry(segments.pop());
    }
  };
  popCountry();

  // --- US shapes: "..., ST 12345", "..., ST, 12345", "... City ST 12345" ---
  let usMatched = false;
  const last = segments[segments.length - 1];
  const prev = segments[segments.length - 2];
  if (ZIP_ONLY.test(last) && prev && stateCode(prev)) {
    const [, zip] = ZIP_ONLY.exec(last);
    result.zip = zip;
    result.state = stateCode(prev);
    segments = segments.slice(0, -2);
    usMatched = true;
  } else if (splitStateZip(last)) {
    const tail = splitStateZip(last);
    result.zip = tail.zip;
    result.state = tail.state;
    segments = segments.slice(0, -1);
    if (tail.cityPart) result.city = tail.cityPart;
    usMatched = true;
  } else if (stateCode(last) && segments.length >= 3 && (!result.country || isUsCountry(result.country))) {
    // "12 Oak St, Columbus, OH" - state without a ZIP, only trusted when the
    // text otherwise looks like street + city + state.
    result.state = stateCode(segments.pop());
    usMatched = true;
  }

  if (usMatched) {
    if (!result.city && segments.length >= 2) result.city = segments.pop();
    result.country = result.country || "United States";
    result.isUS = true;
  } else if (!result.country || !isUsCountry(result.country)) {
    // --- non-US shape: [street..., city, postal?] (country already removed).
    // The state/province of a foreign free-text address cannot be told apart
    // from its city without a gazetteer, so province is deliberately NOT
    // inferred - it is left for the case manager rather than guessed.
    const tail = segments[segments.length - 1];
    if (segments.length >= 3 && /\d/.test(tail) && /^[A-Za-z0-9][A-Za-z0-9\- ]{1,11}$/.test(tail) && !/[a-z]{4,}/i.test(tail.replace(/\d/g, ""))) {
      result.postalCode = segments.pop();
    }
    // Exactly [street, city] is the only unambiguous foreign shape; with more
    // segments the last one could be the city or the province, so the city is
    // left blank (the text stays whole in street) rather than guessed.
    if (segments.length === 2) result.city = segments.pop();
    result.isUS = false;
  } else {
    if (segments.length >= 2) result.city = segments.pop();
    result.isUS = true;
  }

  // Whatever is left is street (+ unit). A stand-alone "Apt 4B" segment after
  // the street line is the unit.
  let streetSegments = segments;
  if (streetSegments.length >= 2) {
    const lastStreet = streetSegments[streetSegments.length - 1];
    const unitOnly = UNIT_ONLY.exec(lastStreet);
    if (unitOnly) {
      result.unitType = unitTypeOf(unitOnly[1] || "#");
      result.unitNumber = unitOnly[2] || unitOnly[3];
      streetSegments = streetSegments.slice(0, -1);
    }
  }
  const streetText = streetSegments.join(", ");
  if (streetText) {
    if (result.unitNumber) {
      result.street = streetText;
    } else {
      const split = splitUnit(streetText);
      result.street = split.street;
      if (split.unitNumber) {
        result.unitType = split.unitType;
        result.unitNumber = split.unitNumber;
      }
    }
  }
  return result;
}

// part: street | unitNumber | unitApt | unitSte | unitFlr | city | state | zip |
// province | postalCode | country. Unit* parts are checkbox values (true only
// when the text showed that unit type). Returns undefined when unknown.
function addressPart(text, part) {
  // row* parts: the text is ONE street line from an already-structured row
  // (a residential/employment history row has its own city/state/country
  // columns) - only a trailing "Apt 4B"-style unit is split off it, never
  // comma-separated city/state guessed out of the street line.
  if (typeof part === "string" && part.startsWith("row")) {
    const line = String(text ?? "").trim();
    if (!line) return undefined;
    const split = splitUnit(line);
    switch (part) {
      case "rowStreet": return split.street;
      case "rowUnitNumber": return split.unitNumber;
      case "rowUnitApt": return split.unitType === "Apt" ? true : undefined;
      case "rowUnitSte": return split.unitType === "Ste" ? true : undefined;
      case "rowUnitFlr": return split.unitType === "Flr" ? true : undefined;
      default: return undefined;
    }
  }
  const parsed = parseAddress(text);
  if (!parsed) return undefined;
  switch (part) {
    case "unitApt": return parsed.unitType === "Apt" ? true : undefined;
    case "unitSte": return parsed.unitType === "Ste" ? true : undefined;
    case "unitFlr": return parsed.unitType === "Flr" ? true : undefined;
    case "state": return parsed.state;
    case "zip": return parsed.zip;
    case "province": return parsed.province;
    case "postalCode": return parsed.postalCode;
    default: return parsed[part];
  }
}

// "Lyon, France" / "Lyon - France" / "Guadalajara Mexico" -> city + country.
// Only the comma/dash-separated form is trusted for a split.
function parseCityCountry(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s*[,;\n]\s*|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts.slice(0, -1).join(", "), country: canonicalCountry(parts[parts.length - 1]) };
  }
  if (isCountry(parts[0])) return { country: canonicalCountry(parts[0]) };
  return { city: parts[0] };
}

module.exports = { parseAddress, addressPart, parseCityCountry, stateCode, isUsCountry, canonicalCountry, US_STATES };
