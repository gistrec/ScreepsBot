const taskResource = require('./resource');
const labModule    = require('modules/lab');
const utils        = require('utils');
const log = require('../log');

// Zero-CARRY крипы (powerBank attacker/healer) не могут сами перевозить ресурсы -
// делегируем заполнение/выгрузку лабы чарджеру через room.transfer. Перед каждой
// шедулировкой проверяем, нет ли уже такого таска (иначе переназначим каждый тик).
// sourceId == null - любой источник (для fill: склад может смениться между тиками).
function isChargerBusyWith(room, sourceId, targetId, resourceType) {
    return room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role == 'charger'
                  && c.memory.transfer
                  && (!sourceId || c.memory.transfer.source_id == sourceId)
                  && c.memory.transfer.target_id == targetId
                  && c.memory.transfer.resource_type == resourceType
    }).length > 0;
}

function hasFreeCharger(room) {
    return utils.creepsByRole(room, "charger").some(c => !c.memory.transfer);
}

// Склад с наибольшим запасом ресурса. Весь объём в одном складе не требуем:
// ensureBoostMinerals/buyMineralForBoost считают storage+terminal суммарно, а market.deal
// докладывает только shortfall в терминал - иначе "⏳Wait fill" навсегда. Когда склад
// опустеет, transfer-task удалится (см. transferResource) и следующий вызов возьмёт остаток
// из второго.
function findResourceSource(room, resourceType) {
    const stores = [room.storage, room.terminal].filter(s => s && s.store.getUsedCapacity(resourceType) > 0);
    return stores.length ? _.max(stores, s => s.store.getUsedCapacity(resourceType)) : null;
}

function chargerFillLab(creep, lab, resourceType, totalAmount) {
    if (!creep.pos.isNearTo(lab)) {
        creep.moveTo(lab, {visualizePathStyle: {stroke: '#0000FF'}, maxRooms: 1});
    }
    // Проверка занятости - до выбора склада: если "самый полный" склад сменился, пока чарджер
    // едет, не назначаем второго на ту же лабу.
    if (isChargerBusyWith(creep.room, null, lab.id, resourceType)) return;
    const source = findResourceSource(creep.room, resourceType);
    if (!source) return;
    if (!hasFreeCharger(creep.room)) return;
    // transferResource закрывает задачу по `target > max`: с totalAmount-1 первый же рейс,
    // доводящий лабу до нужного объёма, завершает задачу - без лишнего рейса и перелива
    // в типичном случае (склад с запасом >= need).
    creep.room.transfer(resourceType, source.id, lab.id, totalAmount - 1);
}

function chargerEvacLab(creep, lab, resourceType) {
    if (!creep.pos.isNearTo(lab)) {
        creep.moveTo(lab, {visualizePathStyle: {stroke: '#0000FF'}, maxRooms: 1});
    }
    const dest = creep.room.terminal && creep.room.terminal.store.getFreeCapacity() > 0
        ? creep.room.terminal
        : (creep.room.storage && creep.room.storage.store.getFreeCapacity() > 0 ? creep.room.storage : null);
    if (!dest) {
        // Терминал и storage оба переполнены - boost-задача висит, пока что-то не освободится.
        // Логируем редко (1/100 тиков), чтобы не спамить во время долгих stall'ов.
        if (Game.time % 100 == 0) {
            log.warn(`boost:evac-full:${creep.room.name}`, `[${creep.room.name}][Boost] ${creep.name} can't evac ${resourceType} from lab ${lab.id}: terminal+storage full.`);
        }
        creep.say('🚧Stall');
        return;
    }
    if (isChargerBusyWith(creep.room, lab.id, dest.id, resourceType)) return;
    if (!hasFreeCharger(creep.room)) return;
    creep.room.transfer(resourceType, lab.id, dest.id);
}

