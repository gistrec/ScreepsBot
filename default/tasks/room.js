const utils = require('../utils');

// Key - roomName
let renewingCreeps = {}
let costMatrixRewrites = {}

const getRectangleArea = function(pos, value, rewriteCenter) {
    let result = []
    for (let x = pos.x - 1; x <= pos.x + 1; x++) {
        for (let y = pos.y - 1; y <= pos.y + 1; y++) {
            if (x == pos.x && y == pos.y && !rewriteCenter) {
                continue;
            }
            result.push({'x': x, 'y': y, 'value': value});
        }
    }
    return result;
}

exports.recalculateCostMatrixRewrites = function(room) {
    if (costMatrixRewrites[room.name] && Game.time % 600 !== 0) {
        return;
    }

    costMatrixRewrites[room.name] = []

    // Hack...
    const importantStructures = room.find(FIND_MY_STRUCTURES, {filter: (s) => {
        return [STRUCTURE_SPAWN, STRUCTURE_TOWER].includes(s.structureType);
    }});
    for (const importantStructure of importantStructures) {
        const rectangleArea = getRectangleArea(importantStructure.pos, 20, /* rewriteCenter */ false)
        costMatrixRewrites[room.name] = costMatrixRewrites[room.name].concat(rectangleArea);
    }
    const sources    = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER});
    for (const container of containers) {
        for (const source of sources) {
            if (container.pos.isNearTo(source)) {
                costMatrixRewrites[room.name].push({'x': container.pos.x, 'y': container.pos.y, 'value': /* unwalkable */ 40});
            }
        }
    }
    console.log(`[${room.name}] Cost matrix recalculated`);
}

exports.applyCostMatrixRewrites = function(roomName, costMatrix) {
    if (!costMatrixRewrites[roomName]) {
        return;
    }
    for (const costMatrixRewrite of costMatrixRewrites[roomName]) {
        costMatrix.set(costMatrixRewrite.x, costMatrixRewrite.y, costMatrixRewrite.value);
    }
}

const isRenewingNow = function(room) {
    const creep = renewingCreeps[room.name];
    if (!creep) {
        return ERR_NOT_FOUND;
    }

    // Note: for unexpected situations (like creep die)
    if (!creep.memory.renewing || creep.ticksToLive == 0 || creep.ticksToLive == CREEP_LIFE_TIME || creep.hits == 0) {
        creep.memory.renewing = false;
        delete renewingCreeps[room.name];
        console.log(`[${room.name}] Finish renewing creep ${creep.name}`);
        return ERR_NOT_FOUND;
    }

    return OK;
}

exports.renewCreeps = function(room) {
    if (isRenewingNow(room) == OK) return;

    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length == 0) {
        return;
    }

    const miners = utils.creepsByRole(room, "miner");
    const charger = utils.creepsByRole(room, "charger");
    if (miners.length < 2 && charger.length < 2) {
        return;
    }

    if (room.energyAvailable < room.energyCapacityAvailable * 0.5) {
        return;
    }

    const creep = room.find(FIND_MY_CREEPS, {filter: (creep) => {
        return creep.ticksToLive < 400 && ['upgrader', 'charger', 'defender', 'extractor'].includes(creep.memory.role) && !creep.memory.boosted
    }}).sort((lhv, rhv) => {
        return lhv.ticksToLive - rhv.ticksToLive;
    }).shift();

    if (creep) {
        creep.say('💊Renewing');
        creep.memory.renewing = true;
        renewingCreeps[room.name] = creep;
    }
}

exports.finishCreepRenewing = function(room) {
    delete renewingCreeps[room.name];
}

exports.claimClosest = function(creep) {
    if (creep.memory.action != 'claim') {
        creep.memory.action = 'claim';
        creep.say('👑 Claim');
    }

    let target = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
        filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTROLLER
        }
    });

    const status = creep.reserveController(target);

    switch (status) {
        case  0: // Success
        case -4: // Крип еще создается
            return OK;

        case ERR_NOT_IN_RANGE:
            creep.moveTo(target, {
                visualizePathStyle: {stroke: '#FF0000'},
                maxRooms: 1
            });
            return OK;

        default:
            creep.say(`⚠️Error ${status}`)
            console.log(`[5] Error ${status}`)
            return ERR_NOT_FOUND
    }
}

/**
 * Проверяем, нужно ли обновлять контроллер.
 */
function checkUpgradeControllerRequirement(room) {
    const controller = room.controller;
    if (!controller || !controller.my) {
        return;
    }

    // Всегда держим выше 50%, чтобы можно было активировать safeMode.
    if (controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[controller.level] * 0.8) {
        room.memory.need_maintain_controller = true;
    } else if (!room.isDefending && controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[controller.level] * 0.95) {
        room.memory.need_maintain_controller = true;
    } else {
        room.memory.need_maintain_controller = false;
    }
}

/**
 * Основная функция для обработки комнаты.
 */
exports.processRoom = function(room) {
    if (room.memory.need_maintain_controller || Game.time % 500 == 0) {
        checkUpgradeControllerRequirement(room);
    }
}