// Phase 7.6b: the actor the pipeline uses when IT (not a person) approves an edition. With FORM_PIPELINE_AUTONOMY=on the approval of an imported edition is recorded as
// "system:pipeline" together with the certification it relied on, instead of borrowing the name of whoever asked for the run or the oldest admin (which made a machine
// decision look like a person's). It weakens nothing: the certification, the release gate and the edition-acceptance gate still decide whether the edition goes live.
//
// The pseudo id is a FIXED, valid ObjectId (the ASCII of "system:pipel") so it satisfies `approvedBy: ObjectId` and the release gate's "approved by someone" test, can never
// collide with a real user (real ids start with a timestamp), and populates to nothing.
const mongoose = require("mongoose");

const SYSTEM_ACTOR_ID = "73797374656d3a706970656c";
const SYSTEM_ACTOR_EMAIL = "system:pipeline";

const systemActor = () => ({ _id: new mongoose.Types.ObjectId(SYSTEM_ACTOR_ID), id: SYSTEM_ACTOR_ID, role: "system", email: SYSTEM_ACTOR_EMAIL, name: "System pipeline", isSystemActor: true });

/** True for the actor above (or anything carrying its id). */
const isSystemActor = (user) => Boolean(user && (user.isSystemActor === true || String(user._id || user.id || "") === SYSTEM_ACTOR_ID));

/**
 * Who approves this job's edition: the system actor when the autonomy switch is `on`, else the user the run already acts as (exactly today's behavior).
 * `mode` is injectable for tests.
 */
function approvedBy(user, { mode = require("../../config/formPipelineAutonomy").mode() } = {}) {
  return mode === "on" ? systemActor() : user;
}

module.exports = { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_EMAIL, systemActor, isSystemActor, approvedBy };
