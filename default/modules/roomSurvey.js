const profiler = require('../screeps-profiler');
const observer = require('./observer');

// Сканируем кандидатов под expansion и оцениваем место под базу.
// Терраин и список соседей доступны без видимости (Game.map.getRoomTerrain /
// Game.map.describeExits), поэтому observer/scout не нужны.
//
// Алгоритм - chebyshev distance transform: для каждой клетки расстояние до
// ближайшей стены/края, max по комнате = радиус самого большого свободного
// квадрата (clearRadius). Размер квадрата = 2*r + 1.

// Layout базы 13x13 (см. modules/build.js schemes) - нужен радиус >= 6.
const REQUIRED_CLEAR_RADIUS = 6;

// Сколько шагов BFS от своих комнат включаем в список кандидатов.
// 3 даёт ~30-50 комнат вокруг кластера - достаточно для выбора expansion-цели.
const CANDIDATE_DEPTH = 3;

// Интервал пересчёта списка кандидатов (могут поменяться при claim/lost комнаты).
const REBUILD_CANDIDATES_INTERVAL = 1000;

// Не пересканируем чаще чем раз в N тиков. Терраин не меняется, но при появлении
// видимости подмешиваем sources/mineral/owner в существующую запись (см. surveyRoom).
const RESURVEY_INTERVAL = 50000;

let candidates = [];
let queueIndex = 0;
let lastCandidatesRebuild = -REBUILD_CANDIDATES_INTERVAL;

function rebuildCandidates() {
    const ownRooms = [];
    for (const name in Game.rooms) {
        const r = Game.rooms[name];
        if (r.controller && r.controller.my) ownRooms.push(name);
    }

    // BFS до глубины CANDIDATE_DEPTH. visited хранит глубину; 0 = свои комнаты (стартовая).
    const visited = {};
    for (const name of ownRooms) visited[name] = 0;
    let frontier = ownRooms.slice();
    for (let depth = 1; depth <= CANDIDATE_DEPTH; depth++) {
        const next = [];
        for (const name of frontier) {
            const exits = Game.map.describeExits(name);
            if (!exits) continue;
            for (const dir in exits) {
                const adj = exits[dir];
                if (adj in visited) continue;
                visited[adj] = depth;
                next.push(adj);
            }
        }
        frontier = next;
    }

    candidates = Object.keys(visited).filter(n => visited[n] > 0);
    lastCandidatesRebuild = Game.time;
}

function computeClearRadius(roomName) {
    const terrain = Game.map.getRoomTerrain(roomName);
    const dist = new Uint8Array(50 * 50);
    const INF = 99;

    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const onEdge = (x == 0 || y == 0 || x == 49 || y == 49);
            const isWall = terrain.get(x, y) & TERRAIN_MASK_WALL;
            dist[y * 50 + x] = (onEdge || isWall) ? 0 : INF;
        }
    }

    for (let y = 1; y < 49; y++) {
        for (let x = 1; x < 49; x++) {
            const i = y * 50 + x;
            if (dist[i] == 0) continue;
            const m = Math.min(
                dist[i - 50 - 1], dist[i - 50], dist[i - 50 + 1],
                dist[i - 1]
            );
            if (m + 1 < dist[i]) dist[i] = m + 1;
        }
    }
    for (let y = 48; y > 0; y--) {
        for (let x = 48; x > 0; x--) {
            const i = y * 50 + x;
            if (dist[i] == 0) continue;
            const m = Math.min(
                dist[i + 50 + 1], dist[i + 50], dist[i + 50 - 1],
                dist[i + 1]
            );
            if (m + 1 < dist[i]) dist[i] = m + 1;
        }
    }

    let maxR = 0, maxX = 0, maxY = 0;
    for (let y = 1; y < 49; y++) {
        for (let x = 1; x < 49; x++) {
            const d = dist[y * 50 + x];
            if (d > maxR) { maxR = d; maxX = x; maxY = y; }
        }
    }
    return { radius: maxR, x: maxX, y: maxY };
}

function classifyRoomName(roomName) {
    const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
    const sx = m ? +m[1] % 10 : -1;
    const sy = m ? +m[2] % 10 : -1;
    return {
        isHighway: (sx == 0 || sy == 0),
        // Source-keeper - центральные 3x3 в секторе, кроме самого центра.
        isSK: (sx >= 4 && sx <= 6 && sy >= 4 && sy <= 6 && !(sx == 5 && sy == 5)),
        isSectorCenter: (sx == 5 && sy == 5),
    };
}

