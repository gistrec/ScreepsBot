const taskCreep = require('../tasks/creep')
const taskBoost = require('../tasks/boost')
const utils = require('../utils')

const configurations = [
    {"energy": 1200, "max_count": 2.0, "parts": [TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 CARRY,  CARRY,  MOVE,   MOVE,   MOVE,   MOVE,   MOVE]},
    {"energy": 2270, "max_count": 2.0, "parts": [TOUGH, TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, CARRY,  CARRY,  CARRY,  CARRY,  CARRY,
                                                 MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE]},
    {"energy": 4800, "max_count": 2.0, "parts": [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, CARRY,  CARRY,  CARRY,  CARRY,  CARRY,
                                                 MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,
                                                 MOVE,   MOVE,   MOVE,   MOVE,   MOVE]}
];

const COST_MATRIX_MINIMUM_WEIGHT = 1;
const COST_MATRIX_UNWALKABLE_WEIGHT = 255;

const applyRampartsToCostMatrix = function(roomName, costMatrix) {
    const room = Game.rooms[roomName];
    if (!room) {
        return costMatrix;
    }

    const ramparts = utils.getMyStructuresByType(room)[STRUCTURE_RAMPART] || [];
    for (const rampart of ramparts) {
        if (costMatrix.get(rampart.pos.x, rampart.pos.y) < COST_MATRIX_UNWALKABLE_WEIGHT) {
            costMatrix.set(rampart.pos.x, rampart.pos.y, COST_MATRIX_MINIMUM_WEIGHT);
        }
    }
    return costMatrix;
}

const roleRampartDefender = {
    spawn: function(room, force = false) {
        if (!room.memory.enemy_creeps || room.controller.safeMode) {
            if (!force) return true;
        }

        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => spawn.name == room.name && !spawn.spawning}).shift();
        if (!spawn) {
            return true;
        }

        const creeps = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "rampart_defender" && (creep.ticksToLive > 150 && !creep.spawning) });
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creeps.length >= creepConfiguration['max_count']) {
            if (!force) return true;
        }

        const boost_queue = ['XUH2O', 'XGHO2'];
        const name = "Rd" + Game.time;
        const role = 'rampart_defender'
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration["parts"], name, { memory: { role, boost_queue }, energyStructures});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);
        return false;
    },
    run: function(creep) {
        // Двигаемся к барьеру.
        let rampart = Game.getObjectById(creep.memory.rampart_id);
        if (rampart && !creep.pos.isEqualTo(rampart)) {
            creep.moveTo(rampart, {
                // Цель статичная (rampart никуда не уходит). reusePath:10 экономит десятки CPU
                // под атакой: вместо нового PathFinder.search() каждый тик - раз в 10.
                // maxRooms:1 ограничивает поиск своей комнатой.
                reusePath: 10,
                maxRooms: 1,
                plainCost: 2,
                swampCost: 10,
                ignoreRoads: true,
                costCallback: applyRampartsToCostMatrix,
            });
        }

        const target = (() => {
            // Сначала хилеры - они нейтрализуют наш урон, без них остальные крипы умрут быстрее.
            let enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {filter: (c) => _.some(c.body, body => body.type == HEAL)});
            if (enemy) {
                creep.memory.attack_id = enemy.id;
                return enemy;
            }
            // Затем работяги, они грызут стены.
            enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {filter: (c) => _.some(c.body, body => body.type == WORK)});
            if (enemy) {
                creep.memory.attack_id = enemy.id;
                return enemy;
            }
            // Любые остальные с боевыми частями.
            enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {filter: (c) => _.some(c.body, body => body.type == RANGED_ATTACK || body.type == ATTACK)});
            if (enemy) {
                creep.memory.attack_id = enemy.id;
                return enemy;
            }
        })();

        // Перевыбираем rampart только при наличии цели - без неё getRangeTo даст NaN и сравнение сломается.
        if (target) {
            const oldRange = rampart ? rampart.pos.getRangeTo(target) : 999;

            // Исключаем rampart'ы, занятые другими defender'ами; свой текущий допускается.
            const usedRamparts = creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == "rampart_defender"
                            && c.id != creep.id
                            && c.memory.rampart_id
            }).map(c => c.memory.rampart_id);

            const allRamparts = utils.getMyStructuresByType(creep.room)[STRUCTURE_RAMPART] || [];
            const candidate = allRamparts
                .filter((s) => !usedRamparts.includes(s.id))
                .sort((lhv, rhv) => lhv.pos.getRangeTo(target) - rhv.pos.getRangeTo(target))
                .shift();

            if (candidate) {
                const newRange = candidate.pos.getRangeTo(target);
                if (newRange < oldRange) {
                    creep.memory.rampart_id = candidate.id;
                    rampart = candidate;
                }
            }

            // attack бьёт только в радиусе 1 - дёргать иначе бессмысленно (ERR_NOT_IN_RANGE в логах).
            if (creep.pos.inRangeTo(target, 1)) {
                creep.attack(target);
            }
        }
    }
};

module.exports = roleRampartDefender;