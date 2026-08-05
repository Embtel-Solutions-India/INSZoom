const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function currency(amount, code) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(code || "usd").toUpperCase(),
  }).format((Number(amount) || 0) / 100);
}

async function generateReceipt({ payment, transaction, receipt }) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const color = rgb(0.05, 0.35, 0.28);
  const draw = (text, x, y, options = {}) => page.drawText(String(text ?? ""), {
    x,
    y,
    size: options.size || 11,
    font: options.bold ? bold : regular,
    color: options.color || rgb(0.12, 0.16, 0.22),
  });

  draw("BAIS Immigration Solutions", 54, 730, { size: 20, bold: true, color });
  draw("Payment Receipt", 54, 694, { size: 17, bold: true });
  draw(`Receipt: ${receipt.receiptNumber}`, 54, 664);
  draw(`Invoice: ${payment.invoiceNumber}`, 54, 644);
  draw(`Issued: ${new Date(receipt.issuedAt || Date.now()).toLocaleString("en-US")}`, 54, 624);

  page.drawLine({ start: { x: 54, y: 600 }, end: { x: 558, y: 600 }, thickness: 1, color: rgb(0.82, 0.85, 0.88) });
  draw("Description", 54, 570, { bold: true });
  draw(transaction.label || payment.packageName || "Immigration services", 54, 548);
  draw("Amount", 430, 570, { bold: true });
  draw(currency(transaction.amount, payment.currency), 430, 548, { bold: true, color });
  draw(`Payment method: ${transaction.paymentMethod || transaction.gateway || "Stripe"}`, 54, 510);
  draw(`Transaction ID: ${transaction.gatewayTransactionId || transaction.transactionId || transaction._id}`, 54, 490);
  draw(`Status: ${transaction.status}`, 54, 470);

  page.drawLine({ start: { x: 54, y: 440 }, end: { x: 558, y: 440 }, thickness: 1, color: rgb(0.82, 0.85, 0.88) });
  draw(`Total invoice: ${currency(payment.totalAmount, payment.currency)}`, 54, 410);
  draw(`Total paid: ${currency(payment.amountPaid, payment.currency)}`, 54, 390);
  draw(`Remaining balance: ${currency(payment.remainingAmount, payment.currency)}`, 54, 370, { bold: true });
  draw("This receipt contains no card or bank account details.", 54, 90, { size: 9 });

  return Buffer.from(await document.save());
}

module.exports = {
  generateReceipt,
};
