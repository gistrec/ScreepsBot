const taskRoom = require('./room');
const utils = require('../utils');
const settings = require('../settings');


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
            // Нечего отдавать - не ошибка transfer'а (ERR_NOT_ENOUGH_RESOURCES с "⚠️Error" в лог
            // каждый тик), а "эта цель не для нас": чарджер с одним минералом в трюме доходит
            // до energy-only шагов цепочки (lab, power_spawn) и должен пройти дальше.
            if (!creep.store.getUsedCapacity(resourceType)) return ERR_NOT_FOUND;
            return creep.transfer(target, resourceType);
        }

        let issued = false;
        for(const resourceType in creep.store) {
            // getFreeCapacity возвращает null если структура не принимает этот ресурс
            // (lab с другим mineralType, spawn/ext/tower с минералом). Пропускаем -
            // иначе transfer вернёт ERR_INVALID_TARGET и вся цепочка fill упадёт.
            const free = target.store.getFreeCapacity(resourceType);
            if (free === null || free === 0) continue;
            const status = creep.transfer(target, resourceType);
            if (status != OK) return status;
            issued = true;
        }
        // Цель не принимает ничего из трюма (башня/спавн при минерале в трюме, lab с чужим
        // минералом). Раньше возвращали OK: вызывающий считал цель найденной, и чарджер
        // с минералом после удалённой transfer-задачи вставал на шаге "tower" навсегда,
        // не доходя до terminal/storage. Теперь это "цели нет" - цепочка идёт дальше.
        return issued ? OK : ERR_NOT_FOUND;
    })();

    switch (status) {
        case OK:
        case ERR_BUSY: // Бот еще спавнится
            return OK;

        case ERR_NOT_FOUND: // Нечего/некуда класть - цели нет (см. выше), без лога
            return ERR_NOT_FOUND;

        case ERR_NOT_IN_RANGE:
            // Недостижимая цель (utils.moveToTarget) - "цели нет", цепочка идёт дальше.
            if (utils.moveToTarget(creep, target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                // Цель стационарная (spawn/extension/tower/storage/etc), безопасно держать
                // путь 15 тиков вместо дефолтных 5 - 3× меньше PathFinder.search вызовов.
                reusePath: 15,
                maxRooms: 1
            }) != OK) return ERR_NOT_FOUND;
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[${creep.room.name}][fillTarget] Error ${status} ${status.toStringStatus()}`)
            return ERR_NOT_FOUND;
    }
}


/**
 * Заполняем ближайшую незаполненную структуру.
 * @param {Object} creep        - бот
 * @param {String} structure    - тип структуры, которую нужно заполнить
 * @param {Number} count        - количество ресурсов, для заполнения структуры
 * @param {String} resourceType - что класть: по умолчанию всё из трюма (RESOURCES_ALL);
 *                                RESOURCE_ENERGY - только энергию (lab из fill-цепочки:
 *                                иначе случайный минерал из трюма уедет в реакционную лабу)
 */
exports.fillClosestStructure = function(creep, structure, count = 0, resourceType = RESOURCES_ALL) {
    const candidates = utils.getStructuresByType(creep.room)[structure] || [];
    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => s.store && s.store.getFreeCapacity(RESOURCE_ENERGY) > count
                    && !utils.isUnreachable(creep, s.id)
    });
    if (!target) return ERR_NOT_FOUND;

    return exports.fillTarget(creep, target, resourceType);
}


// Низкоприоритетная фоновая задача: закидываем nuker энергией/гудиумом, но только
// когда комната "спокойна" - давно нет атаки, есть избыток ресурсов. Пороги - настройки
// nuker_fill_min_total_energy, nuker_fill_peace_ticks.
exports.nukerFillSafe = function(room) {
    if (room.hasHostiles) return false;

    const minEnergy = settings.get(room, 'nuker_fill_min_total_energy');
    if (room.getTotalEnergy() < minEnergy) return false;

    const minPeace = settings.get(room, 'nuker_fill_peace_ticks');
    if (room.memory.last_attack_at && Game.time - room.memory.last_attack_at < minPeace) return false;

    return true;
}

// Обёртка над fillClosestStructure(NUKER) с проверкой безопасности. Вызывается из
// charger/upgrader в самом конце fill-цепочки.
exports.fillNukerIfCalm = function(creep) {
    if (!exports.nukerFillSafe(creep.room)) return ERR_NOT_FOUND;
    return exports.fillClosestStructure(creep, STRUCTURE_NUKER);
}

// Мгновенная закупка минерала через market.deal по самому дешёвому SELL <= maxPrice.
// Используется для буста powerBank-сквада: банк decay'ится по тикам, ждать заполнения
// собственного BUY-ордера рискованно. Платим больше, но получаем минерал сейчас.
//
// Возвращает true, если в комнате (storage+terminal) уже >= need требуемого минерала
// (или мы только что докупили достаточно). Возвращает false, если докупить не удалось -
// caller должен повторить вызов на следующем проходе.
//
// Настройки (settings.js):
//   boost_buy_max_price[resourceType] - cap cr/u для конкретного минерала (0 = не покупать)
//   boost_buy_max_price_default       - cap cr/u по умолчанию (default 5000)
//   boost_buy_min_credits             - min credit reserve (default 500_000)
exports.buyMineralForBoost = function(room, resourceType, need) {
    if (!room.terminal) return false;
    if (need <= 0) return true;

    const have = (room.terminal ? room.terminal.store.getUsedCapacity(resourceType) : 0)
              + (room.storage  ? room.storage.store.getUsedCapacity(resourceType)  : 0);
    if (have >= need) return true;

    // cooldown - снимок начала тика; send этого тика (lab/balanceEnergy идут раньше powerBank в
    // main.js) ловит intentSent (prototypes/structure.js): процессор применяет send раньше deal,
    // ставит cooldown, и deal после него молча не исполняется (global-intents/market.js).
    if (room.terminal.cooldown > 0 || room.terminal.intentSent) return false;

    const shortfall = need - have;
    if (room.terminal.store.getFreeCapacity() < shortfall) {
        console.log(`[${room.name}][Boost-Buy] Terminal full, can't fit ${shortfall} ${resourceType}.`);
        return false;
    }

    const priceMap = settings.get(null, 'boost_buy_max_price');
    const perResource = priceMap ? priceMap[resourceType] : undefined;
    // get() проверяет элементы карты; typeof - отсутствующий минерал = "не задано".
    const maxPrice = typeof perResource === 'number'
        ? perResource : settings.get(null, 'boost_buy_max_price_default');
    const minCredits = settings.get(null, 'boost_buy_min_credits');
    // 0 = не покупать (осознанная настройка): молча, без дорогого getAllOrders() + sort и без
    // лога - зовётся каждые 10 тиков на pending банк и минерал.
    if (maxPrice <= 0) return false;

    const sellOrders = Game.market.getAllOrders({type: ORDER_SELL, resourceType})
        .filter(o => o.amount > 0 && o.roomName && o.price <= maxPrice)
        .sort((a, b) => a.price - b.price);
    if (sellOrders.length === 0) {
        console.log(`[${room.name}][Boost-Buy] No SELL orders for ${resourceType} <= ${maxPrice} cr/u (need ${shortfall}).`);
        return false;
    }

    const order = sellOrders[0];
    const buyAmount = Math.min(shortfall, order.amount, room.terminal.store.getFreeCapacity());
    const energyCost = Game.market.calcTransactionCost(buyAmount, room.name, order.roomName);
    if (room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyCost) {
        console.log(`[${room.name}][Boost-Buy] Terminal energy ${room.terminal.store.getUsedCapacity(RESOURCE_ENERGY)} < ${energyCost} (for ${buyAmount} ${resourceType} from ${order.roomName}).`);
        return false;
    }

    const totalCost = order.price * buyAmount;
    if (Game.market.credits - totalCost < minCredits) {
        console.log(`[${room.name}][Boost-Buy] Credits ${Game.market.credits} - ${totalCost} < reserve ${minCredits} for ${buyAmount} ${resourceType}.`);
        return false;
    }

    const result = Game.market.deal(order.id, buyAmount, room.name);
    if (result == OK) {
        console.log(`[${room.name}][Boost-Buy] Bought ${buyAmount} ${resourceType} @ ${order.price} cr/u from ${order.roomName} (cost ${totalCost} cr, energy ${energyCost}).`);
        // Второй deal с этого терминала в том же тике процессор молча пропустит (global-intents/
        // market.js: первый ставит cooldownTime прямо в объект) - помечаем терминал занятым, как
        // это делают обёртки prototypes/structure.js для send. Сам минерал появится в store только
        // со следующего тика: отвечаем "ещё нет", caller (ensureBoostMinerals) увидит его в
        // следующем проходе. Раньше OK второго deal засчитывался как купленный, сквад спавнился,
        // и boost_force-атакер ждал минерал у лабы до смерти.
        room.terminal._intentAt = Game.time;
        return false;
    }
    console.log(`[${room.name}][Boost-Buy] market.deal failed for ${resourceType}: ${result} ${result.toStringStatus()}`);
    return false;
}

