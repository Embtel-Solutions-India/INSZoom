const CalendarAvailability = require("../../models/CalendarAvailability");
const CalendarIntegration = require("../../models/CalendarIntegration");
const CalendarResource = require("../../models/CalendarResource");
const calendarService = require("./calendar.service");
const appointmentService = require("../appointments/appointment.service");

exports.getCalendar = async (req, res, next) => {
  try {
    const calendar = await calendarService.combinedCalendar(req.query, req.user);
    res.json({ success: true, ...calendar });
  } catch (error) {
    next(error);
  }
};

exports.getEvents = async (req, res, next) => {
  try {
    const events = await calendarService.listEvents(req.query, req.user);
    res.json({ success: true, count: events.length, events });
  } catch (error) {
    next(error);
  }
};

exports.createEvent = async (req, res, next) => {
  try {
    const event = await calendarService.createEvent(req.body, req.user);
    res.status(201).json({ success: true, event });
  } catch (error) {
    next(error);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const event = await calendarService.updateEvent(req.params.id, req.body, req.user);
    if (!event) return res.status(404).json({ success: false, message: "Calendar event not found" });
    res.json({ success: true, event });
  } catch (error) {
    next(error);
  }
};

exports.getAvailability = async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user._id;
    const result = await appointmentService.getAvailability({ ...req.query, userId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.upsertAvailability = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.body.userId || req.user._id;
    const availability = await calendarService.upsertAvailability(userId, req.body, req.user);
    res.json({ success: true, availability });
  } catch (error) {
    next(error);
  }
};

exports.listResources = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.active !== undefined) filter.active = req.query.active === "true";
    const resources = await CalendarResource.find(filter).sort({ type: 1, name: 1 });
    res.json({ success: true, count: resources.length, resources });
  } catch (error) {
    next(error);
  }
};

exports.createResource = async (req, res, next) => {
  try {
    const resource = await calendarService.createResource(req.body, req.user);
    res.status(201).json({ success: true, resource });
  } catch (error) {
    next(error);
  }
};

exports.updateResource = async (req, res, next) => {
  try {
    const resource = await calendarService.updateResource(req.params.id, req.body, req.user);
    if (!resource) return res.status(404).json({ success: false, message: "Calendar resource not found" });
    res.json({ success: true, resource });
  } catch (error) {
    next(error);
  }
};

exports.listIntegrations = async (req, res, next) => {
  try {
    const filter = req.query.userId ? { userId: req.query.userId } : { userId: req.user._id };
    const integrations = await CalendarIntegration.find(filter).select("-accessTokenEncrypted -refreshTokenEncrypted");
    res.json({ success: true, count: integrations.length, integrations });
  } catch (error) {
    next(error);
  }
};

exports.upsertIntegration = async (req, res, next) => {
  try {
    const integration = await calendarService.upsertIntegration(req.body, req.user);
    res.json({ success: true, integration });
  } catch (error) {
    next(error);
  }
};

exports.syncProvider = async (req, res, next) => {
  try {
    const result = await appointmentService.syncCalendar(req.user, req.params.provider || req.body.provider);
    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
};

exports.suggestSlots = async (req, res, next) => {
  try {
    const suggestions = await calendarService.suggestSlots(req.query, req.user);
    res.json({ success: true, suggestions });
  } catch (error) {
    next(error);
  }
};
