const clientService = require("./client.service");

async function getClients(req, res, next) {
  try {
    const result = await clientService.listClients(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function getClient(req, res, next) {
  try {
    const client = await clientService.getAccessibleClientOrThrow(req.params.id, req.user);
    res.json({ success: true, client });
  } catch (error) {
    next(error);
  }
}

async function createClient(req, res, next) {
  try {
    const client = await clientService.createClient(req.body, req.user, req);
    res.status(201).json({ success: true, client });
  } catch (error) {
    next(error);
  }
}

async function updateClient(req, res, next) {
  try {
    const client = await clientService.updateClient(req.params.id, req.body, req.user, req);
    res.json({ success: true, client });
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const client = await clientService.updateClient(req.params.id, { status: req.body.status }, req.user, req);
    res.json({ success: true, client });
  } catch (error) {
    next(error);
  }
}

async function getMyProfile(req, res, next) {
  try {
    const client = await clientService.getMyClient(req.user);
    res.json(client);
  } catch (error) {
    next(error);
  }
}

async function saveMyProfile(req, res, next) {
  try {
    const client = await clientService.saveProfile(req.user, req.user._id, req.body, req);
    res.json({ message: "Profile saved", profile: client, client });
  } catch (error) {
    next(error);
  }
}

async function getProfile(req, res, next) {
  try {
    const targetUserId = req.params.userId || req.user._id;
    const baseUser = typeof req.user.toObject === "function" ? req.user.toObject() : req.user;
    const client = await clientService.getMyClient({ ...baseUser, _id: targetUserId });
    if (!clientService.canAccessClient(req.user, client)) return res.status(403).json({ success: false, message: "Access denied" });
    res.json(client);
  } catch (error) {
    next(error);
  }
}

async function saveProfile(req, res, next) {
  try {
    const targetUserId = req.params.userId || req.user._id;
    const client = await clientService.saveProfile(req.user, targetUserId, req.body, req);
    res.json({ message: "Profile saved", profile: client, client });
  } catch (error) {
    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const dashboard = await clientService.getDashboard(req.user);
    res.json({ success: true, ...dashboard });
  } catch (error) {
    next(error);
  }
}

async function addNote(req, res, next) {
  try {
    const client = await clientService.addNote(req.params.id, req.body, req.user, req);
    res.json({ success: true, client });
  } catch (error) {
    next(error);
  }
}

async function getTimeline(req, res, next) {
  try {
    const client = await clientService.getAccessibleClientOrThrow(req.params.id, req.user);
    res.json({ success: true, timeline: client.timeline, activityHistory: client.activityHistory });
  } catch (error) {
    next(error);
  }
}

async function getRelated(req, res, next) {
  try {
    const related = await clientService.getRelated(req.params.id, req.user);
    res.json({ success: true, ...related });
  } catch (error) {
    next(error);
  }
}

async function deleteClient(req, res, next) {
  try {
    const client = await clientService.updateClient(req.params.id, { status: "archived" }, req.user, req);
    res.json({ success: true, message: "Client archived successfully", client });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addNote,
  createClient,
  deleteClient,
  getClient,
  getClients,
  getDashboard,
  getMyProfile,
  getProfile,
  getRelated,
  getTimeline,
  saveMyProfile,
  saveProfile,
  updateClient,
  updateStatus,
};
