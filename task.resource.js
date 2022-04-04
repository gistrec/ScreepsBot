const taskRoom = require('task.room');

/**
 * Функция проверяет может ли бот совершать основную задачу
 * или ему нужно поднять/добыть ресурсов
 *
 * TODO: Перенести функцию в модуль creeps
 */
exports.chechHarvesting = function(creep, resource = RESOURCE_ENERGY) {
    // Если бот заполнил трюм
    if(creep.memory.harvesting && !creep.store.getFreeCapacity(resource)) {
        creep.memory.harvesting = false;
    }
    // Если бот опустошил трюм
    if(!creep.memory.harvesting && !creep.store.getUsedCapacity(resource)) {
        creep.memory.harvesting = true;
    }
}



exports.fillTarget = function(creep, target, resourceType = RESOURCES_ALL) {
    if (creep.memory.action != 'charge') {
        creep.memory.action = 'charge';
        creep.say('🔋 Charge');
    }

    // transfer all resources
    const status = (() => {
        if (resourceType != RESOURCES_ALL) {
            return creep.transfer(target, resourceType);
        }

        for(const resourceType in creep.store) {
            const status = creep.transfer(target, resourceType);
            if (status != OK) return status;
        }
        return OK;
    })();

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(target, {
                costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[fillTarget] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Заполняем ближайшую незаполненную структуру.
 * @param {Object} creep     - бот
 * @param {String} structure - тип структуры, которую нужно заполнить
 * @param {Number} count     - количество ресурсов, для заполнения структуры
 */
exports.fillClosestStructure = function(creep, structure, count = 0) {
    // TODO: Добавить поиск по FIND_MY_STRUCTURES
    const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) => s.structureType == structure
                    && s.store.getFreeCapacity([RESOURCE_ENERGY]) > count
                    && s.room.name == creep.room.name
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.fillTarget(creep, target);
}



const pickupTarget = function(creep, target) {
    if (creep.memory.action != 'charge') {
        creep.memory.action = 'charge';
        creep.say('🔺 Pickup');
    }

    const status = creep.pickup(target)

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(target, {
                costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[pickupTarget] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Поднимаем ближайшие ресурсы
 * @param {Object}  creep      - бот
 * @param {Array}   types      - типы ресурсов
 * @param {Boolean} full_cargo - нужно ли заполнять трюм полностью
 */
exports.pickupClosestResources = function(creep, types, full_cargo = false) {
    let target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (resource) => types.includes(resource.resourceType) // Поднимаем заданные ресурсы
                           && (full_cargo ? resource.amount >= creep.store.getFreeCapacity() : true)
    });
    if (!target) return ERR_NOT_FOUND;

    return pickupTarget(creep, target);
}

/**
 * Добываем ресурсы
 */
exports.harvestTarget = function(creep, target) {
    if (creep.memory.action != 'harvest') {
        creep.memory.action = 'harvest';
        creep.say('⛏️ Harvest');
    }

    const status = creep.harvest(target);

    switch (status) {
        case OK: // Success
        case ERR_BUSY: // Крип еще создается
        case ERR_TIRED: // Экстрактор перезаряжается
        case ERR_NOT_ENOUGH_RESOURCES: // Нет ресурсов
            return OK;

        case ERR_NOT_IN_RANGE:
            const result = creep.moveTo(target, {
                costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#ffffff' },
                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[harvestTarget] Error ${status}`)
            return ERR_NOT_FOUND
    }
}

/**
 * Использовать с осторожностью, т.к. функция не учитывает балансировку
 */
exports.harvestClosest = function(creep) {
    let target = creep.pos.findClosestByRange(FIND_SOURCES, {
        filter: (s) => s.room.name == creep.room.name
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.harvestTarget(creep, target);
}


/**
 * Получаем ресурсы из хранилища.
 * @param creep         - Крип.
 * @param target        - Хринилище, откуда нужно получить ресурсы.
 * @param resourceType  - Количество ресурсов, которые нужно получить.
 * @param resourceCount - Количество ресурсов, которые нужно получить.
 *                        Если не указано, то получаем все доступные ресурсы.
 */
exports.withdrawTarget = function(creep, target, resourceType = RESOURCE_ENERGY, resourceCount = 0) {
    if (creep.memory.action != 'withdraw') {
        creep.memory.action = 'withdraw';
        creep.say('⛏️ Withdraw');
    }

    const status = creep.withdraw(target, resourceType, resourceCount);

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_ENOUGH_RESOURCES:
            return ERR_NOT_FOUND;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(target, {
                costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[withdrawTarget] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}

/**
 * Получаем ресурсы из ближайшего хранилища.
 * @param creep         - Крип.
 * @param structures    - Типы структур, откуда получить ресурсы.
 * @param resourceType  - Тип ресурсов, которые нужно получить.
 * @param resourceCount - Количество ресурсов, которые нужно получить.
 *                        Если не указано, то получаем все доступные ресурсы.
 */
exports.withdrawClosestResources = function(creep, structures, resourceType = RESOURCE_ENERGY, resourceCount = 0) {
    if (resourceCount === 0) {
        resourceCount = creep.store.getFreeCapacity();
    }
    const target = creep.pos.findClosestByRange(FIND_STRUCTURES, { // Контейнер общая структура
        filter: (structure) => {
            return structures.indexOf(structure.structureType) != -1
                && structure.room.name == creep.room.name
                && structure.store
                && structure.store.getUsedCapacity(resourceType) > resourceCount
        }
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.withdrawTarget(creep, target, resourceType, resourceCount);
}