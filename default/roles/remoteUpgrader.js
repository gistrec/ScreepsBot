const utils = require('../utils');

const sources      = require('../sources');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');


const configurations = [
    {"energy": 1100, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]},
];


MAX_UPGRADERS = 3;

STATUS_IDLE = "idle";
STATUS_BUILDING = "building";


const roleRemoteUpgrader = {
    spawn: function() {
        if (Memory.expansion.status != STATUS_BUILDING) {
            return true;
        }

        const remoteUpgraders = Object.keys(Game.creeps).filter((creepName) => Game.creeps[creepName].memory.role === 'remote_upgrader');
        if (remoteUpgraders.length >= MAX_UPGRADERS) {
            return true;
        }

        // TODO: Find nearest room.
        const room = Object.keys(Game.rooms).map(roomName => Game.rooms[roomName])
                               .filter(room => room.controller && room.controller.my)
                               .sort((lhv, rhv) => lhv.energyAvailable - rhv.energyAvailable)
                               .pop(); // Last
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need RemoteUpgrader, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const spawn = room.find(FIND_MY_SPAWNS)
                          .filter(spawn => !spawn.spawning && spawn.isActive())
                          .sort((lhv, rhv) => lhv.energy - rhv.energy)
                          .pop(); // Last
        if (!spawn) return false;

        const name = 'RemoteUpgrader' + Game.time;
        const role = 'remote_upgrader';
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Едем в удаленную комнату
        const expand = Game.flags["Expand"];
        if (!expand) {
            console.log('[EXPANSION] Expand flag not found - stop claiming')
            Memory.expansion.status = STATUS_IDLE;

            // Не уничтожаем крипа
            return;
        } else if (expand.room.name != creep.room.name) {
            creep.moveTo(expand, {reusePath: 10});
            return;
        }

        // Проверяем не построен ли спавн
        const isTenthSecond = (Game.time % 10 === 0);
        if (isTenthSecond && Memory.expansion.status == STATUS_BUILDING) {
            const spawns = creep.room.find(FIND_MY_SPAWNS);
            if (spawns.length > 0) {
                Memory.expansion.status = STATUS_IDLE;

                console.log(`[${creep.room.name}][EXPANSION] Claiming finished. Spawn was built`);
                console.log(`[${creep.room.name}][EXPANSION] Flag Expand was deleted`);
                expand.remove();
                return;
            }
        }

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

	    if(creep.memory.harvesting) {
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;

            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;

            const target = sources.get(creep);
            if (target.energy && taskResource.harvestTarget(creep, target) == OK) return;

            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
        } else {
            // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepearSturcture(creep) == OK) return;
            if (taskStructure.buildClosest(creep) == OK) return;

            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 400) == OK) return;

	        const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER];
            if (taskStructure.startRepearClosestStructs(creep, types) == OK) return;

            taskStructure.upgradeController(creep);
        }
	}
};

module.exports = roleRemoteUpgrader;