// Покупка G для nuker'а через свой ORDER_BUY (а не market.deal по чужим SELL).
// Цена = min(max_price, cheapest_sell - 1), чтобы быть top-bid'ом и не переплачивать
// весь спред. Платим 5% fee на сумму ордера, продавец платит transaction cost.
//
// Настройки (settings.js):
//   nuker_buy_max_price      (room)   - потолок cr/unit, default 400 (0 = выключить)
//   nuker_buy_target_amount  (room)   - целевой запас G в комнате, default 5000
//   nuker_buy_min_credits    (global) - floor по кредитам (с учётом fee), default 100k
//
// Если ордер уже висит для этой комнаты+ресурса - повторно не создаём. Когда G насыщен
// (have >= target), активный ордер отменяем чтобы не висел и не съел fee при росте цены.
exports.buyNukerGhodium = function(room) {
    const nukers = utils.getMyStructuresByType(room)[STRUCTURE_NUKER] || [];
    const nuker = nukers[0];
    if (!nuker) return;
    if (!room.terminal) return;
    if (room.isDefending) return;

    const maxPrice = settings.get(room, 'nuker_buy_max_price');
    if (maxPrice <= 0) return;

    const targetAmount = settings.get(room, 'nuker_buy_target_amount');
    const minCredits   = settings.get(null, 'nuker_buy_min_credits');

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
        console.log(`[${room.name}][NUKER] createOrder failed: ${result} ${result.toStringStatus()}`);
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
    if (settings.get(room, 'power_disabled')) return;

    const ps = (utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [])[0];
    if (!ps) return;

    const minPower = settings.get(room, 'power_spawn_min_power');
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

// Power_spawn, которому пора долить энергии (свободно >= 1000), или null. Один порог на
// fill-цепочку (fillPowerSpawnEnergy) и на realDemand чарджера (roles/charger.js): без
// второго в насыщенной комнате (майнинг на паузе, линк пуст) чарджеру нечего нести, и
// power_spawn стоит с power, но без энергии.
// Энергия нужна только вместе с power: processPower тратит 50 energy + 1 power за тик
// (modules/power.js), без power в power_spawn'е и без чарджера, который его уже везёт
// (schedulePowerSpawnPower), энергия просто осядет. Под атакой не льём совсем (как и power -
// schedulePowerSpawnPower): энергия из защищённых складов нужна башням, а не GPL.
exports.powerSpawnNeedingEnergy = function(room) {
    if (settings.get(room, 'power_disabled')) return null;
    if (room.isUnderAttack) return null;
    const ps = (utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [])[0];
    if (!ps) return null;
    if (ps.store.getFreeCapacity(RESOURCE_ENERGY) < 1000) return null;
    const hasPower = ps.store.getUsedCapacity(RESOURCE_POWER) > 0
        || utils.creepsByRole(room, 'charger').some(c => c.memory.transfer
            && c.memory.transfer.target_id == ps.id
            && c.memory.transfer.resource_type == RESOURCE_POWER);
    if (!hasPower) return null;
    return ps;
}

// Заливает energy в power_spawn если он не полон. Возвращает OK когда задача найдена,
// чтобы выпасть из fill-chain. Включается в charger peace branch перед fillNukerIfCalm.
exports.fillPowerSpawnEnergy = function(creep) {
    const ps = exports.powerSpawnNeedingEnergy(creep.room);
    if (!ps) return ERR_NOT_FOUND;
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
            // Недостижимый дроп (utils.moveToTarget) - "цели нет", цепочка идёт дальше.
            if (utils.moveToTarget(creep, target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                // Pickup-цель (dropped resource) decay'ится но не двигается. reusePath:5
                // - конкретно для дропа риск что он испарится; 5 тиков ≈ 250 единиц decay,
                // приемлемо. Длиннее не делаем чтобы не идти к исчезнувшему дропу.
                reusePath: 5,
                maxRooms: 1,
            }) != OK) return ERR_NOT_FOUND;
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
                           && !utils.isUnreachable(creep, resource.id)
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

        // Без utils.moveToTarget: у всех вызывающих source/минерал закреплён (sources.get,
        // mineral_id) или выбран findClosestByPath (уже с учётом пути) - другого не выберут,
        // а частый ERR_NO_PATH здесь - временный (клетки у source заняты майнером/апгрейдерами):
        // чёрный список остановил бы майнера/харвестера на UNREACHABLE_TICKS.
        case ERR_NOT_IN_RANGE:
            const result = creep.moveTo(target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#ffffff' },
                // Source стационарен, путь к нему статичен. 3× меньше PathFinder вызовов.
                reusePath: 15,
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
            // Недостижимый склад (utils.moveToTarget) - "цели нет", цепочка идёт дальше.
            if (utils.moveToTarget(creep, target, {
                // costCallback: (roomName, costMatrix) => taskRoom.applyCostMatrixRewrites(roomName, costMatrix),
                visualizePathStyle: { stroke: '#FFFF33' },
                // Withdraw-цель стационарна (storage/terminal/container/link).
                reusePath: 15,
                maxRooms: 1,
            }) != OK) return ERR_NOT_FOUND;
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
 * @param minCount      - Минимум ресурса в складе, чтобы вообще к нему идти. По умолчанию
 *                        равен resourceCount: берём только полную порцию (чарджер не "висит"
 *                        на контейнере майнера, собирая по 10/тик). minCount = 1 - забрать
 *                        всё, что есть (остаток storage после атаки, хвост батареек): тогда
 *                        withdraw идёт на min(resourceCount, остаток), а не на resourceCount,
 *                        иначе движок вернёт ERR_NOT_ENOUGH_RESOURCES.
 */
exports.withdrawClosestResources = function(creep, structures, resourceType = RESOURCE_ENERGY, resourceCount = 0, minCount = null) {
    if (resourceCount === 0) {
        resourceCount = creep.store.getFreeCapacity();
    }
    if (minCount === null) minCount = resourceCount;
    minCount = Math.max(1, minCount);
    const byType = utils.getStructuresByType(creep.room);
    const candidates = structures.flatMap(t => byType[t] || []);
    const target = creep.pos.findClosestByRange(candidates, {
        filter: (s) => s.store && s.store.getUsedCapacity(resourceType) >= minCount
                    && !utils.isUnreachable(creep, s.id)
    });
    if (!target) {
        // Склад с ресурсом есть, но в списке недостижимых (utils.moveToTarget) - это не "ресурса
        // нет": boost/disassemble по ERR_NOT_FOUND снимают задачу, а срок в списке временный.
        const blocked = candidates.some(s => s.store && s.store.getUsedCapacity(resourceType) >= minCount);
        return blocked ? ERR_NO_PATH : ERR_NOT_FOUND;
    }

    const amount = Math.min(resourceCount, target.store.getUsedCapacity(resourceType));
    return exports.withdrawTarget(creep, target, resourceType, amount);
}


// Трюм целиком занят чужим грузом, а terminal/storage выгрузку не приняли (полны или их нет).
// Энергию разнесёт fill-цепочка чарджера - отдаём ей тик (ERR_NOT_FOUND). Минералы/батарейки
// на пол не выбрасываем (никто не подберёт - та же политика, что dumpCargo в tasks/boost.js):
// стоим с задачей и ждём места, логируем раз в 100 тиков. Задачу не снимаем: alreadyAssigned-
// проверки диспетчеров видят её и не плодят дубли, а при появлении места груз выгрузится и
// задача продолжится.
function stallWithForeignCargo(creep, what) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY)) return ERR_NOT_FOUND;
    if (Game.time % 100 == 0) {
        console.log(`[${creep.room.name}] ${creep.name} can't unload foreign cargo for ${what}: terminal+storage full.`);
    }
    creep.say('🚧Stall');
    return OK;
}


