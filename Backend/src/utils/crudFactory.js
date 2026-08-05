function parsePagination(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function buildListFilter(query = {}, options = {}) {
  const filter = {};
  (options.filterFields || []).forEach((field) => {
    if (query[field] === undefined || query[field] === "") return;
    filter[field] = query[field];
  });
  if (query.search && options.searchFields?.length) {
    const regex = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = options.searchFields.map((field) => ({ [field]: regex }));
  }
  if ((query.from || query.to || query.startDate || query.endDate) && options.dateField) {
    filter[options.dateField] = {};
    if (query.from || query.startDate) filter[options.dateField].$gte = new Date(query.from || query.startDate);
    if (query.to || query.endDate) filter[options.dateField].$lte = new Date(query.to || query.endDate);
  }
  return filter;
}

function createCrudController(Model, options = {}) {
  const collectionName = options.collectionName;
  const singleName = options.singleName;
  const mergeFilter = (baseFilter, req) => {
    const scopedFilter = options.buildFilter ? options.buildFilter(req, baseFilter) : {};
    if (baseFilter?.$or && scopedFilter?.$or) {
      const { $or: baseOr, ...baseRest } = baseFilter;
      const { $or: scopedOr, ...scopedRest } = scopedFilter;
      return { ...baseRest, ...scopedRest, $and: [{ $or: baseOr }, { $or: scopedOr }] };
    }
    return { ...baseFilter, ...(scopedFilter || {}) };
  };
  const isAccessible = async (item, req, action) => {
    if (!options.canAccess) return true;
    return options.canAccess(item, req, action);
  };
  const collectionPayload = (items, extra = {}) => ({
    success: true,
    items,
    data: items,
    ...(collectionName ? { [collectionName]: items } : {}),
    ...extra,
  });
  const itemPayload = (item) => ({
    success: true,
    data: item,
    ...(singleName ? { [singleName]: item } : {}),
  });

  return {
    async list(req, res, next) {
      try {
        const { page, limit, skip } = parsePagination(req.query);
        const filter = mergeFilter(buildListFilter(req.query, options), req);
        const sort = req.query.sortBy ? { [req.query.sortBy]: req.query.sortOrder === "asc" ? 1 : -1 } : options.defaultSort || { updatedAt: -1, createdAt: -1 };
        const query = Model.find(filter).sort(sort).skip(skip).limit(limit);
        (options.populate || []).forEach((item) => query.populate(item));
        const [items, total] = await Promise.all([query.lean(), Model.countDocuments(filter)]);
        res.json(collectionPayload(items, { pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } }));
      } catch (error) {
        next(error);
      }
    },
    async get(req, res, next) {
      try {
        const query = Model.findById(req.params.id);
        (options.populate || []).forEach((item) => query.populate(item));
        const item = await query.lean();
        if (!item) return res.status(404).json({ success: false, message: `${options.label || "Record"} not found` });
        if (!(await isAccessible(item, req, "read"))) return res.status(403).json({ success: false, message: "Access denied" });
        res.json(itemPayload(item));
      } catch (error) {
        next(error);
      }
    },
    async create(req, res, next) {
      try {
        const payload = options.beforeCreate ? await options.beforeCreate(req.body, req) : req.body;
        const item = await Model.create(payload);
        res.status(201).json(itemPayload(item));
      } catch (error) {
        next(error);
      }
    },
    async update(req, res, next) {
      try {
        const payload = options.beforeUpdate ? await options.beforeUpdate(req.body, req) : req.body;
        const existing = await Model.findById(req.params.id);
        if (!existing) return res.status(404).json({ success: false, message: `${options.label || "Record"} not found` });
        if (!(await isAccessible(existing, req, "update"))) return res.status(403).json({ success: false, message: "Access denied" });
        const item = await Model.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ success: false, message: `${options.label || "Record"} not found` });
        res.json(itemPayload(item));
      } catch (error) {
        next(error);
      }
    },
    async remove(req, res, next) {
      try {
        const existing = await Model.findById(req.params.id);
        if (!existing) return res.status(404).json({ success: false, message: `${options.label || "Record"} not found` });
        if (!(await isAccessible(existing, req, "delete"))) return res.status(403).json({ success: false, message: "Access denied" });
        const item = options.softDeleteField
          ? await Model.findByIdAndUpdate(req.params.id, { [options.softDeleteField]: new Date() }, { new: true })
          : await Model.findByIdAndDelete(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: `${options.label || "Record"} not found` });
        res.json({ success: true, message: `${options.label || "Record"} deleted`, data: item });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { buildListFilter, createCrudController, parsePagination };
