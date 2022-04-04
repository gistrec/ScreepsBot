// Key - roomName
let renewingCreeps = {}
let costMatrixRewrites = {}

const getRectangleArea = function(pos, value, rewriteCenter) {
    let result = []
    for (let x = pos.x - 1; x < pos.x + 1; x++) {
        for (let y = pos.y - 1; y < pos.y + 1; y++) {
            if (x == pos.x && y == pos.y && !rewriteCenter) {
                continue;
            }
            result.push({'x': pos.x, 'y': pos.y, 'value': value});
        }
    }
    return result;
}

exports.recalculateCostMatrixRewrites = function(room) {
    if (costMatrixRewrites[room.name] && Game.time % 500) {
        return;
    }

    costMatrixRewrites[room.name] = [];

    // Hack...
    if (room.name == "W9S37") {
        costMatrixRewrites[room.name].push({'x': 11, 'y': 45, 'value': 0});
        costMatrixRewrites[room.name].push({'x': 12, 'y': 44, 'value': 0});
    }

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
                costMatrixRewrites[room.name].push({'x': container.pos.x, 'y': container.pos.y, 'value': /* unwalkable */ 255});
            }
        }
    }
    console.log(`Cost matrix for room ${room.name} recalculated`);
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
        return ERR_NOT_FOUND
    }
    
    // Note: for unexpected situations (like creep die)
    if (!creep.memory.renewing || creep.ticksToLive == 0 || creep.ticksToLive == CREEP_LIFE_TIME || creep.hits == 0) {
        creep.memory.renewing = false;
        delete renewingCreeps[room.name];
        console.log(`Room ${room.name} finish renewing creep ${creep.name}`);
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

    const miners = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "miner"});
    const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});
    if (miners.length < 2 && charger.length < 4) {
        return;
    }

    if (room.energyCapacityAvailable != room.energyAvailable) {
        return;
    }

    const creep = room.find(FIND_MY_CREEPS, {filter: (creep) => {
        return creep.ticksToLive < 400 && ['upgrader', 'charger'].includes(creep.memory.role)
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
            return structure.structureType == StructureController
        }
    });
    if (!target) {
        target = new RoomPosition(10, 10, "W8S37");
    }

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