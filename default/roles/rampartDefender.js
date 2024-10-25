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
    if (!Game.rooms[roomName]) {
        return costMatrix;
    }

    const ramparts = Game.rooms[roomName].find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART});
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
    },
    run: function(creep) {
        // Двигаемся к барьеру.
        let rampart = Game.getObjectById(creep.memory.rampart_id);
        if (rampart && !creep.pos.isEqualTo(rampart)) {
            creep.moveTo(rampart, {
                reusePath: false,
                plainCost: 2,
                swampCost: 10,
                ignoreRoads: true,
                costCallback: applyRampartsToCostMatrix,
            });
        }

        const target = (() => {
            // Ищем крипа, который собирается бить стенку.
            let enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {filter: (c) => _.some(c.body, body => body.type == WORK)});
            if (enemy) {
                creep.memory.attack_id = enemy.id;
                return enemy;
            }
            enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {filter: (c) => _.some(c.body, body => body.type == RANGED_ATTACK || body.type == ATTACK)});
            if (enemy) {
                creep.memory.attack_id = enemy.id;
                return enemy;
            }
        })();
        const oldRange = rampart
            ? rampart.pos.getRangeTo(target)
            : 999;

        // Ищем ближайший rampart к крипу.
        const usedRamparts = creep.room.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "rampart_defender"}).map(creep => creep.memory.rampart_id).filter(x => x);
        rampart = creep.room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART})
                            .sort((lhv, rhv) => lhv.pos.getRangeTo(target) - rhv.pos.getRangeTo(target))
                            .shift(); // First
        if (!rampart) {
            return;
        }

        const newRange = rampart.pos.getRangeTo(target);
        if (newRange < oldRange) {
            creep.memory.rampart_id = rampart.id;
        }

        if (target) {
            const result = creep.attack(target, );
        }
    }
};

module.exports = roleRampartDefender;