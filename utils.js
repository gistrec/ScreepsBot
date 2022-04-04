function getEnergyCapacityAvailable(room) {
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