const intakeService = require("./client-intake.service");

async function getMyIntake(req, res, next) {
  try {
    const intake = await intakeService.getMyIntake(req.user);
    res.json({ success: true, intake });
  } catch (error) {
    next(error);
  }
}

async function saveMyIntake(req, res, next) {
  try {
    const intake = await intakeService.saveClientIntake({
      user: req.user,
      caseId: req.body.caseId,
      payload: req.body,
      req,
      autoSave: req.body.autoSave === true,
    });
    res.json({ success: true, message: "Intake draft saved", intake });
  } catch (error) {
    next(error);
  }
}

async function submitMyIntake(req, res, next) {
  try {
    const intake = await intakeService.submitClientIntake({ user: req.user, caseId: req.body.caseId, req });
    res.json({ success: true, message: "Intake submitted", intake });
  } catch (error) {
    next(error);
  }
}

async function getCaseIntake(req, res, next) {
  try {
    const intake = await intakeService.getCaseIntake(req.params.caseId, req.user);
    res.json({ success: true, intake });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCaseIntake,
  getMyIntake,
  saveMyIntake,
  submitMyIntake,
};
