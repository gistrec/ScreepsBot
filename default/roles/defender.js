const utils = require('../utils');

const taskCreep     = require('../tasks/creep');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');

const MAX_PER_ROOM = 1;
const MAX_PER_DEFENDING_ROOM = 2;


const configurations = [
    // Когда на старте есть максимум 300 энергии, спавним простого рабочего.
    {"energy": 300,  "parts": [WORK, CARRY, MOVE, CARRY, MOVE]},
    // Когда появились 5 Extension (на 2 уровне контроллера).
    {"energy": 550,  "parts": [WORK, WORK, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1100, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleDefender = {
    rebalanceRepairing: function(room) {
        const MAX_CREEPS_PER_WALL = 1;

        const creeps = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role === 'defender'});
        const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART })
                          .sort((lhv, rhv) => { return rhv.hits - lhv.hits; });
        for (const chunk of _.chunk(creeps, MAX_CREEPS_PER_WALL)) {
            const wall = walls.pop();
            for (const creep of chunk) {
                creep.memory.repairing = wall.id;
            }
        }
        console.log("Rebalancing defenders");

    },
    spawn: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning && spawn.name == room.name}).shift();
        if (!spawn) {
            return true;
        }

        // Нет пушек и барьеров - защитник не нужен.
        if (room.controller.level <= 2) {
            return true;
        }

        const defenders = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == 'defender' });
        const max_count = (room.memory.defending)
            ? MAX_PER_DEFENDING_ROOM
            : MAX_PER_ROOM

        if (defenders.length >= max_count) {
            return true;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`Room ${room.name} need Defender, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const rampartDamaged = room.find(FIND_MY_STRUCTURES, { filter: (s) => STRUCTURE_RAMPART == s.structureType && (s.hits < s.hitsMax * 0.8) })
        const boost = rampartDamaged.length ? false : "XUH2O";

        const name = 'Defender' + Game.time;
        const role = 'defender';
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, boost }, energyStructures: [
            // Сначала выкачиваем энергию из экстеншенов.
            ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_EXTENSION}),
            spawn
        ]});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Лечим бота только во время защитного режима
        if (taskCreep.checkTTL(creep) == OK) return;

        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Первоочередная задача:
            // * Заполнить башню
            const minInsufficientEnergy = (creep.room.memory.defending) ? 100 : 200; // В режиме осады всегда заправляем башню энергией.
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, minInsufficientEnergy) == OK) return;
	
            // Второстепенная задача:
            // * накачать энергией барьер
            if (taskStructure.continueRepearSturcture(creep) == OK) return;
            if (taskStructure.startRepearClosestStructs(creep, [STRUCTURE_RAMPART], true) == OK) return;
            // if (taskStructure.startRepearClosestStructs(creep, [STRUCTURE_WALL]) == OK) return;
        } else {
            // Основная задача:
            // * Получить ресурсы из хранилища
            // * Поднять ресурсы
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_FACTORY]) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
            if (!creep.room.memory.enemy_creeps) {
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], true)  == OK) return;
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], false) == OK) return;
            }
        }
	}
};

module.exports = roleDefender;