// Сброс "левого" груза CARRY-крипом: terminal -> storage. Оба физически полны - стоим и
// логируем редко, как chargerEvacLab; на пол не выкидываем (минералы никто не подберёт).
function dumpCargo(creep) {
    if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
    if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)  == OK) return OK;
    if (Game.time % 100 == 0) {
        log.warn(`boost:dump-full:${creep.room.name}`, `[${creep.room.name}][Boost] ${creep.name} can't dump cargo: terminal+storage full.`);
    }
    creep.say('🚧Stall');
    return ERR_NOT_FOUND;
}

/**
 * Проверяем можно ли забустить крипа (есть ли часть + у неё нет буста).
 */
exports.canBoost = function(creep, resourceType) {
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    return _.filter(creep.body, part => part.type == partType && !part.boost).length > 0;
}

/**
 * Проверяем есть ли буст у крипа.
 */
exports.hasBoost = function(creep, resourceType) {
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    if (!partType) {
        log.error('boost:bad-resource', `[${creep.room.name}][Boost] Not found resource type '${resourceType}' for check creep boost part`);
        return false
    }
    return _.filter(creep.body, part => part.type == partType && part.boost).length > 0;
}

/**
 * Если у крипа установлена переменная boost, то пытаемся забустить крипа минералом
 * Алгоритм:
 * 1. Получаем лабораторию, с которой будем работать
 *
 * 2. Пока в лаборатории не хватает энергии, то заполняем её энергией:
 *    2.1. Выкладываем все ресурсы в хранилище - нужно, чтобы освободить трюм
 *    2.2. Получаем энергию в хранилище
 *    2.3. Кладем её в лабораторию
 *
 * 3. Выкидываем лишние ресурсы из лаборатории.
 *
 * 4. Пока в лаборатории не хватает минерала, то заполняем его минералом:
 *    4.1. Выкладываем все ресурсы в хранилище - нужно, чтобы освободить трюм
 *    4.2. Получаем минерал в хранилище
 *    4.3. Кладем его в лабораторию
 *
 * 5. Бустим крипа
 */
