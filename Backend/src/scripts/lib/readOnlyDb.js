// A MongoDB handle that can only READ. The Release 0a scripts (form edition pre-rollout report, official-source redirect crawl) run against the
// live database, so "writes nothing" is enforced here at run time, not just promised: only collection(name) and a short list of read methods
// exist on what they are given; anything else throws before it reaches the driver, and an aggregation containing $out / $merge is refused.
//
// db.collection(name) -> { find, aggregate, countDocuments, distinct }; every other property (insertOne, updateOne, deleteMany, drop,
// createIndex, bulkWrite, ...) is a thrown error.

const READ_METHODS = new Set(["find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount", "distinct"]);
const WRITE_STAGES = ["$out", "$merge"];

function refuse(what) {
  throw new Error(`read-only database handle: ${what} is not allowed`);
}

function guardCollection(collection, name) {
  return new Proxy(collection, {
    get(target, property) {
      if (typeof property === "symbol") return Reflect.get(target, property);
      if (!READ_METHODS.has(property)) return refuse(`collection "${name}".${String(property)}`);
      const method = target[property];
      if (property === "aggregate") {
        return (pipeline, ...rest) => {
          const stages = Array.isArray(pipeline) ? pipeline : [];
          const writing = stages.find((stage) => stage && typeof stage === "object" && WRITE_STAGES.some((key) => key in stage));
          if (writing) refuse(`aggregation stage ${Object.keys(writing)[0]} on "${name}"`);
          return method.call(target, pipeline, ...rest);
        };
      }
      return method.bind(target);
    },
  });
}

/** Wraps a native MongoDB Db (or anything with collection(name)) so only reads are possible. */
function readOnlyDb(db) {
  if (!db || typeof db.collection !== "function") throw new Error("readOnlyDb needs an object with collection(name)");
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "collection") return (name) => guardCollection(db.collection(name), name);
        return refuse(`db.${String(property)}`);
      },
    }
  );
}

module.exports = { readOnlyDb, READ_METHODS, WRITE_STAGES };
