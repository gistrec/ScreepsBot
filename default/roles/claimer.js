const utils = require('../utils');

const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');


const configurations = [
    {"energy": 1200, "parts": [CLAIM, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]}
]


STATUS_IDLE = "idle";
STATUS_CLAIMING = "claiming";
STATUS_BUILDING = "building";


const roleClaimer = {
    spawn: function() {
        if (Memory.expansion.status !== STATUS_CLAIMING) {
            return true;
        }

        const claimers = Object.keys(Game.creeps).filter((creepName) => Game.creeps[creepName].memory.role === 'claimer');
        if (claimers.length !== 0) {
            return true;
        }

        // TODO: Find nearest room.
        const room = Object.keys(Game.rooms).map(roomName => Game.rooms[roomName])
                               .filter(room => room.controller && room.controller.my)
                               .sort((lhv, rhv) => lhv.energyAvailable - rhv.energyAvailable)
                               .pop(); // Last
        const spawn = room.find(FIND_MY_SPAWNS)
                          .filter(spawn => !spawn.spawning && spawn.isActive())
                          .sort((lhv, rhv) => lhv.energy - rhv.energy)
                          .pop(); // Last
        if (!spawn) {
            return false;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Claimer, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const name = 'Claimer' + Game.time;
        const role = 'claimer';
        const spawn_room = room.name;
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, spawn_room }});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если у крипа нет ресурсов.
        if (creep.room.name == creep.memory.spawn_room && creep.store.getUsedCapacity() != creep.store.getCapacity()) {
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE]) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
            return; // Ждём появления ресурсов
        }

        const expand = Game.flags['Expand']
        if (!expand) {
            console.log('[EXPANSION] Expand flag not found - stop claiming')
            Memory.expansion.status = STATUS_IDLE;

            creep.suicide();
            return;
        }

        // Move to expand room
        if (expand.room != creep.room) {
            creep.moveTo(expand, {reusePath: 10});
            return;
        }

        // Attack or clime controller
        const controller = creep.room.controller;
        if (!controller.my) {
            if (controller.owner) {
                const status = creep.attackController(controller);
                if (status === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller);
                }
                return;
            } else {
                const status = creep.claimController(controller);
                if (status === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller);
                }
                return;
            }
        }

        // Upgrade controller to level 2
        taskStructure.upgradeController(creep);
        if (controller.level >= 2) {
            Memory.expansion.status = STATUS_BUILDING;
            console.log(`[${creep.room.name}] Claiming complete. Start building`);

            room.createConstructionSite(expand.pos.x + 2, expand.pos.y, STRUCTURE_SPAWN, creep.room.name);

            creep.suicide();
        }
	}
};

module.exports = roleClaimer;