exports.checkBoost = function(creep) {
    if (!creep.memory.boost && creep.memory.boost_queue) {
        creep.memory.boost = creep.memory.boost_queue.shift();
        // shift() мутировал массив до []. Сам по себе [] не вреден, но он остаётся
        // truthy и `!creep.memory.boost && creep.memory.boost_queue` срабатывает каждый
        // тик пустого shift возвращая undefined. Чистим - заодно memory dump чище.
        if (creep.memory.boost_queue.length === 0) {
            delete creep.memory.boost_queue;
        }
    }

    if (!creep.memory.boost) {
        // Нет задачи - lab_id висеть не должен: он резервирует лабу от реакций (lab.js) и
        // прячет её от других бустеров (usedLabs). Сюда же попадают orphan'ы из старых версий.
        // Исключение - unboost: checkUnboost (идёт следом) использует заранее заданный lab_id
        // и сам удаляет его по завершении.
        if (!creep.memory.unboost) delete creep.memory.lab_id;
        return ERR_NOT_FOUND;
    }

    // Spawning крип с CARRY-частями не может двигаться/таскать сам - ждём окончания спавна.
    // Zero-CARRY (powerBank attacker/healer) делегирует charger'у, fill можно pre-schedule
    // пока крип ещё в спавне (50 parts = 150 тиков) - к моменту выхода лаба уже залита,
    // boost'нется сразу, экономия до 100+ тиков на boost-минерал.
    if (creep.spawning && creep.body.some(p => p.type === CARRY)) {
        return ERR_NOT_FOUND;
    }

    // 1. Получаем лабораторию, с которой будем работать.
    const lab = (() => {
        if (creep.memory.lab_id) {
            return Game.getObjectById(creep.memory.lab_id);
        }

        // Source-лабы не трогаем никогда: refillLabs дозаливает их каждые 100 тиков, конфликт
        // неизбежен. Target-лабы берём под любой буст (раньше исключались все реакционные лабы,
        // и в лаб-комнатах свободных не оставалось - задача удалялась). lab.js пропускает лабу
        // в runReaction/forceEvac, пока creep.memory.lab_id указывает на неё.
        // Cooldown не фильтруем: boostCreep его не проверяет (ERR_TIRED в движке возвращают
        // только runReaction/unboostCreep).
        const labConfig = labModule.getLabConfig(creep.room);
        const sourceIds = new Set(labConfig ? labConfig.sources.map(l => l.id) : []);

        const usedLabs = Object.keys(Game.creeps).map(creepName => Game.creeps[creepName].memory.lab_id).filter(x => x);
        // moduleLab.process идёт раньше checkBoost: runReaction мог уже поставить чарджеру
        // выгрузку lab -> terminal/storage. Такую лабу не берём - чарджер продолжит её осушать
        // во время заливки (резерв lab.js закроет её только со следующего тика).
        const transferLabs = new Set();
        for (const c of utils.creepsByRole(creep.room, "charger")) {
            if (!c.memory.transfer) continue;
            transferLabs.add(c.memory.transfer.source_id);
            transferLabs.add(c.memory.transfer.target_id);
        }
        const candidates = (utils.getMyStructuresByType(creep.room)[STRUCTURE_LAB] || [])
            .filter(s => !usedLabs.includes(s.id) && !sourceIds.has(s.id) && !transferLabs.has(s.id));

        // Предпочитаем лабу без чужого минерала: иначе step 3 сначала выгружает остаток продукта
        // реакции (CARRY-крип сам, по трюму за рейс). Чистых нет - берём наименее заполненную;
        // под атакой - только если остаток влезает в 2 рейса, иначе бустить дороже, чем воевать
        // (non-force: задача удалится ниже, крип идёт на рампарт без буста).
        const clean = candidates.filter(s => !s.mineralType || s.mineralType == creep.memory.boost);
        if (clean.length) return creep.pos.findClosestByRange(clean);
        const dirty = creep.room.isUnderAttack
            ? candidates.filter(s => s.store.getUsedCapacity(s.mineralType) <= 2 * creep.store.getCapacity())
            : candidates;
        if (dirty.length == 0) return null;
        return _.min(dirty, s => s.store.getUsedCapacity(s.mineralType));
    })();

    if (!lab) {
        // lab_id мог указывать на снесённую лабу - сбрасываем, иначе getObjectById возвращает
        // null вечно: boost_force ждал бы до смерти, non-force терял бы и следующий буст очереди.
        delete creep.memory.lab_id;
        // Под boost_force ждём - все таргет-лабы могут быть заняты другими бустерами.
        // Удалять boost task нельзя: powerBank-сквад без буста не пробьёт банк.
        if (creep.memory.boost_force) {
            creep.say('⏳Wait lab');
            return OK;
        }
        log.warn(`boost:no-lab:${creep.room.name}`, `[${creep.room.name}][Boost] Not found lab for boost creep ${creep.name}. Boost task was deleted.`);
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }
    creep.memory.lab_id = lab.id;

    // Получаем основные данные, с которыми будем работать
    const resourceType = creep.memory.boost;
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    if (!partType) {
        log.error(`boost:bad-task:${creep.room.name}`, `[${creep.room.name}][Boost] Incorrect resource type '${resourceType}' for boost creep '${creep.name}'. Boost task was deleted.`);
        delete creep.memory.lab_id;
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }
    const partsCount = _.filter(creep.body, part => part.type == partType).length;
    if (!partsCount) {
        log.warn(`boost:no-parts:${creep.room.name}`, `[${creep.room.name}][Boost] Creep '${creep.name}' doesn't have '${partType}' parts for boost by '${resourceType}'. Boost task was deleted.`);
        delete creep.memory.lab_id;
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }

    // 2. Пока в лаборатории не хватает энергии, то заполняем её энергией
    const totalEnergy = LAB_BOOST_ENERGY * partsCount;                 // Количество энергии, необходимой для буста крипа
    const labEnergy   = lab.store.getUsedCapacity(RESOURCE_ENERGY);    // Количество энергии в лаборатории
    const creepEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);  // Количество энергии в крипе
    if (labEnergy < totalEnergy) {
        // Zero-CARRY (powerBank attacker/healer) сам ничего не возит - делегируем чарджеру.
        // У крипа без CARRY-частей store.getCapacity() возвращает null, не 0 - сверяемся
        // по телу напрямую. Сам крип в это время простаивает у лабы и ждёт чарджера.
        if (!creep.body.some(p => p.type === CARRY)) {
            creep.say("⏳Wait fill");
            chargerFillLab(creep, lab, RESOURCE_ENERGY, totalEnergy);
            return OK;
        }

        creep.say("⚡Fill lab")

        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
            dumpCargo(creep);
            return OK;
        }

        // Загружаем ресурсы в трюм пока:
        // 1. В трюме есть место
        // 2. Сумма ресурсов в крипе и лаборатории меньше, чем нужно для буста
        if (creep.store.getFreeCapacity() != 0 && (creepEnergy + labEnergy) < totalEnergy) {
            const needEnergy = totalEnergy - (creepEnergy + labEnergy);
            const energyCount = Math.min(needEnergy, creep.store.getFreeCapacity());
            const result = taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_TERMINAL], RESOURCE_ENERGY, energyCount);
            if (result == ERR_NOT_FOUND) {
                log.warn(`boost:no-energy:${creep.room.name}`, `[${creep.room.name}][Boost] Not found energy for boost creep ${creep.name}. Boost task was deleted.`);
                delete creep.memory.lab_id;
                delete creep.memory.boost;
                return ERR_NOT_FOUND;
            }
        }else {
            taskResource.fillTarget(creep, lab, RESOURCE_ENERGY);
        }
        return OK;
    }

    // 3. Выкидываем лишние ресурсы из лаборатории:
    // * Если в крипе лежат 'левые ресурсы'
    // * Если в лаборатории лежат 'левые ресурсы'
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)  || (lab.mineralType && lab.mineralType != resourceType)) {
        // Zero-CARRY: лабу опустошает чарджер; крипу нечем нести "левые" ресурсы.
        if (!creep.body.some(p => p.type === CARRY)) {
            if (lab.mineralType && lab.mineralType != resourceType && lab.store.getUsedCapacity(lab.mineralType) > 0) {
                chargerEvacLab(creep, lab, lab.mineralType);
            }
            return OK;
        }

        // Withdraw делаем только если в лабе ЧУЖОЙ минерал. Иначе (mineralType совпадает
        // с нужным resourceType) вытаскивали бы собственное буст-сырьё обратно в трюм -
        // ничего не разрешает, плюс мешаем последующим заливкам step 4.
        const labHasWrongMineral = lab.mineralType && lab.mineralType != resourceType
                                && lab.store.getUsedCapacity(lab.mineralType) > 0;
        if (labHasWrongMineral && creep.store.getFreeCapacity() > 0) {
            if (Game.time % 100 == 0) {
                log.debug(`boost:lab-wrong-mineral:${creep.room.name}`, `[${creep.room.name}][Boost] ${creep.name} withdraw extra mineral ${lab.mineralType} from lab ${lab.id}`)
            }
            taskResource.withdrawTarget(creep, lab, lab.mineralType);
        }else {
            // Терминал может быть забит (PowerBank-логика грузит его буст-минералами через
            // market.deal + chargerEvac), поэтому fallback на storage. Логируем редко, чтобы
            // не спамить во время длинного stall'а.
            if (Game.time % 100 == 0) {
                log.debug(`boost:extra-cargo:${creep.room.name}`, `[${creep.room.name}][Boost] ${creep.name} transfer extra cargo (lab=${lab.mineralType || 'empty'})`)
            }
            dumpCargo(creep);
        }
        return OK;
    }

    // 4. Пока в лаборатории не хватает минералов, то заполняем её минералами
    const totalResources = LAB_BOOST_MINERAL * partsCount;            // Количество нералов, необходимых для буста крипа
    const labResources   = lab.store.getUsedCapacity(resourceType);   // Количество минералов в лаборатории
    const creepResources = creep.store.getUsedCapacity(resourceType); // Количество минералов в крипе
    if (labResources < totalResources) {
        // Zero-CARRY: тоже делегируем чарджеру, сам крип ждёт у лабы.
        if (!creep.body.some(p => p.type === CARRY)) {
            creep.say("⏳Wait fill");
            chargerFillLab(creep, lab, resourceType, totalResources);
            return OK;
        }

        creep.say("💎Fill lab")

        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
            dumpCargo(creep);
            return OK;
        }

        // Загружаем ресурсы в трюм пока:
        // 1. В трюме есть место
        // 2. Сумма ресурсов в крипе и лаборатории меньше, чем нужно для буста
        if (creep.store.getFreeCapacity() != 0 && (creepResources + labResources) < totalResources) {
            const needResources = totalResources - (labResources + creepResources)
            const resourceCount = Math.min(needResources, creep.store.getFreeCapacity());
            const result = taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_TERMINAL], resourceType, resourceCount);
            if (result == ERR_NOT_FOUND) {
                log.warn(`boost:no-resource:${creep.room.name}:${resourceType}`, `[${creep.room.name}][Boost] Not found resource ${resourceType} for boost creep ${creep.name}. Boost task was deleted.`);
                delete creep.memory.lab_id;
                delete creep.memory.boost;
                return ERR_NOT_FOUND;
            }
        }else {
            taskResource.fillTarget(creep, lab, resourceType);
        }
        return OK;
    }

    // 5. Бустим крипа. Для spawning ничего не делаем - креп ещё не у лабы; fill уже
    // запланирован шагами 2/4, лаба заполнится за время оставшегося спавна.
    if (creep.spawning) return OK;

    const status = lab.boostCreep(creep, partsCount)
    switch (status) {
        case OK:
            delete creep.memory.lab_id;
            delete creep.memory.boost;
            creep.memory.boosted = true;
            return OK;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(lab, {
                costCallback: (roomName, costMatrix) => {
                    if (roomName == "W9S37") {
                        costMatrix.set(11, 45, 0);
                        costMatrix.set(12, 44, 0);
                    }
                },
                visualizePathStyle: {
                    stroke: '#0000FF'
                },
                maxRooms: 1
            });
            return OK;

        case ERR_TIRED:
            // Лаба только что отреагировала - cooldown спадёт, просто ждём.
            creep.say('⏳Cooldown');
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            log.error(`boost:error:${creep.room.name}:${status}`, `[${creep.room.name}][Boost] ${creep.name} error ${status} ${status.toStringStatus()}. Boost task was deleted`)
            delete creep.memory.lab_id
            delete creep.memory.boost
            return ERR_NOT_FOUND;
    }
}

