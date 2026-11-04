// In-memory stand-in for the few Mongoose model calls the scan service makes (tests only - no database at all).
// Documents are built with the REAL schema (defaults + validation), filters / updates follow MongoDB semantics for the operators used
// ($in $lt $lte $gt $gte $or $and $exists, null = missing or null; $set $inc $push{$each,$slice}), and an optional unique rule mirrors a
// partial unique index (a write that would break it is undone and throws { code: 11000 }).
const { Types } = require("mongoose");

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Types.ObjectId || value?._bsontype === "ObjectId") return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, clone(v)]));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = clone(item);
  return out;
}

const getPath = (doc, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), doc);
function setPath(doc, path, value) {
  const keys = path.split(".");
  let target = doc;
  for (const key of keys.slice(0, -1)) {
    if (target[key] == null || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
}
const comparable = (value) => (value instanceof Date ? value.getTime() : value?._bsontype === "ObjectId" || value instanceof Types.ObjectId ? String(value) : value);
const equal = (a, b) => comparable(a) === comparable(b) || (a == null && b == null);

function matchValue(actual, condition) {
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date) && !(condition instanceof Types.ObjectId) && Object.keys(condition).some((key) => key.startsWith("$"))) {
    return Object.entries(condition).every(([op, expected]) => {
      if (op === "$in") return expected.some((item) => equal(actual, item));
      if (op === "$exists") return expected ? actual !== undefined : actual === undefined;
      if (actual == null) return false;
      const a = comparable(actual);
      const b = comparable(expected);
      if (op === "$lt") return a < b;
      if (op === "$lte") return a <= b;
      if (op === "$gt") return a > b;
      if (op === "$gte") return a >= b;
      throw new Error(`fakeModel: operator ${op} not supported`);
    });
  }
  return equal(actual, condition);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((part) => matches(doc, part));
    if (key === "$and") return condition.every((part) => matches(doc, part));
    return matchValue(getPath(doc, key), condition);
  });
}

function applyUpdate(doc, update) {
  for (const [op, fields] of Object.entries(update)) {
    if (op === "$set") for (const [path, value] of Object.entries(fields)) setPath(doc, path, clone(value));
    else if (op === "$inc") for (const [path, value] of Object.entries(fields)) setPath(doc, path, (Number(getPath(doc, path)) || 0) + value);
    else if (op === "$push") {
      for (const [path, value] of Object.entries(fields)) {
        const list = Array.isArray(getPath(doc, path)) ? getPath(doc, path) : [];
        const items = value && value.$each ? value.$each : [value];
        let next = [...list, ...clone(items)];
        if (value && value.$slice !== undefined) next = value.$slice < 0 ? next.slice(value.$slice) : next.slice(0, value.$slice);
        setPath(doc, path, next);
      }
    } else throw new Error(`fakeModel: update operator ${op} not supported`);
  }
}

function sortDocs(docs, sort = {}) {
  const entries = Object.entries(sort);
  return [...docs].sort((x, y) => {
    for (const [path, direction] of entries) {
      const a = comparable(getPath(x, path));
      const b = comparable(getPath(y, path));
      if (a == b) continue; // eslint-disable-line eqeqeq
      if (a == null) return -direction; // MongoDB: null / missing sorts first ascending
      if (b == null) return direction;
      return a < b ? -direction : direction;
    }
    return 0;
  });
}

// .select("a b") keeps only those top-level fields (+ _id), .select("-a -b") drops them - as MongoDB does, so a field missing from a
// projection fails the tests too (a summary once lost every finding's section that way).
function project(value, select) {
  if (!select || value == null) return value;
  const fields = String(select).split(/\s+/).filter(Boolean);
  const exclude = fields.every((field) => field.startsWith("-"));
  const names = new Set(fields.map((field) => field.replace(/^-/, "")));
  const one = (doc) => Object.fromEntries(Object.entries(doc).filter(([name]) => (exclude ? !names.has(name) : name === "_id" || names.has(name))));
  return Array.isArray(value) ? value.map(one) : one(value);
}

class Query {
  constructor(run) { this.run = run; this.options = {}; }
  select(fields) { this.options.select = typeof fields === "string" ? fields : null; return this; }
  lean() { return this; }
  sort(sort) { this.options.sort = sort; return this; }
  limit(limit) { this.options.limit = limit; return this; }
  skip(skip) { this.options.skip = skip; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => project(this.run(this.options), this.options.select)).then(resolve, reject); }
  catch(reject) { return this.then(null, reject); }
}

/** createFakeModel(RealModel, { unique: (docs) => boolean (true = the rule holds) }) */
function createFakeModel(RealModel, { unique } = {}) {
  const docs = [];
  const log = { writes: 0 };
  const build = (input) => {
    const instance = new RealModel(input);
    const error = instance.validateSync();
    if (error) throw error;
    return instance.toObject({ depopulate: true });
  };
  const checkUnique = (undo) => {
    if (unique && !unique(docs)) {
      undo();
      throw Object.assign(new Error("E11000 duplicate key error (fake)"), { code: 11000 });
    }
  };
  const model = {
    docs, log,
    async create(input) {
      const doc = build(input);
      docs.push(doc);
      checkUnique(() => docs.splice(docs.indexOf(doc), 1));
      log.writes += 1;
      return { ...clone(doc), toObject: () => clone(doc) };
    },
    async insertMany(list) {
      const built = list.map(build);
      docs.push(...built);
      log.writes += built.length;
      return built.map(clone);
    },
    findOne(filter) { return new Query(() => clone(docs.find((doc) => matches(doc, filter)) || null)); },
    findById(id) { return new Query(() => clone(docs.find((doc) => equal(doc._id, id)) || null)); },
    find(filter) {
      return new Query(({ sort, limit, skip }) => {
        let found = docs.filter((doc) => matches(doc, filter));
        if (sort) found = sortDocs(found, sort);
        if (skip) found = found.slice(skip);
        if (limit) found = found.slice(0, limit);
        return found.map(clone);
      });
    },
    findOneAndUpdate(filter, update, options = {}) {
      return new Query(() => {
        const candidates = sortDocs(docs.filter((doc) => matches(doc, filter)), options.sort || {});
        const doc = candidates[0];
        if (!doc) return null;
        const before = clone(doc);
        applyUpdate(doc, update);
        checkUnique(() => Object.assign(doc, before));
        log.writes += 1;
        return clone(options.new ? doc : before);
      });
    },
    async updateOne(filter, update) {
      const doc = docs.find((item) => matches(item, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      const before = clone(doc);
      applyUpdate(doc, update);
      checkUnique(() => { for (const key of Object.keys(doc)) delete doc[key]; Object.assign(doc, before); });
      log.writes += 1;
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(filter) { return docs.filter((doc) => matches(doc, filter)).length; },
    async deleteMany(filter) {
      let deleted = 0;
      for (let index = docs.length - 1; index >= 0; index -= 1) if (matches(docs[index], filter)) { docs.splice(index, 1); deleted += 1; }
      log.writes += deleted ? 1 : 0;
      return { deletedCount: deleted };
    },
  };
  return model;
}

/** The partial unique index of PetitionAiScan: at most one open scan per petition. */
const oneOpenScanPerPetition = (docs) => {
  const open = docs.filter((doc) => doc.open === true).map((doc) => String(doc.documentId));
  return new Set(open).size === open.length;
};

module.exports = { createFakeModel, oneOpenScanPerPetition, matches, applyUpdate };
