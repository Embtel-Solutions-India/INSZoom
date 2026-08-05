const User = require("../../../models/User");
const service = require("../services/document-intelligence.service");

async function process(job) {
  const user = job.user?._id ? job.user : job.userId ? await User.findById(job.userId) : job.user;
  const req = job.reqMeta ? { ip: job.reqMeta.ip, headers: { "user-agent": job.reqMeta.userAgent } } : undefined;
  return service.processDocument(job.documentId, user, req);
}

module.exports = {
  process,
};
