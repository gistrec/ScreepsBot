const taskRoom = require('./room');
const utils = require('../utils');
const settings = require('../settings');

// Структуры, которые прямо сейчас чинит какой-либо крип комнаты (id из memory.repairing).
// Per-tick Set на room.cache. Раньше был глобальный массив, из которого id уходил только
// когда тот же крип дочинивал цель: смерть крипа или rebalance (перезапись memory.repairing)
// оставляли id навсегда, и структура выпадала из startRepairClosestStructs до сброса global.
exports.repairingIds = function(room) {
    return room.cache('repairingIds', r => new Set(
        r.find(FIND_MY_CREEPS).map(c => c.memory.repairing).filter(Boolean)
    ));
}
exports.charging_structures = [];

// Целевые hits рампартов в мирное время до RCL 8. hitsMax рампарта - от 300k (RCL 2) до
// 300M (RCL 8), «чинить до hitsMax» на RCL<8 означает никогда не дойти до upgradeController.
// Башни чинят барьеры ниже порога 15k/100k (defend.fireTower, когда не заняты heal/attack),
// апгрейдеры доводят до этой цели. На RCL 8 и в осаде потолка нет (hitsMax) - как и было.
// Стены (STRUCTURE_WALL) сейчас никто не планирует к ремонту; ветка ниже - только чтобы
// ручная цель-стена не чинилась до 300M. Переопределение: настройка rampart_target_hits.
const RAMPART_TARGET_HITS = {1: 0, 2: 10000, 3: 30000, 4: 100000, 5: 300000, 6: 1000000, 7: 3000000};

exports.repairTargetHits = function(structure) {
    if (structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL) {
        return structure.hitsMax;
    }
    const room = structure.room;
    const level = room.controller ? room.controller.level : 0;
    if (room.isDefending || room.hasHostiles || level == 8) return structure.hitsMax;

    const override = settings.get(room, 'rampart_target_hits');
    const target = override !== null ? override : (RAMPART_TARGET_HITS[level] || 0);
    return Math.min(structure.hitsMax, target);
}

exports.hasHealingCreeps = function(spawn) {
    const creep = spawn.pos.findInRange(FIND_MY_CREEPS, 2, {
        filter: (c) => c.memory.healing
    });
    return creep.length != 0;
}

exports.buildTarget = function(creep, target) {
    if (creep.memory.action != 'build') {
        creep.memory.action = 'build';
        creep.say('🛠️ Build');
    }

    const status = creep.build(target);

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_IN_RANGE:
            // Недостижимая цель (utils.moveToTarget) - "цели нет", цепочка идёт дальше.
            if (utils.moveToTarget(creep, target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#00FF00' },
                maxRooms: 1,
            }) != OK) return ERR_NOT_FOUND;
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][buildTarget] ${creep.name} error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Задача на строительство ближайшей постройки. Алгоритм:
 * 1. Если постройки нет, то возвращаем ERR_NOT_FOUND
 * 2. Едем к постройке
 * 3. Строим постройку
 */
exports.buildClosest = function(creep) {
    // В осаде стройку паузим: construction site может стоять снаружи рампартов, и билдер
    // вылезет за барьер прямо под огонь. Возвращаем ERR_NOT_FOUND - вызывающие роли провалятся
    // на следующий fallback (ремонт рампартов, апгрейд контроллера и т.д.).
    if (creep.room.isDefending) return ERR_NOT_FOUND;

    // findClosestByRange по умолчанию ограничен текущей комнатой (range-based, без pathfinding),
    // дополнительный фильтр по room.name был избыточен.
    const target = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => !utils.isUnreachable(creep, s.id)
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.buildTarget(creep, target);
}


/**
 * Задача на починку цели. Алгоритм
 * 1. Едем к целе
 * 2. Чиним
 */
exports.repairTarget = function(creep, target) {
    if (creep.memory.action != 'repair') {
        creep.memory.action = 'repair';
        creep.say('🩹 Repair');
    }

    const status = creep.repair(target);

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_IN_RANGE:
            // Недостижимая цель (utils.moveToTarget) - "цели нет", цепочка идёт дальше.
            if (utils.moveToTarget(creep, target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#00FF00' },
                maxRooms: 1,
            }) != OK) return ERR_NOT_FOUND;
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][repairTarget] ${creep.name} error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Задача на починку. Алгоритм:
 * @param {Array} types - типы структур для починки
 */
exports.startRepairClosestStructs = function(creep, types, full_health = false) {
    // Берём кеш структур по типам - он уже посчитан другими find'ами в этом тике.
    const byType = utils.getStructuresByType(creep.room);
    const candidates = types.flatMap(t => byType[t] || []);

    const repairing = exports.repairingIds(creep.room);
    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => !repairing.has(s.id)
                    && s.hits < exports.repairTargetHits(s) * (full_health ? 0.99 : 0.5)
                    && s.hits > 0
                    && !utils.isUnreachable(creep, s.id)
    });
    if (!target) return ERR_NOT_FOUND;

    creep.memory.repairing  = target.id;
    repairing.add(target.id);

    return exports.repairTarget(creep, target);
}

exports.continueRepairStructure = function(creep) {
    if (creep.memory.repairing) {
        const target_id = creep.memory.repairing;
        const target = Game.getObjectById(target_id);
        // В осаде бросаем недоремонт всего, кроме рампартов - чтобы не торчать снаружи стен.
        const dropOnDefend = creep.room.isDefending && target && target.structureType != STRUCTURE_RAMPART;
        if (target && target.hits < exports.repairTargetHits(target) && !dropOnDefend) {
            const status = exports.repairTarget(creep, target);
            // Недостижимую цель (utils.moveToTarget) отпускаем: иначе repairingIds держит её
            // за этим крипом, и чинить её не пойдёт никто. Её же может снова раздать
            // rebalanceRepairing - тогда отпустим на первом тике, без moveTo.
            if (status == OK || !utils.isUnreachable(creep, target_id)) return status;
        }
        delete creep.memory.repairing;
        exports.repairingIds(creep.room).delete(target_id);
    }
    return ERR_NOT_FOUND;
}

exports.dismantleTarget = function(creep, target) {
    const status = creep.dismantle(target);

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 3
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][dismantleTarget] ${creep.name} error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND;
    }
}


/**
 * Улучшаем контроллер. Алгоритм:
 * 1. Едем к контроллеру
 * 2. Улучшаем
 */
exports.upgradeController = function(creep, controller = creep.room.controller) {
    if (!controller.my || controller.upgradeBlocked) {
        return ERR_NOT_FOUND;
    }
    if (creep.memory.action != 'controller') {
        creep.memory.action = 'controller';
        creep.say('🔼Controller');
    }
    const status = creep.upgradeController(controller);

    if (status == -1) {
        creep.say("Problem")
    }

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        // Без utils.moveToTarget: контроллер один, другого не выбрать, а ложное срабатывание
        // (проход занят дольше порога) оставило бы link-/controllerUpgrader'а стоять без moveTo.
        // Range 3 - ERR_NO_PATH здесь только если ближе 3 клеток не подойти вовсе.
        case ERR_NOT_IN_RANGE:
            creep.moveTo(controller, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][upgradeController] ${creep.name} error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND;
    }
}