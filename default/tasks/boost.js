const taskResource = require('./resource');
const labModule    = require('modules/lab');
const utils        = require('utils');

// Zero-CARRY крипы (powerBank attacker/healer) не могут сами перевозить ресурсы -
// делегируем заполнение/выгрузку лабы чарджеру через room.transfer. Перед каждой
// шедулировкой проверяем, нет ли уже такого таска (иначе переназначим каждый тик).
function isChargerBusyWith(room, sourceId, targetId, resourceType) {
    return room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role == 'charger'
                  && c.memory.transfer
                  && c.memory.transfer.source_id == sourceId
                  && c.memory.transfer.target_id == targetId
                  && c.memory.transfer.resource_type == resourceType
    }).length > 0;
}

function hasFreeCharger(room) {
    return utils.creepsByRole(room, "charger").some(c => !c.memory.transfer);
}

function findResourceSource(room, resourceType, minAmount) {
    for (const s of [room.storage, room.terminal]) {
        if (s && s.store.getUsedCapacity(resourceType) >= minAmount) return s;
    }
    return null;
}

function chargerFillLab(creep, lab, resourceType, totalAmount) {
    if (!creep.pos.isNearTo(lab)) {
        creep.moveTo(lab, {visualizePathStyle: {stroke: '#0000FF'}, maxRooms: 1});
    }
    const source = findResourceSource(creep.room, resourceType, totalAmount - lab.store.getUsedCapacity(resourceType));
    if (!source) return;
    if (isChargerBusyWith(creep.room, source.id, lab.id, resourceType)) return;
    if (!hasFreeCharger(creep.room)) return;
    creep.room.transfer(resourceType, source.id, lab.id, totalAmount);
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
            console.log(`[${creep.room.name}][Boost] ${creep.name} can't evac ${resourceType} from lab ${lab.id}: terminal+storage full.`);
        }
        creep.say('🚧Stall');
        return;
    }
    if (isChargerBusyWith(creep.room, lab.id, dest.id, resourceType)) return;
    if (!hasFreeCharger(creep.room)) return;
    creep.room.transfer(resourceType, lab.id, dest.id);
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
        console.log(`[${creep.room.name}][Boost] Not found resource type '${resourceType}' for check creep boost part`);
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
    }

    if (!creep.memory.boost || creep.spawning) {
        return ERR_NOT_FOUND;
    }

    // В активной осаде комбат-роли (upgrader/defender) пропускают boost: ехать на лабу
    // = бросить рампарт под огнём. Запись creep.memory.boost не удаляем - как только
    // осада закончится, креп заглянет в лабу при следующем тике.
    if (creep.room.isUnderAttack && ['upgrader', 'defender'].includes(creep.memory.role)) {
        return ERR_NOT_FOUND;
    }

    // 1. Получаем лабораторию, с которой будем работать.
    const lab = (() => {
        if (creep.memory.lab_id) {
            return Game.getObjectById(creep.memory.lab_id);
        }

        // Реакционные лабы (source/target) исключаем: они забиты минералами пайплайна,
        // и step 3 boost'а вывалил бы их содержимое в терминал, ломая reaction loop.
        // Исключение - boost_force: занимаем target-лабу под буст (lab.js пропускает её
        // в runReaction пока creep.memory.lab_id указывает на неё). Source-лабы не трогаем
        // никогда: refillLabs дозаливает их каждые 100 тиков, конфликт неизбежен.
        const labConfig = labModule.labs[creep.room.name];
        const reactionIds = new Set(labConfig ? [...labConfig.sources, ...labConfig.targets] : []);
        const sourceIds   = new Set(labConfig ? labConfig.sources : []);

        const usedLabs = Object.keys(Game.creeps).map(creepName => Game.creeps[creepName].memory.lab_id).filter(x => x);
        const lab = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (s) => {
                if (s.structureType != STRUCTURE_LAB) return false;
                if (usedLabs.includes(s.id)) return false;
                if (creep.memory.boost_force) {
                    // Cooldown игнорируем - спадёт пока чарджер заполняет лабу.
                    return !sourceIds.has(s.id);
                }
                return s.cooldown == 0 && !reactionIds.has(s.id);
            }
        });
        return lab;
    })();

    if (!lab) {
        // Под boost_force ждём - все таргет-лабы могут быть заняты другими бустерами.
        // Удалять boost task нельзя: powerBank-сквад без буста не пробьёт банк.
        if (creep.memory.boost_force) {
            creep.say('⏳Wait lab');
            return OK;
        }
        console.log(`[${creep.room.name}][Boost] Not found lab for boost creep ${creep.name}. Boost task was deleted.`);
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }
    creep.memory.lab_id = lab.id;

    // Получаем основные данные, с которыми будем работать
    const resourceType = creep.memory.boost;
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    if (!partType) {
        console.log(`[${creep.room.name}][Boost] Incorrect resource type '${resourceType}' for boost creep '${creep.name}'. Boost task was deleted.`);
        delete creep.memory.lab_id;
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }
    const partsCount = _.filter(creep.body, part => part.type == partType).length;
    if (!partsCount) {
        console.log(`[${creep.room.name}][Boost] Creep '${creep.name}' doesn't have '${partType}' parts for boost by '${resourceType}'. Boost task was deleted.`);
        delete creep.memory.lab_id;
        delete creep.memory.boost;
        return ERR_NOT_FOUND;
    }

    // 2. Пока в лаборатории не хватает энергии, то заполняем её энергией
    const totalEnergy = LAB_BOOST_ENERGY * partsCount;                 // Количество энергии, необходимой для буста крипа
    const labEnergy   = lab.store.getUsedCapacity(RESOURCE_ENERGY);    // Количество энергии в лаборатории
    const creepEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);  // Количество энергии в крипе
    if (labEnergy < totalEnergy) {
        creep.say("⚡Fill lab")

        // Zero-CARRY (powerBank attacker/healer) сам ничего не возит - делегируем чарджеру.
        // У крипа без CARRY-частей store.getCapacity() возвращает null, не 0 - сверяемся
        // по телу напрямую.
        if (!creep.body.some(p => p.type === CARRY)) {
            chargerFillLab(creep, lab, RESOURCE_ENERGY, totalEnergy);
            return OK;
        }

        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
            taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL);
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
                console.log(`[${creep.room.name}][Boost] Not found energy for boost creep ${creep.name}. Boost task was deleted.`);
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
                console.log(`[${creep.room.name}][Boost] ${creep.name} withdraw extra mineral ${lab.mineralType} from lab ${lab.id}`)
            }
            taskResource.withdrawTarget(creep, lab, lab.mineralType);
        }else {
            // Терминал может быть забит (PowerBank-логика грузит его буст-минералами через
            // market.deal + chargerEvac), поэтому falback на storage. Логируем редко, чтобы
            // не спамить во время длинного stall'а.
            if (Game.time % 100 == 0) {
                console.log(`[${creep.room.name}][Boost] ${creep.name} transfer extra cargo (lab=${lab.mineralType || 'empty'})`)
            }
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return OK;
            taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE);
        }
        return OK;
    }

    // 4. Пока в лаборатории не хватает минералов, то заполняем её минералами
    const totalResources = LAB_BOOST_MINERAL * partsCount;            // Количество нералов, необходимых для буста крипа
    const labResources   = lab.store.getUsedCapacity(resourceType);   // Количество минералов в лаборатории
    const creepResources = creep.store.getUsedCapacity(resourceType); // Количество минералов в крипе
    if (labResources < totalResources) {
        creep.say("💎Fill lab")

        // Zero-CARRY: тоже делегируем чарджеру.
        if (!creep.body.some(p => p.type === CARRY)) {
            chargerFillLab(creep, lab, resourceType, totalResources);
            return OK;
        }

        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
            taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE);
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
                console.log(`[${creep.room.name}][Boost] Not found resource ${resourceType} for boost creep ${creep.name}. Boost task was deleted.`);
                delete creep.memory.lab_id;
                delete creep.memory.boost;
                return ERR_NOT_FOUND;
            }
        }else {
            taskResource.fillTarget(creep, lab, resourceType);
        }
        return OK;
    }

    // 5. Бустим крипа
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
            console.log(`[${creep.room.name}][Boost] ${creep.name} error ${status} ${status.toStringStatus()}. Boost task was deleted`)
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
            return Game.getObjectById(creep.memory.lab_id);
        }

        // Нужно выбрать неиспользуемую лабораторию без кулдауна, которая находится рядом с контейнером.
        const usedLabs = Object.keys(Game.creeps).map(creepName => Game.creeps[creepName].memory.lab_id).filter(x => x);
        const containers = creep.room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER});
        const lab = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_LAB
                        && s.cooldown == 0
                        && !usedLabs.includes(s.id)
                        && _.some(containers, container => container.pos.isNearTo(s))
        });
        return lab;
    })();

    if (!lab) {
        console.log(`[${creep.room.name}][Unboost] Not found lab for ${creep.name}. Unboost task was deleted.`);
        delete creep.memory.unboost;
        return ERR_NOT_FOUND;
    }

    const container = (() => {
        if (creep.memory.container_id) {
            return Game.getObjectById(creep.memory.container_id);
        }
        const containers = creep.room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER});
        for (const container of containers) {
            if (container.pos.isNearTo(lab)) {
                creep.memory.container_id = container.id;
                return container;
            }
        }
    })();

    if (!container) {
        console.log(`[${creep.room.name}][Unboost] Not found container for ${creep.name}. Unboost task was deleted.`);
        delete creep.memory.unboost;
        return ERR_NOT_FOUND;
    }

    if (!creep.pos.isEqualTo(container)) {
        creep.moveTo(container);
        return OK;
    }

    lab.unboostCreep(creep);
    delete creep.memory.unboost;
    delete creep.memory.lab_id;
    delete creep.memory.boosted;
}