exports.checkUnboost = function(creep) {
    if (!creep.memory.unboost || creep.spawning) {
        return ERR_NOT_FOUND;
    }

    // 1. Получаем лабораторию, с которой будем работать.
    const lab = (() => {
        if (creep.memory.lab_id) {
            const cached = Game.getObjectById(creep.memory.lab_id);
            if (cached && cached.isActive()) return cached;
            // Лаба снесена или выключена (downgrade RCL: unboostCreep -> ERR_RCL_NOT_ENOUGH) - выбираем заново.
            delete creep.memory.lab_id;
        }

        // Свободная лаба рядом с контейнером (unboostCreep роняет минерал на клетку крипа - стоим на
        // контейнере). Source-лабы не трогаем, как checkBoost: их держат refillLabs/runReaction, а
        // резерв по lab_id в lab.js действует только на target-лабы. Cooldown не фильтруем: при
        // работающем пайплайне target-лабы почти всегда в cooldown, и задача удалялась как
        // "Not found lab"; вместо этого ждём ERR_TIRED ниже - lab_id снимает лабу с реакций, cooldown спадёт.
        const labConfig = labModule.getLabConfig(creep.room);
        const sourceIds = new Set(labConfig ? labConfig.sources.map(l => l.id) : []);
        const usedLabs = Object.keys(Game.creeps).map(creepName => Game.creeps[creepName].memory.lab_id).filter(x => x);
        const containers = creep.room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER});
        const lab = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_LAB
                        && s.isActive()
                        && !sourceIds.has(s.id)
                        && !usedLabs.includes(s.id)
                        && _.some(containers, container => container.pos.isNearTo(s))
        });
        return lab;
    })();

    if (!lab) {
        log.warn(`unboost:no-lab:${creep.room.name}`, `[${creep.room.name}][Unboost] Not found lab for ${creep.name}. Unboost task was deleted.`);
        delete creep.memory.unboost;
        delete creep.memory.lab_id;
        delete creep.memory.unboost_container_id;
        return ERR_NOT_FOUND;
    }
    // Фиксируем лабу: без этого она выбиралась заново каждый тик (cooldown == 0), а контейнер
    // ниже оставался от первой - крип стоял у контейнера одной лабы, unboostCreep звал другую
    // (ERR_NOT_IN_RANGE), и задача молча снималась. lab_id заодно резервирует target-лабу от реакций
    // (getBoostReservedLabIds) и других бустеров (usedLabs); checkBoost его при unboost не чистит.
    creep.memory.lab_id = lab.id;

    // Свой ключ, а не container_id: у майнера/харвестера container_id - контейнер source
    // (sources.js), идти к нему бессмысленно, а записать туда lab-контейнер - сломать майнера.
    const container = (() => {
        // Кеш проверяем на соседство с лабой: ключ мог остаться от прошлой (отменённой руками)
        // команды или от лабы, выбранной заново выше.
        const cached = creep.memory.unboost_container_id && Game.getObjectById(creep.memory.unboost_container_id);
        if (cached && cached.pos.isNearTo(lab)) return cached;
        delete creep.memory.unboost_container_id;
        const containers = creep.room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER});
        for (const container of containers) {
            if (container.pos.isNearTo(lab)) {
                creep.memory.unboost_container_id = container.id;
                return container;
            }
        }
    })();

    if (!container) {
        log.warn(`unboost:no-container:${creep.room.name}`, `[${creep.room.name}][Unboost] Not found container for ${creep.name}. Unboost task was deleted.`);
        delete creep.memory.unboost;
        delete creep.memory.lab_id;
        delete creep.memory.unboost_container_id;
        return ERR_NOT_FOUND;
    }

    if (!creep.pos.isEqualTo(container)) {
        creep.moveTo(container);
        return OK;
    }

    // Результат раньше не проверялся: флаги снимались и при отказе (ERR_TIRED после реакции,
    // ERR_NOT_IN_RANGE) - крип оставался с бустом, задача пропадала.
    const status = lab.unboostCreep(creep);
    switch (status) {
        case OK:
            delete creep.memory.unboost;
            delete creep.memory.lab_id;
            delete creep.memory.unboost_container_id;
            delete creep.memory.boosted;
            return OK;

        case ERR_TIRED:
            creep.say('⏳Cooldown');
            return OK;

        case ERR_NOT_FOUND:
            // Бустов на теле нет - снимать нечего. boosted тоже снимаем: иначе upgrader навсегда
            // остаётся без продления TTL (roles/upgrader.js, tasks/room.js).
            log.info(`unboost:no-boosts:${creep.room.name}`, `[${creep.room.name}][Unboost] ${creep.name} has no boosted parts. Unboost task was deleted.`);
            delete creep.memory.unboost;
            delete creep.memory.lab_id;
            delete creep.memory.unboost_container_id;
            delete creep.memory.boosted;
            return ERR_NOT_FOUND;

        default:
            log.error(`unboost:error:${creep.room.name}:${status}`, `[${creep.room.name}][Unboost] ${creep.name} error ${status} ${status.toStringStatus()}. Unboost task was deleted.`);
            delete creep.memory.unboost;
            delete creep.memory.lab_id;
            delete creep.memory.unboost_container_id;
            return ERR_NOT_FOUND;
    }
}