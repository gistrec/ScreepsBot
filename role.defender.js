const utils = require('utils');

const taskResource  = require('task.resource');
const taskStructure = require('task.structure');

const MAX_PER_ROOM = 1;


const configurations = [
    // Когда на старте есть максимум 300 энергии, спавним простого рабочего.
    {"energy": 300, "parts": [WORK, CARRY, MOVE, CARRY, MOVE]},
    // Когда появились 5 Extension (на 2 уровне контроллера).
    {"energy": 550, "parts": [WORK, WORK, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    // {"energy": 1100, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleDefender = {
    spawn: function(room) {
        if (!room.memory.defending) {
            return true;
        }

        const spawns = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning});
        if (spawns.length == 0) {
            return true;
        }

        const defenders = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == 'defender' });
        if (defenders.length >= MAX_PER_ROOM) {
            return true;
        }
        
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Defender, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }
        
        const name = 'Defender' + Game.time;
        const role = 'defender';
        spawns[0].spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Лечим бота только во время защитного режима
        //if (creep.room.memory.defending) {
        //    if (taskCreep.checkTTL(creep) == OK) return;
        //}

        // Из-за хуёвой логики пушка не всегда заряжена, поэтому дефендер должен быть всегда!
        // TODO: Исправить это
        // if (taskCreep.checkTTL(creep) == OK) return;

        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Первоочередная задача:
            // * Заполнить башню
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 200) == OK) return;

            // Второстепенная задача:
            // * накачать энергией барьер
            const targets = creep.room.find(FIND_MY_STRUCTURES, {
                filter: (structure) => structure.structureType == STRUCTURE_RAMPART
                     && structure.hits != structure.hitsMax
                     && structure.hits > 0
            });
            if (targets.length) {
                target = targets[Math.floor(Math.random() * targets.length)];
                taskStructure.repearTarget(creep, target);
            }
        } else {
            // Основная задача:
            // * Получить ресурсы из хранилища
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER, STRUCTURE_STORAGE]) == OK) return;
            if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], true)  == OK) return;
            if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], false) == OK) return;
        }
	}
};

module.exports = roleDefender;