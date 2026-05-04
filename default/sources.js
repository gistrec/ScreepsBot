const utils = require('./utils');

/**
 * Автоматически назначаем боту источник, который он будет копать.
 * @param {Creep} creep - Бот
 */
exports.get = function(creep, force = false) {
    if (force) {
        delete creep.memory.source_id;
        delete creep.memory.container_id;
        delete creep.memory.link_id;
    }

    let source = creep.memory.source_id ? Game.getObjectById(creep.memory.source_id) : null;

    // Если source ещё не назначен (или ссылка протухла) - выбираем.
    if (!source) {
        const roomSources = creep.room.find(FIND_SOURCES);
        if (roomSources.length == 0) {
            return;
        }

        const replacementTtl = utils.minerReplacementTtl(creep.body.length);
        const otherRoomMiners = (() => {
            // Для Harvester нужно смотреть по всем крипам
            if (creep.memory.role == 'harvester') {
                return Object.keys(Game.creeps).map(creepName => Game.creeps[creepName]).filter(c => c.memory.role == "harvester" && c.id != creep.id)
            } else {
                return creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => ["miner", "remote_upgrader"].includes(c.memory.role) && c.id != creep.id && c.ticksToLive > replacementTtl
                });
            }
        })();

        source = roomSources.map((source) => {
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
    }

    // Discovery контейнера и линка делается один раз - после этого источниками будут null'ы,
    // если рядом ничего нет, и мы больше не ищем.
    if (creep.memory.container_id === undefined) {
        const container = creep.room.find(FIND_STRUCTURES, {filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER
                && structure.pos.isNearTo(source)
        }}).shift();
        creep.memory.container_id = container ? container.id : null;
        if (container) {
            console.log(`[${creep.room.name}] Miner ${creep.name} will use container at ${container.pos.x}:${container.pos.y}`);
        }
    }

    if (creep.memory.link_id === undefined) {
        const link = creep.room.find(FIND_STRUCTURES, {filter: (structure) => {
            return structure.structureType == STRUCTURE_LINK
                && structure.pos.inRangeTo(source, 2);
        }}).shift();
        creep.memory.link_id = link ? link.id : null;
        if (link) {
            console.log(`[${creep.room.name}] Miner ${creep.name} will use link at ${link.pos.x}:${link.pos.y}`);
        }
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
