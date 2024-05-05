const taskResource = require('task.resource');

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

    // 1. Получаем лабораторию, с которой будем работать.
    const lab = (() => {
        if (creep.memory.lab_id) {
            return Game.getObjectById(creep.memory.lab_id);
        }

        // Нужно выбрать неиспользуемую лабораторию без кулдауна.
        const usedLabs = Object.keys(Game.creeps).map(creepName => Game.creeps[creepName].memory.lab_id).filter(x => x);
        const lab = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_LAB && s.cooldown == 0 && !usedLabs.includes(s.id)
        });
        return lab;
    })();
    
    if (!lab) {
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
    console.log(`Energy: [${creepEnergy} + ${labEnergy} / ${totalEnergy}]`);
    if (labEnergy < totalEnergy) {
        creep.say("⚡Fill lab")
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
            taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_TERMINAL], RESOURCE_ENERGY, energyCount);
        }else {
            taskResource.fillTarget(creep, lab, RESOURCE_ENERGY);
        }
        return OK;
    }
    
    // 3. Выкидываем лишние ресурсы из лаборатории:
    // * Если в крипе лежат 'левые ресурсы'
    // * Если в лаборатории лежат 'левые ресурсы'
    if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)  || (lab.mineralType && lab.mineralType != resourceType)) {
        if (lab.store.getUsedCapacity(lab.mineralType) > 0 && creep.store.getFreeCapacity() > 0) {
            console.log(`[${creep.room.name}][Boost] Withdraw extra mineral: ${lab.mineralType}`)
            taskResource.withdrawTarget(creep, lab, lab.mineralType);
        }else {
            console.log(`[${creep.room.name}][Boost] Transfer extra mineral: ${lab.mineralType}`)
            taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL);
        }
        return OK;
    }

    // 4. Пока в лаборатории не хватает минералов, то заполняем её минералами
    const totalResources = LAB_BOOST_MINERAL * partsCount;            // Количество нералов, необходимых для буста крипа
    const labResources   = lab.store.getUsedCapacity(resourceType);   // Количество минералов в лаборатории
    const creepResources = creep.store.getUsedCapacity(resourceType); // Количество минералов в крипе
    console.log(`[${creep.room.name}][Boost] Resource ${resourceType} [In creep ${creepResources} + In lab ${labResources} / Need ${totalResources}]`);
    if (labResources < totalResources) {
        creep.say("💎Fill lab")

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
    console.log(`LabBoost status: ${status}`);
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

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[checkBoost] Error ${status}. Boost tesk was deleted`)
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
        console.log(`Not found lab for unboost creep ${creep.name}. Unboost task was deleted.`);
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
        console.log(`Not found container for unboost creep ${creep.name}. Unboost task was deleted.`);
        delete creep.memory.unboost;
        return ERR_NOT_FOUND; 
    }
    
    if (!creep.pos.isEqualTo(container)) {
        creep.moveTo(container);
        return OK;
    }
    
    lab.unboostCreep(creep);
    delete creep.memory.unboost;
    creep.memory.unboosted = false;
}