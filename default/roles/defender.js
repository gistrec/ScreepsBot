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

        const creeps = utils.creepsByRole(room, 'defender');
        const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART });

        // Координация с rampartDefender'ами и реакция на nuke'и: rampart'ы под угрозой ремонтируются в первую очередь.
        const enemies = room.find(FIND_HOSTILE_CREEPS);
        const nukes   = room.find(FIND_NUKES);
        const isUnderThreat = (wall) => {
            if (enemies.some(e => wall.pos.inRangeTo(e, 5)))    return true;
            if (nukes.some(n   => wall.pos.inRangeTo(n.pos, 2))) return true;
            return false;
        };

        // Сначала под угрозой (по возрастанию hits), затем остальные (по возрастанию hits).
        // Используем .pop() в цикле ниже, поэтому сортируем по убыванию.
        walls.sort((lhv, rhv) => {
            const lThreat = isUnderThreat(lhv);
            const rThreat = isUnderThreat(rhv);
            if (lThreat != rThreat) return lThreat ? 1 : -1;  // под угрозой - в конец, чтобы pop'нуть первым
            return rhv.hits - lhv.hits;                        // более повреждённые - в конец
        });

        for (const chunk of _.chunk(creeps, MAX_CREEPS_PER_WALL)) {
            const wall = walls.pop();
            if (!wall) break;
            for (const creep of chunk) {
                creep.memory.repairing = wall.id;
            }
        }
        console.log(`[${room.name}][Defender] Rebalancing defenders`);

    },
    spawn: function(room) {
        const spawn = utils.findFreeSpawn(room, {requireActive: false});
        if (!spawn) {
            return true;
        }

        // Нет пушек и барьеров - защитник не нужен.
        if (room.controller.level <= 2) {
            return true;
        }

        const defenders = utils.creepsByRole(room, 'defender');
        const max_count = room.isDefending
            ? MAX_PER_DEFENDING_ROOM
            : MAX_PER_ROOM

        if (defenders.length >= max_count) {
            return true;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Need Defender, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
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
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

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
            const minInsufficientEnergy = creep.room.isDefending ? 100 : 200; // В режиме осады всегда заправляем башню энергией.
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, minInsufficientEnergy) == OK) return;
	
            // Второстепенная задача:
            // * накачать энергией барьер
            if (taskStructure.continueRepairStructure(creep) == OK) return;
            if (taskStructure.startRepairClosestStructs(creep, [STRUCTURE_RAMPART], true) == OK) return;
            // if (taskStructure.startRepairClosestStructs(creep, [STRUCTURE_WALL]) == OK) return;
        } else {
            // Основная задача:
            // * Получить ресурсы из хранилища
            // * Поднять ресурсы
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_FACTORY]) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
            if (!creep.room.hasHostiles) {
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], true)  == OK) return;
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], false) == OK) return;
            }
        }
	}
};

module.exports = roleDefender;