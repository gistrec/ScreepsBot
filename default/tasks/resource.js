const taskRoom = require('./room');
const utils = require('../utils');


// Нужно ли прервать долгоживущую stateful-задачу (transfer, disassemble) - чтобы
// освободить charger'а на более срочное действие. Возвращает true только если
// креп НЕ везёт минералы: иначе они потеряются (стандартная fill-цепочка их не возьмёт).
// Прерывание не отменяет задачу, просто пропускает её на текущем тике.
function shouldInterruptStatefulTask(creep) {
    const room = creep.room;
    const lowEnergy = room.energyAvailable < room.energyCapacityAvailable * 0.3;
    if (!room.isUnderAttack && !lowEnergy) return false;

    // Безопасно прерывать только если в трюме одна энергия или пусто.
    return creep.store.getUsedCapacity() == creep.store.getUsedCapacity(RESOURCE_ENERGY);
}


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
    if (room.hasHostiles) return false;

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

// Покупка G для nuker'а через свой ORDER_BUY (а не market.deal по чужим SELL).
// Цена = min(max_price, cheapest_sell - 1), чтобы быть top-bid'ом и не переплачивать
// весь спред. Платим 5% fee на сумму ордера, продавец платит transaction cost.
//
// Memory overrides:
//   room.memory.nuker_buy_max_price      - потолок cr/unit, default 400 (0 = выключить)
//   room.memory.nuker_buy_target_amount  - целевой запас G в комнате, default 5000
//   Memory.nuker_buy_min_credits         - global floor по кредитам (с учётом fee), default 100k
//
// Если ордер уже висит для этой комнаты+ресурса - повторно не создаём. Когда G насыщен
// (have >= target), активный ордер отменяем чтобы не висел и не съел fee при росте цены.
exports.buyNukerGhodium = function(room) {
    const nukers = utils.getMyStructuresByType(room)[STRUCTURE_NUKER] || [];
    const nuker = nukers[0];
    if (!nuker) return;
    if (!room.terminal) return;
    if (room.isDefending) return;

    const maxPrice = (room.memory.nuker_buy_max_price !== undefined) ? room.memory.nuker_buy_max_price : 400;
    if (maxPrice <= 0) return;

    const targetAmount = room.memory.nuker_buy_target_amount || 5000;
    const minCredits   = Memory.nuker_buy_min_credits || 100000;

    const have = room.terminal.store.getUsedCapacity(RESOURCE_GHODIUM)
              + (room.storage ? room.storage.store.getUsedCapacity(RESOURCE_GHODIUM) : 0)
              + nuker.store.getUsedCapacity(RESOURCE_GHODIUM);
    const need = targetAmount - have;

    const existing = _.find(Game.market.orders, o =>
        o.type == ORDER_BUY
        && o.resourceType == RESOURCE_GHODIUM
        && o.roomName == room.name
        && o.remainingAmount > 0
    );

    if (need <= 0) {
        // Запасы достаточные - снимаем висящий ордер если он есть, чтобы fee не капал зря.
        if (existing) {
            Game.market.cancelOrder(existing.id);
            console.log(`[${room.name}][NUKER] Cancelled BUY order (G stockpile reached target).`);
        }
        return;
    }

    if (existing) return;  // Уже стоит, ждём fill.

    if (room.terminal.store.getFreeCapacity() < 100) return;

    const sellOrders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: RESOURCE_GHODIUM})
        .filter(o => o.amount > 0)
        .sort((a, b) => a.price - b.price);
    const lowestSell = sellOrders.length ? sellOrders[0].price : maxPrice;
    const ourPrice = Math.min(maxPrice, Math.max(1, lowestSell - 1));

    const fee = Math.ceil(ourPrice * need * 0.05);
    if (Game.market.credits - fee < minCredits) return;

    const result = Game.market.createOrder({
        type: ORDER_BUY,
        resourceType: RESOURCE_GHODIUM,
        price: ourPrice,
        totalAmount: need,
        roomName: room.name,
    });
    if (result == OK) {
        console.log(`[${room.name}][NUKER] Posted BUY ${need} G @ ${ourPrice} cr/u (fee ~${fee} cr, lowest sell ${lowestSell}).`);
    } else {
        console.log(`[${room.name}][NUKER] createOrder failed: ${result}`);
    }
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


