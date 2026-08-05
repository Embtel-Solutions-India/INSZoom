const Notification = require("../../models/Notification");
const NotificationPreference = require("../../models/NotificationPreference");
const NotificationTemplate = require("../../models/NotificationTemplate");
const notificationService = require("./notification.service");
const deviceTokenService = require("./device-token.service");

function isAdmin(user) {
  return ["super_admin", "admin"].includes(user?.role);
}

async function findNotification(id, user) {
  const notification = await notificationService.populateNotificationQuery(Notification.findById(id));
  if (!notification || notification.deletedAt) {
    const error = new Error("Notification not found");
    error.status = 404;
    throw error;
  }
  if (!notificationService.canAccessNotification(user, notification)) {
    const error = new Error("Not authorized to access this notification");
    error.status = 403;
    throw error;
  }
  return notification;
}

exports.getNotifications = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const sort = req.query.sort || "-createdAt";
    const filter = isAdmin(req.user) && (req.query.userId || req.query.role)
      ? notificationService.buildAdminFilter(req.query)
      : notificationService.buildUserFilter(req.user, req.query);
    const [count, notifications] = await Promise.all([
      Notification.countDocuments(filter),
      notificationService.populateNotificationQuery(
        Notification.find(filter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
      ),
    ]);
    res.json({ success: true, count, page, pages: Math.ceil(count / limit), notifications });
  } catch (error) {
    next(error);
  }
};

exports.getMyNotifications = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const filter = notificationService.buildUserFilter(req.user, req.query);
    const notifications = await Notification.find(filter).sort({ pinned: -1, createdAt: -1 }).limit(limit);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const filter = notificationService.buildUserFilter(req.user, { ...req.query, isRead: false });
    const count = await Notification.countDocuments(filter);
    res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
};

exports.createNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.createNotification(req.body, req.user, req);
    res.status(201).json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

exports.createRoleNotification = async (req, res, next) => {
  try {
    const roles = req.body.roles || req.body.recipientRoles || [];
    const notifications = await notificationService.createForRoles(roles, req.body, req.user, req);
    res.status(201).json({ success: true, count: notifications.length, notifications });
  } catch (error) {
    next(error);
  }
};

exports.createEventNotification = async (req, res, next) => {
  try {
    const notifications = await notificationService.createFromEvent(req.body.eventName, req.body.context || {}, req.user, req);
    res.status(201).json({ success: true, count: notifications.length, notifications });
  } catch (error) {
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    const updated = await notificationService.markRead(notification, req.user, req);
    res.json({ success: true, notification: updated });
  } catch (error) {
    next(error);
  }
};

exports.markManyAsRead = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const notifications = await Notification.find({ _id: { $in: ids }, deletedAt: { $exists: false } });
    const accessible = notifications.filter((notification) => notificationService.canAccessNotification(req.user, notification));
    const now = new Date();
    await Notification.updateMany({ _id: { $in: accessible.map((item) => item._id) } }, { read: true, isRead: true, readAt: now });
    await Promise.all(accessible.map((notification) => notificationService.writeAuditLog("read_many", notification, req.user, { ids }, req)));
    res.json({ success: true, count: accessible.length });
  } catch (error) {
    next(error);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    const filter = notificationService.buildUserFilter(req.user, { ...req.query, isRead: false });
    const notifications = await Notification.find(filter);
    const now = new Date();
    await Notification.updateMany(filter, { read: true, isRead: true, readAt: now });
    await Promise.all(notifications.map((notification) => notificationService.writeAuditLog("read_all", notification, req.user, {}, req)));
    res.json({ success: true, message: "All notifications marked as read", count: notifications.length });
  } catch (error) {
    next(error);
  }
};

exports.archiveNotification = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    const updated = await notificationService.updateNotificationState(notification, "archive", {}, req.user, req);
    res.json({ success: true, message: "Notification archived", notification: updated });
  } catch (error) {
    next(error);
  }
};

exports.pinNotification = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    const updated = await notificationService.updateNotificationState(notification, "pin", {}, req.user, req);
    res.json({ success: true, notification: updated });
  } catch (error) {
    next(error);
  }
};

exports.unpinNotification = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    const updated = await notificationService.updateNotificationState(notification, "unpin", {}, req.user, req);
    res.json({ success: true, notification: updated });
  } catch (error) {
    next(error);
  }
};

exports.snoozeNotification = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    const updated = await notificationService.updateNotificationState(notification, "snooze", req.body, req.user, req);
    res.json({ success: true, notification: updated });
  } catch (error) {
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    await notificationService.updateNotificationState(notification, "delete", {}, req.user, req);
    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    next(error);
  }
};

exports.getNotificationHistory = async (req, res, next) => {
  try {
    const notification = await findNotification(req.params.id, req.user);
    res.json({ success: true, history: notification.auditHistory || [], delivery: notification.delivery || [] });
  } catch (error) {
    next(error);
  }
};

exports.getPreferences = async (req, res, next) => {
  try {
    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      { $setOnInsert: { userId: req.user._id } },
      { new: true, upsert: true }
    );
    res.json({ success: true, preferences });
  } catch (error) {
    next(error);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      { ...req.body, userId: req.user._id, updatedBy: req.user._id },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, preferences });
  } catch (error) {
    next(error);
  }
};

exports.listTemplates = async (req, res, next) => {
  try {
    const filter = { archivedAt: { $exists: false } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.active !== undefined) filter.active = req.query.active === "true";
    const templates = await NotificationTemplate.find(filter).sort({ category: 1, name: 1 });
    res.json({ success: true, count: templates.length, templates });
  } catch (error) {
    next(error);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const template = await NotificationTemplate.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const template = await NotificationTemplate.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );
    if (!template) return res.status(404).json({ success: false, message: "Notification template not found" });
    res.json({ success: true, template });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const analytics = await notificationService.getAnalytics(req.query);
    res.json({ success: true, analytics });
  } catch (error) {
    next(error);
  }
};

exports.processScheduled = async (req, res, next) => {
  try {
    const result = await notificationService.processScheduled(Number(req.body.limit || req.query.limit || 100), req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.retryFailed = async (req, res, next) => {
  try {
    const result = await notificationService.retryFailed(Number(req.body.limit || req.query.limit || 100), req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.registerDevice = async (req, res, next) => {
  try {
    const { token, browser, platform } = req.body;
    const device = await deviceTokenService.registerDevice(req.user._id, { token, browser, platform });
    res.status(201).json({ success: true, device });
  } catch (error) {
    next(error);
  }
};

exports.unregisterDevice = async (req, res, next) => {
  try {
    await deviceTokenService.unregisterDevice(req.user._id, req.body.token);
    res.json({ success: true, message: "Device unregistered" });
  } catch (error) {
    next(error);
  }
};

exports.getDevices = async (req, res, next) => {
  try {
    const devices = await deviceTokenService.listDevices(req.user._id);
    res.json({ success: true, devices });
  } catch (error) {
    next(error);
  }
};