// Склад/цель transfer-задачи недостижимы для этого крипа (utils.moveToTarget).
// fillTarget/withdrawTarget к ним уже не идут, а задача держала бы чарджера на месте до
// смерти. Снимаем: груз разнесёт fill-цепочка, диспетчер поставит задачу заново (тому же
// крипу - не поставит, см. Room.transfer). disassemble ставится вручную - её не снимаем.
function dropUnreachableTask(creep, key, object) {
    console.log(`[${creep.room.name}] ${creep.name} can't reach ${object.structureType} ${object.id} for ${key} task. Task was deleted.`);
    delete creep.memory[key];
    return ERR_NOT_FOUND;
}


exports.disassembleResource = function(creep) {
    const resourceType = creep.memory.disassemble;
    if (!resourceType) return ERR_NOT_FOUND;

    // INTERRUPT: при атаке/энерго-кризисе charger нужнее на оборонной/срочной заливке.
    // Не теряем задачу - просто пропускаем тик; вернёмся, когда условие снимется.
    if (shouldInterruptStatefulTask(creep)) return ERR_NOT_FOUND;

    // Выкидываем лишние ресурсы крипа. Только лишние (по одному за тик - интенты крипа
    // перезаписываются): раньше через RESOURCES_ALL уезжал весь трюм вместе с ресурсом задачи,
    // и из полного склада-источника (место в нём освобождается ровно на то, что взяли)
    // ресурс каждый второй тик возвращался обратно.
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
        creep.say(`Remove extra resource`);
        const extraType = Object.keys(creep.store).find(r => r != resourceType);
        if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL, 0, extraType) == OK) return OK;
        if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE, 0, extraType) == OK) return OK;
        // Выгрузить некуда: складов нет или оба физически полны. Раньше здесь был return OK -
        // чарджер стоял с задачей навсегда. Везём лишнее с собой: задача идёт на оставшейся
        // вместимости (fillTarget кладёт только resourceType), а выгрузка повторится, как
        // только место появится. Трюм целиком занят чужим грузом (ни места, ни resourceType) -
        // см. stallWithForeignCargo.
        if (creep.store.getFreeCapacity() == 0 && !creep.store.getUsedCapacity(resourceType)) {
            return stallWithForeignCargo(creep, `disassemble ${resourceType}`);
        }
    }

    const factory = creep.room.getFactory();
    if (!factory) {
        delete creep.memory.disassemble;
        return ERR_NOT_FOUND;
    }
    // Фабрика в списке недостижимых: задачу (ставится вручную, диспетчера нет) не снимаем -
    // пропускаем тик, цепочка чарджера идёт дальше; после срока фабрика перепроверится.
    if (utils.isUnreachable(creep, factory.id)) return ERR_NOT_FOUND;
    if (factory.store.getFreeCapacity() <= 5000) {
        if (creep.store.getUsedCapacity() != 0) {
            creep.say(`Remove battery`);
            if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
            if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return OK;
            // Некуда выгрузить - задачу всё равно снимаем (см. ниже), груз разнесёт fill-цепочка.
        }
        console.log(`[${creep.room.name}] Factory overflowing for disassemble resource ${resourceType}. Task was deleted.`);
        delete creep.memory.disassemble;
        return ERR_NOT_FOUND;
    }


    if (creep.store.getFreeCapacity() > 0) {
        // minCount 1: забираем и хвост (300 батареек при 600 свободных) - раньше фильтр
        // "store >= free" такой склад пропускал, и задача удалялась как "Not found".
        const result = exports.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_TERMINAL], resourceType, 0, 1);
        if (result == OK) return OK;
        // Ресурс есть только в недостижимых складах (ERR_NO_PATH) - ждём конца срока, не снимая
        // задачу; с грузом в трюме - довозим его в фабрику (ниже).
        if (result == ERR_NO_PATH && !creep.store.getUsedCapacity(resourceType)) return ERR_NOT_FOUND;
        // В складах не осталось. Если что-то уже в трюме - сначала довозим в фабрику и
        // только потом снимаем задачу, иначе хвост поехал бы обратно в storage fill-цепочкой.
        if (!creep.store.getUsedCapacity(resourceType)) {
            console.log(`[${creep.room.name}] Not found resource ${resourceType} for disassemble by creep ${creep.name}. Task was deleted.`);
            delete creep.memory.disassemble;
            return ERR_NOT_FOUND;
        }
    }
    exports.fillTarget(creep, factory, resourceType);
    return OK;
}


