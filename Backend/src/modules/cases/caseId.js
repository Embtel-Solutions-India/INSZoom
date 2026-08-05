function generateCaseNumber(source = "CRM") {
  const year = new Date().getFullYear();
  const random = Math.floor(10000 + Math.random() * 90000);
  return `${source}-${year}-${random}`;
}

module.exports = generateCaseNumber;
