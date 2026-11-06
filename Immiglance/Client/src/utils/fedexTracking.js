// FedEx tracking number of the client's filed petition: cleaning, validation and the link to FedEx's own tracking page. Pure.
// The same rule as the backend and the Admin portal: without spaces and dashes the number is 8 to 34 letters / digits. The link is built only from a valid number, URL-encoded.
const NUMBER = /^[A-Za-z0-9]{8,34}$/;

export const cleanTrackingNumber = (value) => String(value ?? "").replace(/[\s-]+/g, "");

export const isValidTrackingNumber = (value) => NUMBER.test(cleanTrackingNumber(value));

/** https://www.fedex.com/fedextrack/?trknbr=<number>, or "" when the number is not valid. */
export const fedexTrackingUrl = (value) => (isValidTrackingNumber(value) ? `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(cleanTrackingNumber(value))}` : "");

/** A number grouped for reading ("7946 4479 0138"); anything that is not plain digits is shown as typed. */
export const displayTrackingNumber = (value) => {
  const clean = cleanTrackingNumber(value);
  return /^\d{12,22}$/.test(clean) ? clean.replace(/(\d{4})(?=\d)/g, "$1 ") : clean;
};
