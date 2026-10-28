function isInWhitelist(entity, whitelist) {
    return !entity.owner || !whitelist.includes(entity.owner.username);
}

function getEnergyCapacityAvailable(room, spawn = null) {
    // TODO: Добавить проверку, что крипы целые?
    const miners = exports.creepsByRole(room, "miner");
    const chargers = exports.creepsByRole(room, "charger");

    if (chargers.length >= 1 && miners.length >= 1) {
        return exports.getEffectiveEnergyCapacity(room);
    } else {
        return room.energyAvailable;
    }
}

// room.energyCapacityAvailable от Screeps учитывает ВСЕ построенные spawn/extension,
// включая inactive (когда построено больше чем разрешает RCL, или после downgrade'а).
// Это завышает оценку и getAvailableCreepConfiguration выбирает тело которое спавн
// никогда не сможет собрать. Суммируем capacity только активных структур через
// isActive() - авторитетный API Screeps'а. Per-tick кеш на room: ~60 isActive()
// вызовов на комнату за тик ровно один раз.
exports.getEffectiveEnergyCapacity = function(room) {
    return room.cache('effectiveEnergyCapacity', r => {
        const byType = exports.getMyStructuresByType(r);
        const candidates = (byType[STRUCTURE_SPAWN] || []).concat(byType[STRUCTURE_EXTENSION] || []);
        let cap = 0;
        for (const s of candidates) {
            if (s.isActive()) cap += s.store.getCapacity(RESOURCE_ENERGY);
        }
        return cap;
    });
};

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

// Свою комнату, ближайшую к target по фактическому маршруту через findRoute.
// Кандидаты сортируются по linear distance (lower bound для route.length), затем
// для каждого валидируется существование пути - linear distance не отражает реальной
// проходимости (terrain/недостижимые сектора). Используется expansion-ролями
// (claimer/scout/remoteUpgrader) и powerBank-сквадом для выбора спавн-комнаты.
// opts:
//   filter      - доп. предикат на комнату (room => bool); RCL/energy/spawn-чек делает caller.
//   maxDistance - максимум route.length; кандидаты с linearDistance > maxDistance
//                 отсекаются сразу (linear - lower bound, дальше искать смысла нет).
exports.findNearestOwnRoom = function(targetRoomName, {filter, maxDistance} = {}) {
    const candidates = [];
    for (const name in Game.rooms) {
        const r = Game.rooms[name];
        if (!r.controller || !r.controller.my) continue;
        if (filter && !filter(r)) continue;
        candidates.push(r);
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
        Game.map.getRoomLinearDistance(a.name, targetRoomName)
      - Game.map.getRoomLinearDistance(b.name, targetRoomName)
    );

    for (const candidate of candidates) {
        if (maxDistance !== undefined
            && Game.map.getRoomLinearDistance(candidate.name, targetRoomName) > maxDistance) {
            break;
        }
        const route = Game.map.findRoute(candidate.name, targetRoomName);
        if (route === ERR_NO_PATH) continue;
        if (maxDistance !== undefined && route.length > maxDistance) continue;
        return candidate;
    }
    return null;
}

// TTL, при котором майнера пора заменять: реальное время спавна нового тела + запас на дорогу.
// Используется и в miner.spawn (когда пора спавнить замену), и в sources.get (новый игнорирует
// уходящего при выборе source - чтобы пойти именно на его место).
exports.minerReplacementTtl = function(partsCount) {
    const WALK_BUFFER = 50;
    return partsCount * CREEP_SPAWN_TIME + WALK_BUFFER;
};

// Per-tick кеши структур, сгруппированных по типу. room.cache живёт ровно один тик
// (Screeps пересоздаёт room object), поэтому ручной инвалидации не нужно. Сильно экономит
// CPU: charger делает 7+ find(FIND_STRUCTURES) за тик с разными фильтрами - все из кеша.
exports.getStructuresByType = function(room) {
    return room.cache('structuresByType',
        r => _.groupBy(r.find(FIND_STRUCTURES), 'structureType'));
};

exports.getMyStructuresByType = function(room) {
    return room.cache('myStructuresByType',
        r => _.groupBy(r.find(FIND_MY_STRUCTURES), 'structureType'));
};

// FIND_SOURCES детерминирован для комнаты на всё время её существования. Кешируем не
// потому что find дорогой (он не дорогой), а потому что зовётся 8+ раз/тик в разных
// модулях (sources.get, link.getLinkConfig, needsChargers, miner.spawn, tasks/room,
// modules/build, visualization). Один find/тик/комнату.
exports.getSources = function(room) {
    return room.cache('sources', r => r.find(FIND_SOURCES));
};

