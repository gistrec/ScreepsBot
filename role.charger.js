const utils = require('utils');

const taskResource = require('task.resource');
const taskCreep  = require('task.creep');


const configurations = [
    {"energy": 300,  "max_count": 5, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE]}, // Когда на старте есть максимум 300 энергии, спавним простого перевозчика.
    {"energy": 500,  "max_count": 4, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1000, "max_count": 3, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleCharger = {
    spawn: function(room) {
        const spawns = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning});
        if (spawns.length == 0) {
            return true;
        }
        
        const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (charger.length >= creepConfiguration['max_count']) {
            return true;
        }
        
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Charger, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }
        
        const name = 'Charger' + Game.time;
        const role = 'charger';
        spawns[0].spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если бот
        if (taskCreep.checkTTL(creep) == OK) return;

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {     
            // Основные задачи:
            // * Заполнить спавн
            // * Заполнить extension
            // * Заполнить контейнеры
            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_LAB)       == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)   == OK) return;
        } else {
            // Основная задача:
            // * Поднимать ресурсы, пока не заполнится отсек
            if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;
        }
	}
};

module.exports = roleCharger;