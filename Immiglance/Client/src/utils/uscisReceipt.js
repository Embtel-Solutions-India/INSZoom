// USCIS receipt number of the client's online filing: cleaning, validation and the USCIS case-status website. Pure. The same rule as the backend: three letters followed by ten digits.
const RECEIPT_NUMBER = /^[A-Z]{3}\d{10}$/;

export const USCIS_CASE_STATUS_URL = "https://egov.uscis.gov/";

/** The receipt number upper-cased without spaces / dashes, or "" when it is not three letters followed by ten digits. */
export const cleanReceiptNumber = (value) => {
  const compact = String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return RECEIPT_NUMBER.test(compact) ? compact : "";
};
