const consultationService = require("./consultation.service");

async function getConfig(req, res, next) {
  try {
    res.json({ success: true, data: await consultationService.getPublicConfig() });
  } catch (error) {
    next(error);
  }
}

async function getSlots(req, res, next) {
  try {
    const data = await consultationService.getPublicSlots(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function book(req, res, next) {
  try {
    const data = await consultationService.book(req.body || {}, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getBooking(req, res, next) {
  try {
    const data = await consultationService.getByToken(req.params.token);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function rescheduleBooking(req, res, next) {
  try {
    const data = await consultationService.reschedule(req.params.token, req.body?.newStartAt, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function cancelBooking(req, res, next) {
  try {
    const data = await consultationService.cancel(req.params.token, req.body?.reason, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getAdminAvailability(req, res, next) {
  try {
    const data = await consultationService.getHostAvailability();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function setAdminAvailability(req, res, next) {
  try {
    const data = await consultationService.setHostAvailability(req.body || {}, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { getConfig, getSlots, book, getBooking, rescheduleBooking, cancelBooking, getAdminAvailability, setAdminAvailability };
