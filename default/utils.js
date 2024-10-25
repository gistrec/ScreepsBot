function isInWhitelist(entity, whitelist) {
    console.log(!entity.owner || !whitelist.includes(entity.owner.username), !entity.owner, !whitelist.includes(entity.owner.username))
    return !entity.owner || !whitelist.includes(entity.owner.username);
}

function getEnergyCapacityAvailable(room, spawn = null) {
    // TODO: Добавить проверку, что крипы целые?
    const miner = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "miner"});
    const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});

    if (charger.length >= 1 && miner.length >= 1) {
        return room.energyCapacityAvailable;
    } else {
        return room.energyAvailable;
    }
}

// TODO: Check miner and charger exists - we can't spawn creep without energy in estansion!
exports.getAvailableCreepConfiguration = function(configurations, room) {
    const energyCapacityAvailable = getEnergyCapacityAvailable(room);

    for (i = 0; i < configurations.length; i++) {
        const currentConfiguration = configurations[i];
        const nextConfiguration = configurations[i + 1];
        // Если на следующую конфигурацию не хватит энергии.
        if (!nextConfiguration || nextConfiguration["energy"] > energyCapacityAvailable) {
            return currentConfiguration;
        }
    }
}

exports.getAvailableCreepCount = function(configurations, room) {
    const configuration = exports.getAvailableCreepConfiguration(configurations, room);
    return configuration["max_count"];
}

exports.getEnergyStructures = function(room, spawn) {
    const sortByRange = ((first, second) => {
        const rangeFirst  = spawn.pos.getRangeTo(first);
        const rangeSecond = spawn.pos.getRangeTo(second);

        if (rangeFirst < rangeSecond) return -1;
        if (rangeFirst > rangeSecond) return  1;
        return 0;
    });

    return [
        // Сначала выкачиваем энергию из экстеншенов.
        ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_EXTENSION && s.isActive()}).sort(sortByRange),
        // Дальше выкачиваем энергию из текущего спауна
        spawn,
        // Дальше выкачиваем энергию из других спавнов
        ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_SPAWN && s.name != spawn.name}),
    ];
}
