const utils = require('utils');

const sources      = require('sources');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const configurations = [
    {"energy": 1100, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]},
];


const roleRemoteUpgrader = {
    spawn: function() {
        if (Memory.claiming.status !== 'remote_upgrader') {
            return true;
        }

        const remoteUpgraders = Object.keys(Game.creeps).filter((creepName) => Game.creeps[creepName].memory.role === 'remote_upgrader');
        if (remoteUpgraders.length >= 3) {
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
                          .filter(spawn => !spawn.spawning)
                          .sort((lhv, rhv) => lhv.energy - rhv.energy)
                          .pop(); // Last
        if (!spawn) {
            return false;
        }
                  
        const name = 'RemoteUpgrader' + Game.time;
        const role = 'remote_upgrader';
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Едем в удаленную комнату
        // const expand = Game.flags["Expand"];
        // TODO: Refactoring
        // if (expand && (expand.room == undefined || creep.room.name != Memory.claiming.roomName)) {
        //     creep.moveTo(expand);
        //     return;
        // }

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        if (creep.hits != creep.hitsMax) {
            creep.heal(creep);
        }

	    if(creep.memory.harvesting) {
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            
            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            
            const target = sources.get(creep);
            if (target.energy && taskResource.harvestTarget(creep, target) == OK) return;
            
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
        } else {
            // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepearSturcture(creep) == OK) return;
            if (taskStructure.buildClosest(creep) == OK) return;
            
            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 400) == OK) return;
            
	        const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER];
            if (taskStructure.startRepearClosestStructs(creep, types) == OK) return;
            
            // Ищем структуры, которые необходимо достроить
            if (taskStructure.buildClosest(creep) == OK) return;

            taskStructure.upgradeController(creep);

            // Is spawn built?
            const spawns = creep.room.find(FIND_MY_SPAWNS);
            if (spawns.length === 0) {
                return;
            }

            if (Memory.claiming.status != 'idle') {
                Memory.claiming = {
                    status: 'idle',
                    roomName: false,
                    controllerClaimed: false,
                    spawnBuilt: false,    
                }
                console.log(`Claimer has been claimed expand room controller in ${creep.room.name}`);
                console.log('Claiming status change remote_upgrader->idle');
                console.log('Flag Expand was deleted');
                expand.remove();
            }
            
            // Обновляем контроллер
            taskStructure.upgradeController(creep);
        }
	}
};

module.exports = roleRemoteUpgrader;