const { room } = require("./statistics");

/**
 * Автоматически назначаем боту источник, который он будет копать.
 * @param {Creep} creep - Бот
 */
exports.get = function(creep, force = false) {
    if (!force && creep.memory.source_id) {
        return Game.getObjectById(creep.memory.source_id);
    }

    const roomSources = creep.room.find(FIND_SOURCES);
    if (roomSources.length == 0) {
        return;
    }
    
    const otherRoomMiners = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role == "miner" && c.id != creep.id
    });

    let source = roomSources.map((source) => {
        const minersCount = otherRoomMiners.filter((miner) => miner.memory.source_id == source.id).length;
        return {
            source: source,
            minersCount: minersCount,
        }
    }).sort((lhv, rhv) => {
        return lhv.minersCount - rhv.minersCount;
    }).shift()["source"];

    console.log(`Miner ${creep.name} will mine source ${source.id}`);
    creep.memory.source_id = source.id;

    const container = creep.room.find(FIND_STRUCTURES, {filter: (structure) => {
        return structure.structureType == STRUCTURE_CONTAINER
            && structure.pos.isNearTo(source)
    }}).shift();
    if (container) {
        console.log(`Miner ${creep.name} will use container at ${container.pos.x}:${container.pos.y}`);
        creep.memory.container_location = [container.pos.x, container.pos.y, container.pos.roomName];
    }

    return source;
}

/**
 * Назначаем боту ближайший источник, который он будет копать
 * @param {Creep} creep - creep
 */
exports.getNearest = function(creep) {
    if (creep.memory.source_id) {
        return creep.room.find(FIND_SOURCES, {
            filter: (source) => source.id == creep.memory.source_id}
        );   
    }

    const source = creep.pos.findClosestByRange(FIND_SOURCES);

    creep.memory.source_id = source.id;

    return source;
}
