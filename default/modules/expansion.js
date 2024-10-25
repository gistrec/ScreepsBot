const profiler = require('../screeps-profiler');

const roleScout          = require('../roles/scout');
const roleClaimer        = require('../roles/claimer');
const roleRemoteUpgrader = require('../roles/remoteUpgrader');


STATUS_IDLE = "idle";
STATUS_CLAIMING = "claiming";
STATUS_BUILDING = "building";


exports.process = function() {
    const expand = Game.flags['Expand'];
    if (expand && Memory.expansion.status == STATUS_IDLE) {
        console.log(`[EXPANSION] Start new expansion to ${expand.pos.roomName}`);
        Memory.expansion.status = STATUS_CLAIMING;
        return
    }
    if (!expand && Memory.expansion.status != STATUS_IDLE) {
        console.log('[EXPANSION] Expand flag not found - stop claiming')
        Memory.expansion.status = STATUS_IDLE;

        expand.remove();
        return;
    }

    if (Game.time % 10 == 0) try {
        roleScout.spawn();
        roleClaimer.spawn();
        roleRemoteUpgrader.spawn();
    } catch(err) { err.log() };
}

//// Init module ////
if (!Memory.expansion) {
    Memory.expansion = {
        status: STATUS_IDLE
    }
}


exports.process = profiler.registerFN(exports.process, "expansion.process");