exports.transferResource = function(creep) {
    const task = creep.memory.transfer;
    if (!task) return ERR_NOT_FOUND;

    // INTERRUPT: при атаке/энерго-кризисе charger нужнее на оборонной/срочной заливке.
    // Не теряем задачу - просто пропускаем тик; вернёмся, когда условие снимется.
    if (shouldInterruptStatefulTask(creep)) return ERR_NOT_FOUND;

    const {resource_type, source_id, target_id, max_resource_count_in_target, min_resource_count_in_source} = task;

    // Выкидываем лишние ресурсы крипа (только лишние, см. disassembleResource).
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resource_type)) {
        creep.say(`Remove extra resource`);
        const extraType = Object.keys(creep.store).find(r => r != resource_type);
        if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE, 0, extraType) == OK) return OK;
        if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL, 0, extraType) == OK) return OK;
        // Выгрузить некуда (складов нет или оба физически полны) - см. disassembleResource:
        // везём лишнее с собой (fillTarget/withdrawTarget ниже работают только с resource_type
        // и остатком места); трюм целиком занят чужим грузом - stallWithForeignCargo.
        // Раньше - return OK, чарджер стоял с задачей навсегда.
        if (creep.store.getFreeCapacity() == 0 && !creep.store.getUsedCapacity(resource_type)) {
            return stallWithForeignCargo(creep, `transfer ${resource_type}`);
        }
    }

    // Снятие задачи ниже возвращает ERR_NOT_FOUND, а не OK: чарджер свободен уже на этом тике
    // (идёт в обычную цепочку), а не простаивает тик с пустышкой.
    const source = Game.getObjectById(source_id)
    const target = Game.getObjectById(target_id);
    if (!source || !target) {
        console.log(`[${creep.room.name}] Not found source or target for transfer resource ${resource_type} by creep ${creep.name}. Task was deleted.`);
        delete creep.memory.transfer;
        return ERR_NOT_FOUND;
    }
    if (utils.isUnreachable(creep, target_id)) return dropUnreachableTask(creep, 'transfer', target);
    if (utils.isUnreachable(creep, source_id)) return dropUnreachableTask(creep, 'transfer', source);

    // Target не принимает этот ресурс (getFreeCapacity === null, например лаба с
    // mineralType=X получила задачу на Y) - удаляем задачу, иначе fillTarget будет
    // спамить ERR_INVALID_TARGET каждый тик. null == 0 в JS равно false из-за
    // type-coercion правил (null loosely equals только undefined), поэтому
    // старый чек "== 0" этот случай не ловил.
    const freeCap = target.store.getFreeCapacity(resource_type);
    if (freeCap === null) {
        console.log(`[${creep.room.name}] ${target.structureType} ${target.id} rejects resource ${resource_type}. Task was deleted.`);
        delete creep.memory.transfer;
        return ERR_NOT_FOUND;
    }

    // Если некуда класть - выгружаем ресурсы и удаляем задачу.
    if (freeCap == 0) {
        if (creep.store.getUsedCapacity() != 0) {
            creep.say(`Remove extra resource`);
            if (exports.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
            if (exports.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return OK;
            // Терминал и storage полны (или их нет) - раньше возвращали OK, задача с грузом
            // висела навсегда. Снимаем задачу, груз разнесёт обычная fill-цепочка.
        }
        console.log(`[${creep.room.name}] ${target.structureType} is overflowed for transfer resource ${resource_type}. Task was deleted.`);
        delete creep.memory.transfer;
        return ERR_NOT_FOUND;
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
            return ERR_NOT_FOUND;
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
            return ERR_NOT_FOUND;
        }

        const creepCapacity = creep.store.getFreeCapacity();
        const result = exports.withdrawTarget(creep, source, resource_type, Math.min(creepCapacity, availableInSource));
        return OK;
    }
}
