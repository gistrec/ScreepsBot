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

// Энергия в складах, из которых чарджер наполняет spawn/extension: storage, terminal, factory
// (charger.run берёт из них остаток, minCount 1). Контейнеры не считаем: из них чарджер берёт
// только полной порцией трюма, раздробленный по контейнерам запас может оказаться недоступен.
// Используется miner.spawn для восстановления после вайпа (0 майнеров / 0 чарджеров).
exports.getStoredSpawnEnergy = function(room) {
    return room.cache('storedSpawnEnergy', r => {
        let stored = 0;
        for (const s of [r.storage, r.terminal, r.getFactory()]) {
            if (s) stored += s.store.getUsedCapacity(RESOURCE_ENERGY);
        }
        return stored;
    });
};

// TODO: Check miner and charger exists - we can't spawn creep without energy in estansion!
// energyCapacity - явная ёмкость вместо getEnergyCapacityAvailable (восстановление в miner.spawn).
exports.getAvailableCreepConfiguration = function(configurations, room, energyCapacity = null) {
    const energyCapacityAvailable = energyCapacity !== null ? energyCapacity : getEnergyCapacityAvailable(room);

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

// Имя крипа, уникальное по комнате. '<Role>' + Game.time совпадало у двух комнат, спавнящих
// одну роль в один тик (spawnCreeps всех комнат идёт на Game.time % 10, а список имён тика у
// движка общий на аккаунт): вторая получала ERR_NAME_EXISTS и ждала следующего прохода.
// Формат как у reserver/harvester (`Reserver_${room}_${time}`); имена нигде не парсятся.
exports.creepName = function(prefix, room) {
    return `${prefix}_${room.name}_${Game.time}`;
}

// Отказы spawnCreep, которые лечатся ожиданием: энергия дольётся, спавн освободится, имя
// (creepName, с Game.time) на следующем тике будет другим. Роль в цепочке на такой отказ держит
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

// Недостижимые цели крипа. Target-хелперы (tasks/structure, tasks/resource) на ERR_NOT_IN_RANGE
// звали moveTo и возвращали OK, не глядя на результат: цель за стенами/чужими рампартами или в
// отрезанном кармане давала ERR_NO_PATH, хелпер - OK, и крип стоял у ближайшей к ней клетки до
// смерти, не доходя до остальных задач цепочки. Просто вернуть ERR_NOT_FOUND мало: цель
// выбирается заново каждый тик (findClosestByRange), та же цель снова ближайшая - и PathFinder
// к ней каждый тик.
// Правило как у goto (tasks/creep.js): один ERR_NO_PATH - не повод. Крипы для поиска пути -
// препятствия, а moveTo в конце неполного пути отдаёт ERR_NO_PATH из кеша _move до конца
// reusePath (у fill/withdraw - 15 тиков), даже когда проход уже свободен. Поэтому порог -
// NO_PATH_LIMIT тиков подряд ERR_NO_PATH к одной цели (больше reusePath + 1). После него id
// цели попадает в creep.memory.unreachable = {id: {u: до какого тика, k: который раз}}: хелперы
// к ней не идут (ERR_NOT_FOUND без moveTo), выборки find* её пропускают, диспетчер transfer-задач
// не отдаёт задачу с ней этому крипу. Срок растёт с каждым повтором (100, 200, 400, 800 тиков):
// блокировка прохода дольше порога (ложное срабатывание) стоит крипу 100 тиков, а реально
// обнесённая цель перепроверяется всё реже. Запись помнит k ещё UNREACHABLE_FORGET тиков после
// срока, потом удаляется. Память ограничена: не больше UNREACHABLE_MAX записей (лишняя -
// с самым ранним сроком), забытые удаляются при вставке и при обращении к своему id, всё
// остальное - со смертью крипа (чистка Memory.creeps в main.js).
const NO_PATH_LIMIT = 20;
const UNREACHABLE_TICKS = 100;
const UNREACHABLE_TICKS_MAX = 800;
const UNREACHABLE_FORGET = 1000;
const UNREACHABLE_MAX = 10;

exports.isUnreachable = function(creep, id) {
    const map = creep.memory.unreachable;
    const entry = map && map[id];
    if (!entry) return false;
    if (entry.u > Game.time) return true;
    if (entry.u + UNREACHABLE_FORGET <= Game.time) {
        delete map[id];
        if (Object.keys(map).length == 0) delete creep.memory.unreachable;
    }
    return false;
}

// moveTo к цели target-хелпера. OK - идём или ждём (временный ERR_NO_PATH, усталость и т.п. -
// как раньше); тик, на котором цель попала в список, тоже OK: результат этого тика не
// окончательный, и вызывающий не должен принимать его за "ресурса нет" (boost/disassemble
// снимают задачу на ERR_NOT_FOUND), со следующего тика выборка возьмёт другую цель.
// ERR_NO_PATH - цель уже в списке: хелпер возвращает ERR_NOT_FOUND, цепочка роли идёт дальше.
exports.moveToTarget = function(creep, target, opts) {
    if (exports.isUnreachable(creep, target.id)) return ERR_NO_PATH;

    const status = creep.moveTo(target, opts);
    let state = creep.memory.no_path;
    if (status != ERR_NO_PATH) {
        if (state && state.id == target.id) delete creep.memory.no_path;
        return OK;
    }

    // Счёт подряд: другая цель или пропущенный тик - заново; повторный вызов в том же тике не считаем.
    if (!state || state.id != target.id || state.t < Game.time - 1) {
        state = creep.memory.no_path = {id: target.id, n: 0, t: 0};
    }
    if (state.t == Game.time) return OK;
    state.n++;
    state.t = Game.time;
    if (state.n < NO_PATH_LIMIT) return OK;

    delete creep.memory.no_path;
    const map = creep.memory.unreachable = creep.memory.unreachable || {};
    const k = map[target.id] ? map[target.id].k + 1 : 1;
    delete map[target.id];
    let oldest = null;
    for (const id in map) {
        if (map[id].u + UNREACHABLE_FORGET <= Game.time) delete map[id];
        else if (oldest === null || map[id].u < map[oldest].u) oldest = id;
    }
    if (oldest !== null && Object.keys(map).length >= UNREACHABLE_MAX) delete map[oldest];
    const ticks = Math.min(UNREACHABLE_TICKS * Math.pow(2, k - 1), UNREACHABLE_TICKS_MAX);
    map[target.id] = {u: Game.time + ticks, k};
    console.log(`[${creep.room.name}] ${creep.name} can't reach ${target.structureType || 'target'} ${target.id} (${NO_PATH_LIMIT}x ERR_NO_PATH), skipping it for ${ticks} ticks`);
    return OK;
}