exports.surveyRoom = function(roomName) {
    if (!Memory.roomSurvey) Memory.roomSurvey = {};

    const { radius, x, y } = computeClearRadius(roomName);
    const { isHighway, isSK, isSectorCenter } = classifyRoomName(roomName);

    // Visibility-dependent поля - подмешиваем, если комната сейчас видна.
    // Иначе сохраняем то, что было записано раньше (None при первом проходе).
    const prev = Memory.roomSurvey[roomName] || {};
    let sources       = prev.sources;
    let mineral       = prev.mineral;
    let hasController = prev.hasController;
    let owned         = prev.owned;

    const room = Game.rooms[roomName];
    if (room) {
        sources = room.find(FIND_SOURCES).length;
        const minerals = room.find(FIND_MINERALS);
        mineral = minerals.length ? minerals[0].mineralType : null;
        hasController = !!room.controller;
        owned = !!(room.controller && room.controller.owner);
    }

    // claimable - трёхзначно:
    //   'no'      - тип/терраин/источники гарантированно не подходят
    //   'yes'     - всё проверено и ок
    //   'unknown' - терраин ок, но источники не разведаны (комната не была в Game.rooms)
    // Минерал не блокирует - комната без минерала всё ещё полезна для remote mining.
    let claimable, reason;
    if (isHighway)             { claimable = 'no'; reason = 'highway'; }
    else if (isSK)             { claimable = 'no'; reason = 'SK'; }
    else if (isSectorCenter)   { claimable = 'no'; reason = 'sector-center'; }
    else if (radius < REQUIRED_CLEAR_RADIUS) { claimable = 'no'; reason = `tight (r${radius})`; }
    else if (owned)            { claimable = 'no'; reason = 'owned'; }
    else if (sources === undefined) { claimable = 'unknown'; reason = 'no scout data'; }
    else if (sources < 2)      { claimable = 'no'; reason = `${sources} src`; }
    else                       { claimable = 'yes'; reason = `r${radius}, ${sources} src`; }

    Memory.roomSurvey[roomName] = {
        at: Game.time,
        clearRadius: radius,
        center: [x, y],
        sources,
        mineral,
        hasController,
        owned,
        isHighway,
        isSK,
        claimable,
        reason,
    };
}

// Запрашивает observation у одного из spare-обсерверов (observers[0] зарезервирован
// за power-bank модулем). Возвращает true если задача отдана.
function dispatchObservation(roomName) {
    const observers = observer.get_observers();
    for (let i = 1; i < observers.length; i++) {
        const obs = observers[i];
        const dist = Game.map.getRoomLinearDistance(obs.room.name, roomName);
        if (dist <= OBSERVER_RANGE) {
            return obs.observeRoom(roomName) === OK;
        }
    }
    return false;
}

exports.process = function() {
    if (Game.time - lastCandidatesRebuild >= REBUILD_CANDIDATES_INTERVAL || candidates.length == 0) {
        try { rebuildCandidates(); } catch (err) { err.log(); }
    }
    if (candidates.length == 0) return;

    if (!Memory.roomSurvey) Memory.roomSurvey = {};

    // Phase 1: дёшево - обогатить любых видимых сейчас кандидатов без source-данных.
    // Срабатывает на тик после dispatchObservation, либо когда scout/own зашёл в комнату.
    for (const name of candidates) {
        const prev = Memory.roomSurvey[name];
        if (!prev) continue;
        if (prev.sources !== undefined) continue;
        if (!Game.rooms[name]) continue;
        try { exports.surveyRoom(name); } catch (err) { err.log(); }
    }

    // Phase 2: одно действие за тик - либо посчитать терраин нового кандидата,
    // либо отправить observation для уже посчитанного, но без source-данных.
    for (let i = 0; i < candidates.length; i++) {
        queueIndex = (queueIndex + 1) % candidates.length;
        const name = candidates[queueIndex];
        const prev = Memory.roomSurvey[name];

        // Терраин ещё не считался или давно протух - считаем.
        if (!prev || Game.time - prev.at >= RESURVEY_INTERVAL) {
            try { exports.surveyRoom(name); } catch (err) { err.log(); }
            return;
        }

        // Терраин есть, но source-данных нет и комната не видна - дёргаем observer.
        // Видимость появится в следующем тике, phase 1 подхватит и enrich-нет.
        if (prev.sources === undefined && !Game.rooms[name]) {
            if (dispatchObservation(name)) return;
        }
    }
}

exports.surveyRoom = profiler.registerFN(exports.surveyRoom, "roomSurvey.surveyRoom");
exports.process    = profiler.registerFN(exports.process,    "roomSurvey.process");