// Нужны ли чарджеры в комнате прямо сейчас. На bootstrap'е RCL 1 (миннер 250e с CARRY,
// без storage/контейнера/линка) чарджер ничего не возит - миннер сам доставляет в спавн.
// Спавн чарджера в этом состоянии = слитые 300 энергии и idle-крип у спавна. Как только
// появляется любой ferrying-target (контейнер у source, линк, storage/terminal) или миннер
// теряет CARRY (550e config на RCL 2), чарджер становится нужен.
exports.needsChargers = function(room) {
    return room.cache('needsChargers', r => {
        if (r.storage || r.terminal) return true;

        const byType = exports.getStructuresByType(r);
        if ((byType[STRUCTURE_LINK] || []).length > 0) return true;

        // Контейнер у любого source - чарджер забирает в storage/spawn.
        const sources = exports.getSources(r);
        const containers = byType[STRUCTURE_CONTAINER] || [];
        for (const s of sources) {
            if (containers.some(c => c.pos.isNearTo(s))) return true;
        }

        // Миннер без CARRY дропает энергию на землю - нужен чарджер чтобы подбирать.
        // Конфиги в roles/miner.js: 250e с CARRY, 550e без CARRY, 700e+ с CARRY.
        if (r.energyCapacityAvailable >= 550 && r.energyCapacityAvailable < 700) {
            return true;
        }

        return false;
    });
}

// Помечаем "комната ждёт энергии для спавна роли X". Используется визуализацией для overlay
// около контроллера, чтобы было видно что именно блокирует spawn-цепочку. main.js очищает
// поле в начале каждого spawnCreeps цикла; роли вызывают это, когда возвращают false по
// причине недостатка энергии.
exports.recordSpawnNeed = function(room, role, needed) {
    room.memory.spawn_need = {role, needed, at: Game.time};
}

// Свободный спавн в комнате, готовый принять задачу spawnCreep.
// `spawning` - снимок начала тика, поэтому отдельно отсеиваем спавны, которым в этом тике уже
// отдан spawnCreep (intentSent, см. prototypes/structure.js): модули (expansion, powerBank,
// wallBreaker) в main.js идут раньше spawnCreeps комнаты, и без этого цепочка комнаты видела
// их спавн свободным и перезаписывала интент. Теперь занятый модулем спавн для цепочки
// выглядит как spawning - роль возвращает true, как и при любом занятом спавне.
// Опции:
//   primaryOnly  - брать только спавн с именем == room.name (legacy hack из CLAUDE.md
//                  для сериализации спавн-цепочки между ролями).
//   requireActive - проверять spawn.isActive() (на случай downgrade RCL).
exports.findFreeSpawn = function(room, {primaryOnly = true, requireActive = true} = {}) {
    return room.find(FIND_MY_SPAWNS, {
        filter: s => !s.spawning
                  && !s.intentSent
                  && (!requireActive || s.isActive())
                  && (!primaryOnly || s.name == room.name),
    }).shift();
}

// Свои крипы в комнате с заданной ролью. Per-tick кеш под отдельным ключом на роль.
// Раньше думал "spawnCreep может произойти между вызовами и кеш устареет" - на практике:
// (а) внутри одного spawn() вызова после spawnCreep не читаем creepsByRole; (б) если из
// spawnCreeps вышел true (spawn'нул), последующие callers в том же тике увидят stale-список
// (без только что заспавненного крипа с .spawning=true) - но это benign: ни один callsite
// не зависит от точной видимости свежеспавненного. Hot caller - charger.run, который зовёт
// это N×тик на N чарджеров. Возвращаемый массив НЕ МУТИРОВАТЬ (не .shift/.push на нём напрямую) -
// shared между всеми callers тика; .filter/.map/.slice безопасны.
exports.creepsByRole = function(room, role) {
    return room.cache('creeps:' + role,
        r => r.find(FIND_MY_CREEPS, {filter: c => c.memory.role === role}));
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

// Отказы spawnCreep, которые лечатся ожиданием: энергия дольётся, спавн освободится, имя
// ('<Role>' + Game.time) на следующем тике будет другим. Роль в цепочке на такой отказ держит
// цепочку (return false) - ровно как на гейте по энергии. Остальные коды (ERR_INVALID_ARGS -
// тело > 50 частей, ERR_RCL_NOT_ENOUGH - неактивный спавн, ERR_NOT_OWNER) постоянные: держать
// цепочку бессмысленно, роль возвращает true и повторит попытку через 10 тиков.
exports.isTransientSpawnError = function(result) {
    return result === ERR_NOT_ENOUGH_ENERGY || result === ERR_BUSY || result === ERR_NAME_EXISTS;
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
