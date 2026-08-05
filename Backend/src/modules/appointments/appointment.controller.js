const { validationResult } = require("express-validator");
const Appointment = require("../../models/Appointment");
const appointmentService = require("./appointment.service");

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    return true;
  }
  return false;
}

async function getAppointmentOr404(id, user) {
  const appointment = await appointmentService.populateAppointmentQuery(Appointment.findById(id));
  if (!appointment) {
    const error = new Error("Appointment not found");
    error.status = 404;
    throw error;
  }
  if (!(await appointmentService.canAccessAppointment(user, appointment))) {
    const error = new Error("Not authorized to access this appointment");
    error.status = 403;
    throw error;
  }
  return appointment;
}

exports.createPublicAppointment = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const appointment = await appointmentService.createAppointment(req.body, null, req, true);
    res.status(201).json({ success: true, message: "Appointment booked successfully", appointment });
  } catch (error) {
    next(error);
  }
};

exports.createAppointment = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const publicBooking = !req.user;
    const appointment = await appointmentService.createAppointment(req.body, req.user, req, publicBooking);
    res.status(201).json({ success: true, message: "Appointment booked successfully", appointment });
  } catch (error) {
    next(error);
  }
};

exports.getAppointments = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = await appointmentService.buildAppointmentFilter(req.query, req.user);
    const [total, appointments] = await Promise.all([
      Appointment.countDocuments(filter),
      appointmentService.populateAppointmentQuery(
        Appointment.find(filter)
          .sort({ startAt: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ),
    ]);
    res.json({ success: true, appointments, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
};

exports.getCalendar = async (req, res, next) => {
  try {
    const filter = await appointmentService.buildAppointmentFilter(req.query, req.user);
    const appointments = await appointmentService.populateAppointmentQuery(
      Appointment.find(filter).sort({ startAt: 1 })
    );
    const events = appointments.map((appointment) => ({
      id: appointment._id,
      title: appointment.title,
      start: appointment.startAt,
      end: appointment.endAt,
      status: appointment.status,
      type: appointment.type,
      caseId: appointment.caseId,
      assignedTo: appointment.assignedTo,
      meetingUrl: appointment.meetingUrl,
      location: appointment.location,
    }));
    res.json({ success: true, count: events.length, events, appointments });
  } catch (error) {
    next(error);
  }
};

exports.getAvailability = async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user._id;
    const availability = await appointmentService.getAvailability({ ...req.query, userId });
    res.json({ success: true, ...availability });
  } catch (error) {
    next(error);
  }
};

exports.getDashboard = async (req, res, next) => {
  try {
    const dashboard = await appointmentService.getDashboard(req.query, req.user);
    res.json({ success: true, dashboard });
  } catch (error) {
    next(error);
  }
};

exports.getMyAppointments = async (req, res, next) => {
  try {
    const filter = await appointmentService.buildAppointmentFilter(req.query, req.user);
    const appointments = await Appointment.find(filter).sort({ startAt: 1, createdAt: -1 });
    res.json(appointments);
  } catch (error) {
    next(error);
  }
};

exports.getAppointment = async (req, res, next) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user);
    res.json({ success: true, appointment });
  } catch (error) {
    next(error);
  }
};

exports.updateAppointment = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const appointment = await getAppointmentOr404(req.params.id, req.user);
    const updated = await appointmentService.updateAppointment(appointment, req.body, req.user, req);
    res.json({ success: true, message: "Appointment updated", appointment: updated });
  } catch (error) {
    next(error);
  }
};

exports.updateAppointmentStatus = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const appointment = await getAppointmentOr404(req.params.id, req.user);
    const updated = await appointmentService.updateAppointment(appointment, req.body, req.user, req);
    res.json({ success: true, message: "Appointment updated", appointment: updated });
  } catch (error) {
    next(error);
  }
};

exports.cancelAppointment = async (req, res, next) => {
  try {
    const appointment = await getAppointmentOr404(req.params.id, req.user);
    const cancelled = await appointmentService.cancelAppointment(appointment, req.body, req.user, req);
    res.json({ success: true, message: "Appointment cancelled", appointment: cancelled });
  } catch (error) {
    next(error);
  }
};

exports.rescheduleAppointment = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const appointment = await getAppointmentOr404(req.params.id, req.user);
    const rescheduled = await appointmentService.rescheduleAppointment(appointment, req.body, req.user, req);
    res.json({ success: true, message: "Appointment rescheduled", appointment: rescheduled });
  } catch (error) {
    next(error);
  }
};

exports.sendDueReminders = async (req, res, next) => {
  try {
    const sent = await appointmentService.sendDueReminders();
    res.json({ success: true, sent });
  } catch (error) {
    next(error);
  }
};

exports.syncCalendar = async (req, res, next) => {
  try {
    const result = await appointmentService.syncCalendar(req.user, req.body.provider || req.params.provider);
    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
};
