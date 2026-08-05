// Provider registry. To add a new provider (e.g. SendGrid, SES, Postmark):
//   1. Create ./sendgrid.provider.js exporting { name, send({to,subject,html,text,from,cc}), isConfigured() }
//   2. Register it below
//   3. Set EMAIL_PROVIDER=sendgrid in the environment
// No business logic anywhere else in the app needs to change.
const providers = {
  smtp: require("./nodemailer.provider"),
};

function getProvider() {
  const name = String(process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
  return providers[name] || providers.smtp;
}

module.exports = { getProvider };
