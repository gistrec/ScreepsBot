const utils = require('../utils');
const log = require('../log');


const configurations = [
    {"energy": 200, "parts": [MOVE, MOVE, MOVE, MOVE]}
]


STATUS_CLAIMING = "claiming";


const roleClaimer = {
    spawn: function() {
        if (Memory.expansion.status !== 'scout') {
            return true;
        }

        const scouts = utils.allCreepsByRole('scout');
        if (scouts.length !== 0) {
            return true;
        }

        const expand = Game.flags['Expand'];
        if (!expand) return true;

        const room = utils.findNearestOwnRoom(expand.pos.roomName, {
            filter: r => r.energyCapacityAvailable >= configurations[0].energy,
        });
        if (!room) return true;

        const spawn = utils.findFreeSpawn(room, {primaryOnly: false, requireActive: false});
        if (!spawn) {
            return false;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            log.info(`spawn-energy:${room.name}:scout`, `[${room.name}] Need Scout, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            utils.recordModuleSpawnNeed(room, 'scout', creepConfiguration["energy"]);
            return false;
        }

        const name = 'Scout' + Game.time;
        const role = 'scout';
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        log.info(`spawn:${room.name}:scout`, `[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        const expand = Game.flags['Expand'];
        if (!expand) return;

        // Move to expand room.
        if (expand.room == undefined || expand.room != creep.room) {
            creep.moveTo(expand, {reusePath: 10});
            return;
        }
        if (!Memory.expansion.roomName || Memory.expansion.status == "scout") {
            Memory.expansion.roomName = creep.room.name;
            // Статус, который ждёт claimer.spawn (STATUS_CLAIMING); 'claimer' никто не читал.
            Memory.expansion.status = STATUS_CLAIMING;
            log.info('expansion:scout-found', `[${creep.room.name}][EXPANSION] Scout found expand room`);
            log.info('expansion:status', `[${creep.room.name}][EXPANSION] Claiming status change scout->${STATUS_CLAIMING}`);
        }

        // Idle...
	}
};

module.exports = roleClaimer;