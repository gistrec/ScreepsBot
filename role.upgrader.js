const utils = require('utils');

const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const configurations = [
    {"energy": 300,  "max_count": 6, "parts": [WORK, MOVE, CARRY, MOVE, CARRY]}, // Когда на старте есть максимум 300 энергии, спавним простого рабочего
    {"energy": 550,  "max_count": 5, "parts": [WORK, WORK, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1100, "max_count": 4, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleUpgrader = {
    spawn: function(room) {
        const spawns = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning});
        if (spawns.length == 0) {
            return true;
        }
        
        const upgraders = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "upgrader"});
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (upgraders.length >= creepConfiguration['max_count']) {
            return true;
        }

        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Upgrader, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }
        
        const name = 'Upgrader' + Game.time;
        const role = 'upgrader';
        spawns[0].spawnCreep(creepConfiguration["parts"], name, {memory: {role}});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        if (taskCreep.checkTTL(creep) == OK) return; // Проверяем TTL бота

        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepearSturcture(creep) == OK) return;

            // Ищем структуры, которые необходимо достроить
            if (taskStructure.buildClosest(creep) == OK) return;

            // Второстепенная задача
            // Ищем структуры, которые нужно починить
            const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER];
            if (taskStructure.startRepearClosestStructs(creep, types) == OK) return;

            // Обновляем контроллер
            taskStructure.upgradeController(creep);
        }else {
            // TODO: Do not pickup resources in case of low energy in room
            // We need to add energy by charger

            // Основная задача:
            // * Поднять лежащие ресурсы
            // * Получить ресурсы из хранилища
            if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE]) == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE], RESOURCE_ENERGY, /* for a rainy day */ 10000) == OK) return;
        }
	}
};

module.exports = roleUpgrader;