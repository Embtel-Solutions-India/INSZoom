// USCIS receipt number: three letters followed by ten digits (for example IOE1234567890). Mirrors the server's rule (TrackingService.cleanReceiptNumber).
const RECEIPT_NUMBER = /^[A-Z]{3}\d{10}$/

/** Upper-cased, without spaces or dashes. */
export const cleanReceiptNumber = (value) => String(value ?? '').replace(/[\s-]+/g, '').toUpperCase()

export const isValidReceiptNumber = (value) => RECEIPT_NUMBER.test(cleanReceiptNumber(value))
