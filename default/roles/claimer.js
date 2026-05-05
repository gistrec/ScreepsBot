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

        const expand = Game.flags['Expand'];
        if (!expand) return true;

        const room = utils.findNearestOwnRoom(expand.pos.roomName, configurations[0].energy);
        if (!room) {
            console.log(`[EXPANSION] No own room with energyCapacity >= ${configurations[0].energy} for claimer`);
            return true;
        }

        const spawn = room.find(FIND_MY_SPAWNS, {filter: s => !s.spawning && s.isActive()}).shift();
        if (!spawn) {
            return false;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Need Claimer, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const name = 'Claimer' + Game.time;
        const role = 'claimer';
        const spawn_room = room.name;
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, spawn_room }});
        console.log(`[${room.name}] Spawning new ${role} ${name} for ${expand.pos.roomName}`);

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

            creep.room.createConstructionSite(expand.pos.x + 2, expand.pos.y, STRUCTURE_SPAWN, creep.room.name);

            creep.suicide();
        }
	}
};

module.exports = roleClaimer;