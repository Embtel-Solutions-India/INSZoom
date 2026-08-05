const mongoose = require("mongoose");
const env = require("./env");
const logger = require("../utils/logger");

async function connectDB() {
  const conn = await mongoose.connect(env.mongoUri);
  logger.info("mongodb_connected", { host: conn.connection.host });
  return conn;
}

module.exports = connectDB;
