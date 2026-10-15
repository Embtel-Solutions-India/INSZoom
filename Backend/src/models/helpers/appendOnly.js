// Makes a schema APPEND-ONLY: documents can be inserted and read, never changed or removed. Used by the Release 0b-1 evidence collections
// (FormEditionSource, FormEditionAuditEvent), which are the permanent record of an edition decision and have NO expiry (TTL).
//
// Every way of changing or deleting through Mongoose is refused here. (Nothing at this level can stop someone who connects with a raw driver; the
// guarantee is that the application itself has no path that edits or deletes these rows.)

const UPDATE_OPERATIONS = ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "findOneAndDelete", "deleteMany"];

function refuse(name, operation) {
  const error = new Error(`${name} is append-only: ${operation} is not allowed`);
  error.status = 409;
  error.code = "APPEND_ONLY";
  return error;
}

function appendOnly(schema, name) {
  schema.pre("save", function refuseChange(next) {
    if (!this.isNew) return next(refuse(name, "save of an existing document"));
    return next();
  });
  schema.pre(UPDATE_OPERATIONS, function refuseQueryChange(next) {
    next(refuse(name, this.op || "an update"));
  });
  schema.pre("deleteOne", { document: true, query: true }, function refuseDelete(next) {
    next(refuse(name, "deleteOne"));
  });
  schema.pre("bulkWrite", function refuseBulk(next, ops) {
    const writes = Array.isArray(ops) ? ops : [];
    if (writes.some((op) => !op || !("insertOne" in op))) return next(refuse(name, "bulkWrite with anything but insertOne"));
    return next();
  });
  return schema;
}

module.exports = { appendOnly, UPDATE_OPERATIONS };
