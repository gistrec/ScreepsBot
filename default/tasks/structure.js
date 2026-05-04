const taskRoom = require('./room');
const utils = require('../utils');

// Структуры, которые ремонтируются каким-либо ботом
exports.repairing_structures = [];
exports.charging_structures = [];

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
            creep.moveTo(target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#00FF00' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[buildTarget] Error ${status}`)
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
    const target = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
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
            creep.moveTo(target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#00FF00' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[repairTarget] Error ${status}`)
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

    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => exports.repairing_structures.includes(s.id) == false
                    && ((full_health) ? (s.hits < s.hitsMax * 0.99) : (s.hits < s.hitsMax * 0.5))
                    && s.hits > 0
    });
    if (!target) return ERR_NOT_FOUND;

    creep.memory.repairing  = target.id;
    exports.repairing_structures.push(target.id)

    return exports.repairTarget(creep, target);
}

exports.continueRepairStructure = function(creep) {
    if (creep.memory.repairing) {
        if (!exports.repairing_structures.includes(creep.memory.repairing)) {
            exports.repairing_structures.push(creep.memory.repairing)
        }

        const target_id = creep.memory.repairing;
        const target = Game.getObjectById(target_id);
        // В осаде бросаем недоремонт всего, кроме рампартов - чтобы не торчать снаружи стен.
        const dropOnDefend = creep.room.isDefending && target && target.structureType != STRUCTURE_RAMPART;
        if (target && target.hits < target.hitsMax && !dropOnDefend) {
            return exports.repairTarget(creep, target);
        } else {
            delete creep.memory.repairing;
            _.remove(exports.repairing_structures, id => id == target_id);
        }
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
            console.log(`[dismantleTarget] Error ${status}`)
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

        case ERR_NOT_IN_RANGE:
            creep.moveTo(controller, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[upgradeController] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}