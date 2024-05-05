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
    
    const otherRoomMiners = (() => {
        // Для Harvester нужно смотреть по всем крипам
        if (creep.memory.role == 'harvester') {
            return Object.keys(Game.creeps).map(creepName => Game.creeps[creepName]).filter(c => c.memory.role == "harvester" && c.id != creep.id)
        } else {
            return creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => ["miner", "remote_upgrader"].includes(c.memory.role) && c.id != creep.id && c.ticksToLive > 150
            });
        }
    })();

    let source = roomSources.map((source) => {
        const minersCount = otherRoomMiners.filter((miner) => miner.memory.source_id == source.id).length;
        return {
            source: source,
            minersCount: minersCount,
        }
    }).sort((lhv, rhv) => {
        return lhv.minersCount - rhv.minersCount;
    }).shift()["source"];

    console.log(`[${creep.room.name}] Miner ${creep.name} will mine source ${source.id}`);
    creep.memory.source_id = source.id;

    // TODO: Перенести эту логику в role.miner
    // Мб стоит проверить есть ли у этого контейнера крип
    if (creep.memory.mining_power < 0.9) {
        return source;
    }

    const container = creep.room.find(FIND_STRUCTURES, {filter: (structure) => {
        return structure.structureType == STRUCTURE_CONTAINER
            && structure.pos.isNearTo(source)
    }}).shift();
    if (container) {
        console.log(`[${creep.room.name}] Miner ${creep.name} will use container at ${container.pos.x}:${container.pos.y}`);
        creep.memory.container_id = container.id;
    }
    
    const link = creep.room.find(FIND_STRUCTURES, {filter: (structure) => {
        return structure.structureType == STRUCTURE_LINK
            && structure.pos.inRangeTo(source, 2);
    }}).shift();
    if (link) {
        console.log(`[${creep.room.name}] Miner ${creep.name} will use link at ${link.pos.x}:${link.pos.y}`);
        creep.memory.link_id = link.id;
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