// Power_spawn fill цикл (Phase 5). Power_spawn держит ENERGY_REGEN_TIME для процессинга,
// поэтому ему регулярно нужны и energy (заливает charger в fill chain), и power (его
// возит charger через transfer task из storage/terminal).

// Раз в N тиков шедулим charger transfer: power из terminal/storage -> power_spawn.
// Аналог scheduleNukerGhodium, но для RESOURCE_POWER. Throttle в main.js / modules/power.js.
exports.schedulePowerSpawnPower = function(room) {
    if (room.isUnderAttack) return;
    if (room.memory.power_disabled) return;

    const ps = (utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [])[0];
    if (!ps) return;

    const minPower = room.memory.power_spawn_min_power || 50;
    if (ps.store.getUsedCapacity(RESOURCE_POWER) >= minPower) return;
    if (ps.store.getFreeCapacity(RESOURCE_POWER) <= 0) return;

    const source = [room.terminal, room.storage].find(s => s && s.store.getUsedCapacity(RESOURCE_POWER) >= 50);
    if (!source) return;

    // Не дублируем если charger уже везёт power в этот power_spawn.
    const alreadyAssigned = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role == 'charger'
                  && c.memory.transfer
                  && c.memory.transfer.target_id == ps.id
                  && c.memory.transfer.resource_type == RESOURCE_POWER
    }).length > 0;
    if (alreadyAssigned) return;

    console.log(`[${room.name}] Scheduling power fill for power_spawn.`);
    room.transfer(RESOURCE_POWER, source.id, ps.id);
}

// Заливает energy в power_spawn если он не полон. Возвращает OK когда задача найдена,
// чтобы выпасть из fill-chain. Включается в charger peace branch перед fillNukerIfCalm.
exports.fillPowerSpawnEnergy = function(creep) {
    if (creep.room.memory.power_disabled) return ERR_NOT_FOUND;
    const ps = (utils.getMyStructuresByType(creep.room)[STRUCTURE_POWER_SPAWN] || [])[0];
    if (!ps) return ERR_NOT_FOUND;
    if (ps.store.getFreeCapacity(RESOURCE_ENERGY) < 1000) return ERR_NOT_FOUND;
    return exports.fillTarget(creep, ps, RESOURCE_ENERGY);
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

    // INTERRUPT: при атаке/энерго-кризисе charger нужнее на оборонной/срочной заливке.
    // Не теряем задачу - просто пропускаем тик; вернёмся, когда условие снимется.
    if (shouldInterruptStatefulTask(creep)) return ERR_NOT_FOUND;

    // Выкидываем лишние ресурсы крипа.
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
        creep.say(`Remove extra resource`);
        if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
        if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return OK;
        return OK;
    }

    const factory = creep.room.getFactory();
    if (!factory) {
        delete creep.memory.disassemble;
        return OK;
    }
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

    // INTERRUPT: при атаке/энерго-кризисе charger нужнее на оборонной/срочной заливке.
    // Не теряем задачу - просто пропускаем тик; вернёмся, когда условие снимется.
    if (shouldInterruptStatefulTask(creep)) return ERR_NOT_FOUND;

    const {resource_type, source_id, target_id, max_resource_count_in_target, min_resource_count_in_source} = task;

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

        const sourceResourceCount = source.store.getUsedCapacity(resource_type);
        if (!sourceResourceCount) {
            console.log(`[${creep.room.name}] Not found resource ${resource_type} for transfer by creep ${creep.name}. Task was deleted.`);
            delete creep.memory.transfer;
            return ERR_NOT_FOUND;
        }

        // Reserve a minimum stockpile in source (e.g., factory keeps a battery buffer).
        const availableInSource = min_resource_count_in_source != null
            ? sourceResourceCount - min_resource_count_in_source
            : sourceResourceCount;
        if (availableInSource <= 0) {
            console.log(`[${creep.room.name}] Transfer of ${resource_type} completed - source reserved minimum (${sourceResourceCount}/${min_resource_count_in_source}).`);
            delete creep.memory.transfer;
            return OK;
        }

        const creepCapacity = creep.store.getFreeCapacity();
        const result = exports.withdrawTarget(creep, source, resource_type, Math.min(creepCapacity, availableInSource));
        return OK;
    }
}
