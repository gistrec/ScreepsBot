const utils = require('utils');

const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const configurations = [
    {"energy": 1200, "parts": [CLAIM, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]}
]


const roleClaimer = {
    spawn: function() {
        if (Memory.claiming.status !== 'claimer') {
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
                          .filter(spawn => !spawn.spawning)
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
            return
        }

        // Move to expand room.
        const expand = Game.flags['Expand'];
        if (expand && expand.room != creep.room) {
            creep.moveTo(expand, {reusePath: 10});
            return;
        }

        const controller = creep.room.controller;
        if (!controller.my) {
            const status = creep.claimController(controller);
            if (status == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
            }
            return;
        } else {
            taskStructure.upgradeController(creep);
            if (expand && controller.level >= 2) {
                expand.remove();
                Memory.claiming = {
                    status: 'idle',
                    roomName: false,
                    controllerClaimed: false,
                    spawnBuilt: false,    
                }
            }
        }
	}
};

module.exports = roleClaimer;