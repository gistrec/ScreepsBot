const taskCreep = require('../tasks/creep')
const taskBoost = require('../tasks/boost')
const utils = require('../utils')
const log = require('../log');

// energy == реальная стоимость тела (BODYPART_COST), иначе гейт по energyAvailable пропускает,
// а spawnCreep отвечает ERR_NOT_ENOUGH_ENERGY. Тиры: RCL 4-5 (cap 1300/1800) → 1160,
// RCL 6 (cap 2300) → 2280, RCL 7+ (cap 5600+) → 3400. Лимит MAX_CREEP_SIZE = 50 частей.
const configurations = [
    {"energy": 1160, "max_count": 2.0, "parts": [TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 CARRY,  CARRY,  MOVE,   MOVE,   MOVE,   MOVE,   MOVE]},
    {"energy": 2280, "max_count": 2.0, "parts": [TOUGH, TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 CARRY,  CARRY,  CARRY,  CARRY,
                                                 MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE]},
    {"energy": 3400, "max_count": 2.0, "parts": [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                                 CARRY,  CARRY,  CARRY,  CARRY,  CARRY,
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
        if (!room.isUnderAttack) {
            if (!force) return true;
        }

        const spawn = utils.findFreeSpawn(room);
        if (!spawn) {
            return true;
        }

        const creeps = utils.creepsByRole(room, "rampart_defender")
            .filter(c => c.ticksToLive > 150 && !c.spawning);
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creeps.length >= creepConfiguration['max_count']) {
            if (!force) return true;
        }

        // Минимальный конфиг (1160e) собирается только с RCL 4 (cap 1300). Если даже он не
        // влезает в активную ёмкость - ждать бессмысленно, не держим цепочку (upgrader и остальные).
        if (configurations[0].energy > utils.getEffectiveEnergyCapacity(room)) {
            return true;
        }

        // Ждём энергию так же, как miner/charger/upgrader: защитник приоритетнее ролей ниже
        // по цепочке, extension'ы дольются за несколько тиков.
        if (creepConfiguration.energy > room.energyAvailable) {
            log.info(`spawn-energy:${room.name}:rampart_defender`, `[${room.name}] Need RampartDefender, but not enought energy [${room.energyAvailable}/${creepConfiguration.energy}]`);
            utils.recordSpawnNeed(room, 'rampart_defender', creepConfiguration.energy);
            return false;
        }

        const boost_queue = ['XUH2O', 'XGHO2'];
        const name = utils.creepName('Rd', room);
        const role = 'rampart_defender'
        const energyStructures = utils.getEnergyStructures(room, spawn);
        const result = spawn.spawnCreep(creepConfiguration["parts"], name, { memory: { role, boost_queue }, energyStructures});
        if (result !== OK) {
            log.error(`spawn-fail:${room.name}:${role}:${result}`, `[${room.name}] spawnCreep ${role} failed: ${result} ${result.toStringStatus()}`);
            // Временный отказ - ждём, как на гейте по энергии; постоянный - не держим цепочку.
            return !utils.isTransientSpawnError(result);
        }
        log.info(`spawn:${room.name}:${role}`, `[${room.name}] Spawning new ${role} ${name}`);
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

        // Один find на 3 приоритета (хилеры > работяги > боевые) вместо трёх отдельных:
        // под атакой защитников бывает 2-3, каждый защитник сканировал комнату 3 раза за тик.
        // findClosestByRange(array) на уже отфильтрованной подмножестве не делает нового find.
        // Кеш per-tick шарится с defend.checkStatus/fireTower (несколько защитников = 0 лишних find).
        const allHostiles = creep.room.cache('hostileCreeps', r => r.find(FIND_HOSTILE_CREEPS));
        const closestWithPart = (...parts) => {
            const subset = allHostiles.filter(c => c.body.some(b => parts.includes(b.type)));
            return subset.length ? creep.pos.findClosestByRange(subset) : null;
        };
        const target = closestWithPart(HEAL)
                    || closestWithPart(WORK)
                    || closestWithPart(RANGED_ATTACK, ATTACK);
        if (target) creep.memory.attack_id = target.id;

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