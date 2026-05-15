function isInWhitelist(entity, whitelist) {
    return !entity.owner || !whitelist.includes(entity.owner.username);
}

function getEnergyCapacityAvailable(room, spawn = null) {
    // TODO: Добавить проверку, что крипы целые?
    const miners = exports.creepsByRole(room, "miner");
    const chargers = exports.creepsByRole(room, "charger");

    if (chargers.length >= 1 && miners.length >= 1) {
        return room.energyCapacityAvailable;
    } else {
        return room.energyAvailable;
    }
}

// TODO: Check miner and charger exists - we can't spawn creep without energy in estansion!
exports.getAvailableCreepConfiguration = function(configurations, room) {
    const energyCapacityAvailable = getEnergyCapacityAvailable(room);

    for (let i = 0; i < configurations.length; i++) {
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

// Свою комнату с energyCapacityAvailable >= requiredCapacity, ближайшую к target
// по linear distance. Возвращает null если таких нет. Используется expansion-ролями
// (claimer/scout/remoteUpgrader) для выбора спавн-комнаты.
exports.findNearestOwnRoom = function(targetRoomName, requiredCapacity) {
    const candidates = [];
    for (const name in Game.rooms) {
        const r = Game.rooms[name];
        if (!r.controller || !r.controller.my) continue;
        if (r.energyCapacityAvailable < requiredCapacity) continue;
        candidates.push(r);
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) =>
        Game.map.getRoomLinearDistance(a.name, targetRoomName)
      - Game.map.getRoomLinearDistance(b.name, targetRoomName)
    );
    return candidates[0];
}

// TTL, при котором майнера пора заменять: реальное время спавна нового тела + запас на дорогу.
// Используется и в miner.spawn (когда пора спавнить замену), и в sources.get (новый игнорирует
// уходящего при выборе source - чтобы пойти именно на его место).
exports.minerReplacementTtl = function(partsCount) {
    const WALK_BUFFER = 50;
    return partsCount * CREEP_SPAWN_TIME + WALK_BUFFER;
};

// Per-tick кеш структур, сгруппированных по типу. room.X не переживает тик в Screeps,
// поэтому кеш сам собой инвалидируется. Сильно экономит CPU когда несколько вызовов подряд
// делают find(FIND_STRUCTURES) с разными фильтрами по типу (charger - 7+ заполнений за тик).
exports.getStructuresByType = function(room) {
    if (!room._structuresByType) {
        room._structuresByType = _.groupBy(room.find(FIND_STRUCTURES), 'structureType');
    }
    return room._structuresByType;
};

exports.getMyStructuresByType = function(room) {
    if (!room._myStructuresByType) {
        room._myStructuresByType = _.groupBy(room.find(FIND_MY_STRUCTURES), 'structureType');
    }
    return room._myStructuresByType;
};

// Нужны ли чарджеры в комнате прямо сейчас. На bootstrap'е RCL 1 (миннер 250e с CARRY,
// без storage/контейнера/линка) чарджер ничего не возит - миннер сам доставляет в спавн.
// Спавн чарджера в этом состоянии = слитые 300 энергии и idle-крип у спавна. Как только
// появляется любой ferrying-target (контейнер у source, линк, storage/terminal) или миннер
// теряет CARRY (550e config на RCL 2), чарджер становится нужен. Кеш на тик, т.к. вызывается
// и из miner.spawn, и из charger.spawn.
exports.needsChargers = function(room) {
    if (room._needsChargers !== undefined) return room._needsChargers;

    if (room.storage || room.terminal) return room._needsChargers = true;

    const byType = exports.getStructuresByType(room);
    if ((byType[STRUCTURE_LINK] || []).length > 0) return room._needsChargers = true;

    // Контейнер у любого source - чарджер забирает в storage/spawn.
    const sources = room.find(FIND_SOURCES);
    const containers = byType[STRUCTURE_CONTAINER] || [];
    for (const s of sources) {
        if (containers.some(c => c.pos.isNearTo(s))) return room._needsChargers = true;
    }

    // Миннер без CARRY дропает энергию на землю - нужен чарджер чтобы подбирать.
    // Конфиги в roles/miner.js: 250e с CARRY, 550e без CARRY, 700e+ с CARRY.
    if (room.energyCapacityAvailable >= 550 && room.energyCapacityAvailable < 700) {
        return room._needsChargers = true;
    }

    return room._needsChargers = false;
}

// Свободный спавн в комнате, готовый принять задачу spawnCreep.
// Опции:
//   primaryOnly  - брать только спавн с именем == room.name (legacy hack из CLAUDE.md
//                  для сериализации спавн-цепочки между ролями).
//   requireActive - проверять spawn.isActive() (на случай downgrade RCL).
exports.findFreeSpawn = function(room, {primaryOnly = true, requireActive = true} = {}) {
    return room.find(FIND_MY_SPAWNS, {
        filter: s => !s.spawning
                  && (!requireActive || s.isActive())
                  && (!primaryOnly || s.name == room.name),
    }).shift();
}

// Свои крипы в комнате с заданной ролью. Тонкая обёртка над find - per-tick кеш не делаем,
// т.к. в одном тике может быть spawnCreep между вызовами и кеш окажется устаревшим.
exports.creepsByRole = function(room, role) {
    return room.find(FIND_MY_CREEPS, {filter: c => c.memory.role === role});
}

// Аналог для глобального Game.creeps (используется для remote-ролей: harvester/reserver).
exports.allCreepsByRole = function(role) {
    return _.filter(Game.creeps, c => c.memory.role === role);
}

// Стоимость тела по массиву типов частей. Для массива из spawnCreep, до создания крипа.
// Для живого крипа есть Creep.prototype.bodyPartCost (он внутри использует этот хелпер).
exports.bodyCost = function(parts) {
    let cost = 0;
    for (const p of parts) cost += BODYPART_COST[p];
    return cost;
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
