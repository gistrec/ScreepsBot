const taskResource = require('task.resource');

exports.canBoost = function(creep, resourceType) {
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    return partType != undefined;
}

/**
 * Проверяем есть ли буст у крипа.
 * TODO:
 */
exports.hasBoost = function(creep, resourceType) {
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    if (!partType) {
        console.log(`Not found resource type '${resourceType}' for check creep boost part`);
        return 0
    }
    return _.filter(creep.body, part => part.type == partType && part.boost != undefined).length;
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
    if (!creep.memory.boost) return;

    // 1. Получаем лабораторию, с которой будем работать
    const lab = (() => {
        if (creep.memory.lab_id) {
            return Game.getObjectById(creep.memory.lab_id);
        }

        const lab = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType == STRUCTURE_LAB && s.cooldown == 0
        });
        if (lab) {
            creep.memory.lab_id = lab.id;
            return lab;
        }
    })();
    if (!lab) {
        console.log(`Not found lab for boost creep ${creep.name}`);
        delete creep.boost;
        return ERR_NOT_FOUND;
    }
    
    // Получаем основные данные, с которыми будем работать
    const resourceType = creep.memory.boost;
    const partType = _.findKey(BOOSTS, boost => boost[resourceType]);
    if (!partType) {
        console.log(`Not found resource type '${resourceType}' for boost creep '${creep.name} by ${resourceType}'`);
        delete creep.boost;
        return ERR_NOT_FOUND;
    }
    const partsCount = _.filter(creep.body, part => part.type == partType).length;
    if (!partsCount) {
        console.log(`Creep '${creep.name}' doesn't have '${partType}' parts for boost by '${resourceType}' `);
        delete creep.boost;
        return ERR_NOT_FOUND;
    }

    // 2. Пока в лаборатории не хватает энергии, то заполняем её энергией
    const totalEnergy = LAB_BOOST_ENERGY * partsCount;                 // Количество энергии, необходимой для буста крипа
    const labEnergy   = lab.store.getUsedCapacity(RESOURCE_ENERGY);    // Количество энергии в лаборатории
    const creepEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);  // Количество энергии в крипе 
    console.log(`Energy: [${creepEnergy} + ${labEnergy} / ${totalEnergy}]`);
    if (labEnergy < totalEnergy) {
        creep.say("⚡ Fill")
        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
            taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE);
            return OK;
        }
        
        // Загружаем ресурсы в трюм пока:
        // 1. В трюме есть место
        // 2. Сумма ресурсов в крипе и лаборатории меньше, чем нужно для буста
        if (creep.store.getFreeCapacity() != 0 && (creepEnergy + labEnergy) < totalEnergy) {
            taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_TERMINAL], RESOURCE_ENERGY, totalEnergy - (creepEnergy + labEnergy));
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
            console.log(`Withdraw extra mineral: ${lab.mineralType}`)
            taskResource.withdrawTarget(creep, lab, lab.mineralType);
        }else {
            console.log(`Transfer extra mineral: ${lab.mineralType}`)
            taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE);
        }
        return OK;
    }

    // 4. Пока в лаборатории не хватает минералов, то заполняем её минералами
    const totalResources = LAB_BOOST_MINERAL * partsCount;            // Количество нералов, необходимых для буста крипа
    const labResources   = lab.store.getUsedCapacity(resourceType);   // Количество минералов в лаборатории
    const creepResources = creep.store.getUsedCapacity(resourceType); // Количество минералов в крипе
    console.log(`Resource: [${creepResources} + ${labResources} / ${totalResources}]`);
    if (labResources < totalResources) {
        creep.say("💎 Fill")

        // Перед тем как начать заполнять лабораторию энергией, нужно выкинуть все лишние ресурсы из трюма.
        // Нужно для того, чтобы как можно быстрее заполнить лабораторию.
        if (creep.store.getUsedCapacity() != creep.store.getUsedCapacity(resourceType)) {
            console.log("FILL 1")
            taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE);
            return OK;
        }
        
        // Загружаем ресурсы в трюм пока:
        // 1. В трюме есть место
        // 2. Сумма ресурсов в крипе и лаборатории меньше, чем нужно для буста
        if (creep.store.getFreeCapacity() != 0 && (creepResources + labResources) < totalResources) {
            console.log("Withdraw")
            taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_TERMINAL], resourceType, totalResources - (labResources + creepResources));
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
            creep.memory.boost = null;
            delete creep.memory.lab_id;
            delete creep.memory.boost;
            return ERR_NOT_FOUND;

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
            console.log(`[checkBoost] Error ${status}`)
            return ERR_NOT_FOUND;
    }
}