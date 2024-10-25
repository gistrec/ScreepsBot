const taskRoom = require('./room');

// Структуры, которые ремонтируются каким-либо ботом
exports.repearing_structures = [];
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
    const target = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.room.name == creep.room.name
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.buildTarget(creep, target);
}


/**
 * Задача на починку цели. Алгоритм
 * 1. Едем к целе
 * 2. Чиним
 */
exports.repearTarget = function(creep, target) {
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
            console.log(`[repearTarget] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Задача на починку. Алгоритм:
 * @param {Array} types - типы структур для починки
 */
exports.startRepearClosestStructs = function(creep, types, full_health = false) {
    // Дорога не относится к моим структурам...

    const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) => types.includes(s.structureType) // Чиним заданный тип
                    && exports.repearing_structures.includes(s.id) == false // Структура еще никем не чинится
                    && ((full_health) ? (s.hits < s.hitsMax * 0.99) : (s.hits < s.hitsMax * 0.5))
                    && s.hits > 0
    });
    if (!target) return ERR_NOT_FOUND;

    creep.memory.repairing  = target.id;
    exports.repearing_structures.push(target.id)

    return exports.repearTarget(creep, target);
}

exports.continueRepearSturcture = function(creep) {
    if (creep.memory.repairing) {
        if (!exports.repearing_structures.includes(creep.memory.repairing)) {
            exports.repearing_structures.push(creep.memory.repairing)
        }

        const target_id = creep.memory.repairing;
        const target = Game.getObjectById(target_id);
        if (target && target.hits < target.hitsMax) {
            return exports.repearTarget(creep, target);
        } else {
            delete creep.memory.repairing;
            _.remove(exports.repearing_structures, id => id == target_id);
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