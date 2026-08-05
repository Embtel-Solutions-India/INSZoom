const searchService = require("./search.service");

function parseEntities(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function parseFilters(query = {}) {
  const ignored = new Set(["q", "query", "entities", "page", "limit", "source"]);
  return Object.fromEntries(Object.entries(query).filter(([key, value]) => !ignored.has(key) && value !== undefined && value !== ""));
}

async function globalSearch(req, res, next) {
  try {
    const data = await searchService.globalSearch(
      {
        query: req.query.q || req.query.query || "",
        entities: parseEntities(req.query.entities),
        filters: parseFilters(req.query),
        page: req.query.page,
        limit: req.query.limit,
      },
      req.user,
      req
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function naturalLanguageSearch(req, res, next) {
  try {
    const data = await searchService.globalSearch(
      {
        query: req.body.query || req.query.q || req.query.query || "",
        entities: parseEntities(req.body.entities || req.query.entities),
        filters: req.body.filters || parseFilters(req.query),
        page: req.body.page || req.query.page,
        limit: req.body.limit || req.query.limit,
        source: "natural_language",
      },
      req.user,
      req
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function autocomplete(req, res, next) {
  try {
    const data = await searchService.autocomplete(req.query.q || req.query.query || "", req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function suggestions(req, res, next) {
  try {
    const data = await searchService.suggestions(req.query.q || req.query.query || "", req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function history(req, res, next) {
  try {
    const data = await searchService.listHistory(req.user, req.query);
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
}

async function saved(req, res, next) {
  try {
    const data = await searchService.listSavedSearches(req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function createSaved(req, res, next) {
  try {
    const data = await searchService.createSavedSearch(req.body, req.user);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function updateSaved(req, res, next) {
  try {
    const data = await searchService.updateSavedSearch(req.params.id, req.body, req.user);
    if (!data) return res.status(404).json({ success: false, message: "Saved search not found" });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function deleteSaved(req, res, next) {
  try {
    const data = await searchService.deleteSavedSearch(req.params.id, req.user);
    if (!data) return res.status(404).json({ success: false, message: "Saved search not found" });
    res.json({ success: true, message: "Saved search deleted" });
  } catch (error) {
    next(error);
  }
}

async function runSaved(req, res, next) {
  try {
    const data = await searchService.runSavedSearch(req.params.id, req.user, req);
    if (!data) return res.status(404).json({ success: false, message: "Saved search not found" });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  autocomplete,
  createSaved,
  deleteSaved,
  globalSearch,
  history,
  naturalLanguageSearch,
  runSaved,
  saved,
  suggestions,
  updateSaved,
};
