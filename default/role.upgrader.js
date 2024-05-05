const utils = require('utils');

const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const configurations = [
    {"energy": 300,  "max_count": 6, "parts": [WORK, MOVE, CARRY, MOVE, CARRY]}, // Когда на старте есть максимум 300 энергии, спавним простого рабочего
    {"energy": 550,  "max_count": 5, "parts": [WORK, WORK, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1100, "max_count": 4, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1700, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleUpgrader = {
    rebalanceRepairing: function(room) {
        const MAX_CREEPS_PER_WALL = room.memory.enemy_creeps ? 3 : 1;
        
        const creeps = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role === 'upgrader'});
        const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART })
                          .sort((lhv, rhv) => { return rhv.hits - lhv.hits; });
        for (const chunk of _.chunk(creeps, MAX_CREEPS_PER_WALL)) {
            const wall = walls.pop();
            if (!wall) {
                continue;
            }
            for (const creep of chunk) {
                creep.memory.repairing = wall.id;
            }
        }
        console.log("Rebalancing upgrader");
        
    },
    spawn: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => /* spawn.name == room.name && */ !spawn.spawning && spawn.isActive()}).shift();
        if (!spawn) {
            return true;
        }
        
        const upgraders = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "upgrader"});
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        
        let max_count = creepConfiguration["max_count"];
        let parts = creepConfiguration["parts"];
        
        if (upgraders.length >= max_count) {
            return true;
        }

        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Room need Upgrader, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }
        
        // Если в комнате больше 50к минералов, бустим...
        const energyCount = [room.terminal, room.storage].reduce((mineralsCount, structure) => {
            return mineralsCount + (structure ? structure.store.getUsedCapacity(RESOURCE_ENERGY) : 0)
        }, 0);
 
        const boost = (room.memory.enemy_creeps) ? "XLH2O" : false; // Boost repair and build
        const role = 'upgrader';
        const name = 'Upgrader' + Game.time;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(parts, name, {memory: {role, boost}, energyStructures });
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Не чиним крипа, у которого есть буст
        if (!creep.memory.boosted) {
            if (taskCreep.checkTTL(creep) == OK) return; // Проверяем TTL бота
        }

        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
	        if (creep.memory.link_id) {
	            taskStructure.upgradeController(creep);
	            return;
	        }

            if (creep.room.memory.need_maintain_controller) {
                taskStructure.upgradeController(creep);
                return;
            }

            // Ищем структуры, которые необходимо достроить
            if (taskStructure.buildClosest(creep) == OK) return;

	        // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepearSturcture(creep) == OK) return;
            
            // TODO: Если комнату осаждают, то чиним только RAMPART
	        const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER, STRUCTURE_RAMPART];
            if (taskStructure.startRepearClosestStructs(creep, types) == OK) return;
            
            if (creep.room.controller && creep.room.controller.my && creep.room.controller.level != 8) {
                if (taskStructure.upgradeController(creep) == OK) return;
            }
            
            // Заполняем нюкер.
            if (taskResource.fillClosestStructure(creep, STRUCTURE_NUKER)  == OK) return;
        }else {
	        if (creep.memory.link_id) {
	            taskResource.withdrawTarget(creep, Game.getObjectById(creep.memory.link_id));
                return;
	        }

            // Основная задача:
            // * Поднять лежащие ресурсы
            // * Получить ресурсы из хранилища
            if (!creep.room.memory.enemy_creeps || creep.room.controller.safeMode) {
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            }

            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE ], RESOURCE_ENERGY) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;            
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY ], RESOURCE_ENERGY) == OK) return;
        }
	}
};

module.exports = roleUpgrader;