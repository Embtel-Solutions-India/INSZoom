const { EventEmitter } = require("events");

// Module-level singleton — every write through SettingsEngineService fires
// "settings.changed" here. Runtime consumers (retention scheduler,
// notification gate, AI budget gate, feature-flag cache) subscribe once at
// startup and reconfigure immediately; no server restart needed for a
// setting change to take effect.
const settingsEvents = new EventEmitter();
settingsEvents.setMaxListeners(50);

module.exports = settingsEvents;
