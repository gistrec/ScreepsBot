const taskRoom = require('./room');
const utils = require('../utils');


/**
 * Функция проверяет может ли бот совершать основную задачу
 * или ему нужно поднять/добыть ресурсов
 *
 * TODO: Перенести функцию в модуль creeps
 */
exports.chechHarvesting = function(creep) {
    // Если бот заполнил трюм
    if(creep.memory.harvesting && !creep.store.getFreeCapacity()) {
        creep.memory.harvesting = false;
    }
    // Если бот опустошил трюм
    if(!creep.memory.harvesting && !creep.store.getUsedCapacity()) {
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
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },

                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][fillTarget] Error ${status} ${status.toStringStatus()}`)
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
    const candidates = utils.getStructuresByType(creep.room)[structure] || [];
    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => s.store && s.store.getFreeCapacity(RESOURCE_ENERGY) > count
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.fillTarget(creep, target);
}


// Низкоприоритетная фоновая задача: закидываем nuker энергией/гудиумом, но только
// когда комната "спокойна" - давно нет атаки, есть избыток ресурсов. Пороги переопределяются
// через memory: nuker_fill_min_total_energy, nuker_fill_peace_ticks.
exports.nukerFillSafe = function(room) {
    if (room.memory.enemy_creeps) return false;

    const minEnergy = room.memory.nuker_fill_min_total_energy || 1_500_000;
    if (room.getTotalEnergy() < minEnergy) return false;

    const minPeace = room.memory.nuker_fill_peace_ticks || 5000;
    if (room.memory.last_attack_at && Game.time - room.memory.last_attack_at < minPeace) return false;

    return true;
}

// Обёртка над fillClosestStructure(NUKER) с проверкой безопасности. Вызывается из
// charger/upgrader в самом конце fill-цепочки.
exports.fillNukerIfCalm = function(creep) {
    if (!exports.nukerFillSafe(creep.room)) return ERR_NOT_FOUND;
    return exports.fillClosestStructure(creep, STRUCTURE_NUKER);
}

// Раз в N тиков шедулим charger transfer: ghodium из storage/terminal -> nuker.
// Энергию nuker'у заливает обычная fill-цепочка через fillNukerIfCalm.
exports.scheduleNukerGhodium = function(room) {
    if (!exports.nukerFillSafe(room)) return;

    const nukers = utils.getMyStructuresByType(room)[STRUCTURE_NUKER] || [];
    const nuker = nukers[0];
    if (!nuker) return;
    if (nuker.store.getFreeCapacity(RESOURCE_GHODIUM) == 0) return;

    const source = [room.storage, room.terminal].find(s => s && s.store.getUsedCapacity(RESOURCE_GHODIUM) >= 100);
    if (!source) return;

    // Не шедулим повторно, если charger уже везёт.
    const alreadyAssigned = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role == 'charger'
                  && c.memory.transfer
                  && c.memory.transfer.target_id == nuker.id
                  && c.memory.transfer.resource_type == RESOURCE_GHODIUM
    }).length > 0;
    if (alreadyAssigned) return;

    console.log(`[${room.name}] Scheduling ghodium fill for nuker.`);
    room.transfer(RESOURCE_GHODIUM, source.id, nuker.id);
}


exports.pickupTarget = function(creep, target) {
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
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][pickupTarget] Error ${status} ${status.toStringStatus()}`)
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

    return exports.pickupTarget(creep, target);
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
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#ffffff' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][harvestTarget] Error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND
    }
}


/**
 * Использовать с осторожностью, т.к. функция не учитывает балансировку
 */
exports.harvestClosest = function(creep) {
    const target = creep.pos.findClosestByRange(FIND_SOURCES, {
        filter: (s) => s.energy != 0
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
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                maxRooms: 1,
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][withdrawTarget] Error ${status} ${status.toStringStatus()}`)
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
    const byType = utils.getStructuresByType(creep.room);
    const candidates = structures.flatMap(t => byType[t] || []);
    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => s.store && s.store.getUsedCapacity(resourceType) >= resourceCount
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.withdrawTarget(creep, target, resourceType, resourceCount);
}


exports.disassembleResource = function(creep) {
    const resourceType = creep.memory.disassemble;
    if (!resourceType) return ERR_NOT_FOUND;

    // Выкидываем лишние ресурсы крипа.
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
        creep.say(`Remove extra resource`);
        if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
        if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return OK;
        return OK;
    }

    const factory = creep.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType == STRUCTURE_FACTORY})[0];
    if (factory.store.getFreeCapacity() <= 5000) {
        if (creep.store.getUsedCapacity() != 0) {
            creep.say(`Remove battery`);
            exports.fillClosestStructure(creep, STRUCTURE_TERMINAL);
        } else {
            console.log(`[${creep.room.name}] Factory overflowing for disassemble resource ${resourceType}. Task was deleted.`);
            delete creep.memory.disassemble;
        }
        return OK;
    }


    if (creep.store.getFreeCapacity() > 0) {
        const result = exports.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_TERMINAL], resourceType);
        if (result == ERR_NOT_FOUND) {
            console.log(`[${creep.room.name}] Not found resource ${resourceType} for disassemble by creep ${creep.name}. Task was deleted.`);
            delete creep.memory.disassemble;
            return ERR_NOT_FOUND;
        }
    }else {
        exports.fillTarget(creep, factory, resourceType);
    }
    return OK;
}


exports.transferResource = function(creep) {
    const task = creep.memory.transfer;
    if (!task) return ERR_NOT_FOUND;

    const {resource_type, source_id, target_id, max_resource_count_in_target} = task;

    // Выкидываем лишние ресурсы крипа.
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resource_type)) {
        creep.say(`Remove extra resource`);
        if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return OK;
        if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
        return OK;
    }

    const source = Game.getObjectById(source_id)
    const target = Game.getObjectById(target_id);
    if (!source || !target) {
        console.log(`[${creep.room.name}] Not found source or target for transfer resource ${resource_type} by creep ${creep.name}. Task was deleted.`);
        delete creep.memory.transfer;
        return OK;
    }

    // Если некуда класть - выгружаем ресурсы и удаляем задачу.
    if (target.store.getFreeCapacity(resource_type) == 0) {
        if (creep.store.getUsedCapacity() != 0) {
            creep.say(`Remove extra resource`);
            exports.fillClosestStructure(creep, STRUCTURE_TERMINAL);
        } else {
            console.log(`[${creep.room.name}] ${target.structureType} is overflowed for transfer resource ${resource_type}. Task was deleted.`);
            delete creep.memory.transfer;
        }
        return OK;
    }

    exports.chechHarvesting(creep);
    if(creep.store.getUsedCapacity(resource_type)) {
        exports.fillTarget(creep, target, resource_type);
        return OK;
    } else {
        const targetResourceCount = target.store.getUsedCapacity(resource_type);
        if (max_resource_count_in_target && targetResourceCount > max_resource_count_in_target) {
            console.log(`[${creep.room.name}] Transfer of ${resource_type} using the creep ${creep.name} is completed - the target has ${targetResourceCount} resources.`);
            delete creep.memory.transfer;
        }

        const creepCapacity = creep.store.getFreeCapacity();
        const sourceResourceCount = source.store.getUsedCapacity(resource_type);
        if (!sourceResourceCount) {
            console.log(`[${creep.room.name}] Not found resource ${resource_type} for transfer by creep ${creep.name}. Task was deleted.`);
            delete creep.memory.transfer;
            return ERR_NOT_FOUND;
        }
        const result = exports.withdrawTarget(creep, source, resource_type, Math.min(creepCapacity, sourceResourceCount));
        return OK;
    }
}
