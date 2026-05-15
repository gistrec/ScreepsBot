const profiler = require('../screeps-profiler');

// TODO: Check link near source

const _ = null;
const B = STRUCTURE_SPAWN
const R = STRUCTURE_ROAD
const S = STRUCTURE_STORAGE
const E = STRUCTURE_EXTENSION
const T = STRUCTURE_TOWER
const L = STRUCTURE_LINK

const M = STRUCTURE_TERMINAL  // Market
const C = STRUCTURE_LAB       // Chemistry

const F = STRUCTURE_FACTORY
const N = STRUCTURE_NUKER
const O = STRUCTURE_OBSERVER
const P = STRUCTURE_POWER_SPAWN

const spawn_offset_x = exports.spawn_offset_x = 8;
const spawn_offset_y = exports.spawn_offset_y = 6;

const skip_rooms = ["W9S37", "W8S38"]

// TODO: Build extractor
// TODO: Build links near sources
//       Add links to modules/links automatically

const schemes = exports.schemes = {
    1: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, B, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    // Замена 3 ext: исходные позиции (10,8)/(9,9)/(8,10) занимают лабы из schemes[7],
    // поэтому переезжают на (11,3)/(4,9)/(4,10) - тоже extension'ы в реальном layout.
    2: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, E, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, R, _, _, _],
        [_, _, _, _, _, _, _, _, R, E, R, _, _],
        [_, _, _, _, _, _, _, R, _, _, _, R, _],
        [_, _, _, _, E, _, R, E, _, _, R, _, _],
        [_, _, _, _, E, _, _, R, _, R, _, _, _],
        [_, _, _, _, _, _, _, _, R, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    // Замена 2 ext: исходные позиции (9,8)/(8,9) занимают лабы из schemes[7],
    // переезжают на (11,2)/(3,9).
    3: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, E, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, R, _],
        [_, _, _, _, _, _, _, _, _, _, R, E, R],
        [_, _, _, _, _, _, _, _, _, _, _, E, R],
        [_, _, _, _, _, _, _, _, _, _, _, E, R],
        [_, _, _, _, _, _, _, _, T, _, _, _, _],
        [_, _, _, E, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    4: [
        [_, _, _, _, _, R, R, R, _, _, _, _, _],
        [_, _, _, _, R, E, E, E, R, _, _, _, _],
        [_, _, _, _, _, R, _, R, E, R, _, _, _],
        [_, _, _, _, _, _, R, E, E, E, R, _, _],
        [_, _, _, _, _, _, _, R, _, E, E, _, _],
        [_, _, _, _, _, _, _, _, R, E, _, _, _],
        [_, _, _, _, _, _, S, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    5: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, R, E, _, _, _, _, _, _, _, _],
        [_, _, R, E, E, E, _, _, _, _, _, _, _],
        [_, R, E, E, _, R, R, _, T, _, _, _, _],
        [R, E, R, E, R, R, L, _, _, _, _, _, _],
        [R, E, _, R, _, R, _, R, _, _, _, _, _],
        [R, E, R, _, R, R, _, R, _, _, _, _, _],
        [_, R, _, _, _, R, R, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    6: [
        [_, R, R, R, _, _, _, _, _, _, _, _, _],
        [R, E, E, E, _, _, _, _, _, _, _, _, _],
        [R, E, E, _, _, _, _, _, _, _, _, _, _],
        [R, E, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, E, _, _, M, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, R, _, _, E, _, _, _, _, _, _, _],
        [_, _, _, R, _, R, _, _, _, _, _, _, _],
        [_, _, _, _, R, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    // RCL 7: +10 ext, +1 spawn, +1 tower, +1 factory, +6 labs (RCL 6 unlocks 3, RCL 7 +3 -
    // схемы 1..6 не размещают ни одной лабы, поэтому все 6 ставим здесь).
    7: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, E, E, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, E, _],
        [_, _, _, _, _, _, _, _, _, _, _, E, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, F, _, _, _, _, _],
        [_, _, _, _, B, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, E, E, T, _, _, _, _, C, C, _, _],
        [_, E, _, E, E, _, _, _, C, C, _, C, _],
        [_, E, _, _, _, _, _, _, C, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    // RCL 8: полный snapshot layout-а W9S39 (storage в центре сетки [6][6]).
    // Включает все структуры всех RCL (ext/road/spawn/tower/link/lab/factory/terminal/
    // storage/nuker/observer/power_spawn) - ниже RCL 8 двигатель отказывает в превышающих
    // cap'ы construction site, поэтому дублирование с schemes[2..7] безвредно.
    // Рампарты создаются отдельным rampart-builder'ом 3-клеточной полосой по периметру.
    8: [
        [R, R, R, R, R, R, R, R, R, R, R, R, R],
        [R, E, E, E, R, E, E, E, R, E, E, N, R],
        [R, E, E, R, E, R, P, R, E, R, O, E, R],
        [R, E, R, E, E, E, R, E, E, E, R, E, R],
        [R, R, E, E, T, R, R, R, T, E, E, R, R],
        [R, E, R, E, R, R, L, F, R, E, R, E, R],
        [R, E, T, R, B, R, S, R, B, R, T, E, R],
        [R, E, R, E, R, R, M, R, R, E, R, E, R],
        [R, R, E, E, T, R, R, R, T, C, C, R, R],
        [R, E, R, E, E, E, R, E, C, C, R, C, R],
        [R, E, E, R, E, R, B, R, C, R, R, C, R],
        [R, E, E, E, R, E, E, E, R, C, C, E, R],
        [R, R, R, R, R, R, R, R, R, R, R, R, R],
    ],
};


// Контейнер у source - привязка к координатам в schemes[] невозможна (источники в каждой
// комнате в своём месте). Ставим site на adjacent-клетке, ближайшей по пути к storage
// (или к спавну в bootstrap). Контейнер доступен с RCL 0, поэтому вызываем отдельно
// от scheme-flow (buildMissingStructures гейтится last_build_level - в existing комнатах
// сработал бы только раз в 500 тиков). sources.js привязывает container_id к майнеру
// через isNearTo(source) - совместимо.
function buildContainersNearSources(room) {
    const spawn = room.find(FIND_MY_SPAWNS).shift();
    if (!spawn && !room.storage) return;

    const sources = room.find(FIND_SOURCES);
    const terrain = room.getTerrain();
    const target = room.storage || spawn;

    for (const source of sources) {
        const hasContainer = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType == STRUCTURE_CONTAINER
        }).length > 0;
        if (hasContainer) continue;
        const hasSite = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: s => s.structureType == STRUCTURE_CONTAINER
        }).length > 0;
        if (hasSite) continue;

        const candidates = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, room.name);
                // Контейнер не может стоять поверх non-rampart структуры. Road - редкий
                // конфликт у source, но всё равно блокирует createConstructionSite.
                const blocked = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType != STRUCTURE_RAMPART);
                if (blocked) continue;
                candidates.push(pos);
            }
        }

        if (candidates.length === 0) {
            console.log(`[${room.name}][BUILD] No walkable adjacent tile for container near source ${source.id}`);
            continue;
        }
        const best = target.pos.findClosestByPath(candidates) || candidates[0];
        const result = room.createConstructionSite(best, STRUCTURE_CONTAINER);
        if (result === OK) {
            console.log(`[${room.name}][BUILD] Container site placed at ${best.x}:${best.y} for source ${source.id}`);
        } else {
            console.log(`[${room.name}][BUILD] createConstructionSite container at ${best.x}:${best.y} failed: ${result} ${result.toStringStatus()}`);
        }
    }
}
exports.buildContainersNearSources = buildContainersNearSources;

// Extractor лежит на минерале - привязка к фиксированным координатам в schemes[]
// невозможна (минерал в каждой комнате в своём месте). Ставим его отдельно по
// результату FIND_MINERALS. RCL 6+.
function buildExtractor(room) {
    if (room.controller.level < 6) return;
    const mineral = room.find(FIND_MINERALS).shift();
    if (!mineral) return;
    const hasExtractor = mineral.pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType == STRUCTURE_EXTRACTOR);
    if (hasExtractor) return;
    room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);
}

// Рампарты по периметру базы 3-клеточной полосой (layer 0 - граница 13×13 schemes,
// layer 1/2 - две внутренние "обоймы"). Ставим только при RCL 8: на меньших уровнях
// нет energy-budget'а на поддержание ~120 рампартов через decay/towers.
// Ramparts могут наслаиваться поверх любых structure - createConstructionSite сработает
// и на extension/tower/lab; на terrain wall - пропускаем.
function buildRamparts(room, spawn) {
    if (room.controller.level < 8) return;

    const terrain = room.getTerrain();
    const SIZE = 13;
    const LAYERS = 3;

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const layer = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
            if (layer >= LAYERS) continue;

            const px = spawn.pos.x + x - spawn_offset_x;
            const py = spawn.pos.y + y - spawn_offset_y;
            if (px < 1 || px > 48 || py < 1 || py > 48) continue;
            if (terrain.get(px, py) === TERRAIN_MASK_WALL) continue;

            const pos = new RoomPosition(px, py, room.name);
            if (pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType == STRUCTURE_RAMPART)) continue;
            if (pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType == STRUCTURE_RAMPART)) continue;

            room.createConstructionSite(pos, STRUCTURE_RAMPART);
        }
    }
}

// Возвращает true, когда обработка выполнена (нашли спавн и прошлись по schemes),
// false при ранних выходах. Caller (build.process) использует это, чтобы не пометить
// уровень комнаты "обработанным" если на самом деле не разместили ни одной structure -
// иначе после level-up до спавн-постройки сайты scheme'а отложатся до 500-тик цикла.
exports.buildMissingStructures = function(room) {
    if (!room.controller || !room.controller.my) {
        console.log(`[${room.name}][BUILD] Room is not mine`);
        return false;
    }
    const spawn = room.find(FIND_MY_SPAWNS, {filter: (s) => s.structureType == STRUCTURE_SPAWN && s.name == room.name}).shift();
    if (!spawn) {
        console.log(`[${room.name}][BUILD] Spanw not found`);
        return false;
    }

    const terrain = room.getTerrain();
    for (let level = 2; level <= room.controller.level; level++) {
        const scheme = schemes[level];
        for (let y = 0; y < scheme.length; y++) {
            for (let x = 0; x < scheme[y].length; x++) {
                if (scheme[y][x] === _) {
                    continue;
                }
                const structure = scheme[y][x];
                const px = spawn.pos.x + x - spawn_offset_x;
                const py = spawn.pos.y + y - spawn_offset_y;
                // На стенах рампарт не строится, поэтому road на стене останется без защиты;
                // плюс road-on-wall стоит 150× обычного. Прочие структуры на стенах вообще
                // не ставятся (ERR_INVALID_TARGET). Skip - и для road-кейса, и для самого
                // факта попадания схемы в стену.
                if (terrain.get(px, py) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(px, py, room.name);
                // Рампарты ставит отдельный rampart-builder, поэтому на тайле под структурой
                // уже может оказаться рампарт - его игнорируем (createConstructionSite сработает
                // под рампартом). На прочих структурах createConstructionSite не сработает.
                const structuresAtPos = pos.lookFor(LOOK_STRUCTURES);
                if (structuresAtPos.length === 0
                        || structuresAtPos.every(s => s.structureType == STRUCTURE_RAMPART)) {
                    room.createConstructionSite(pos, structure);
                }
            }
        }
    }

    buildExtractor(room);
    buildRamparts(room, spawn);
    return true;
}

exports.process = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) {
            continue;
        }

        if (skip_rooms.includes(room.name)) {
            continue;
        }

        if (Game.time % 10 === 0) {
            if (room.memory.last_build_level !== room.controller.level) {
                console.log(`[${room.name}][BUILD] Building missing structures after level up`);
                // last_build_level обновляем только при успехе - чтобы при expansion'е,
                // когда спавн ещё не построен, повторно пытаться каждые 10 тиков.
                if (this.buildMissingStructures(room)) {
                    room.memory.last_build_level = room.controller.level;
                }
            }
        }

        if (Game.time % 500 === 0) {
            this.buildMissingStructures(room);
        }

        // Контейнеры у source проверяем чаще scheme-flow: они не зависят от RCL и нужны
        // максимально рано (на RCL 2 миннер без CARRY дропает энергию в пустоту).
        if (Game.time % 50 === 0) {
            buildContainersNearSources(room);
        }
    }
}

exports.hasEnoughSpaceForBase = function(room, baseSise = 13) {
    const terrain = new Room.Terrain(room.name);
    const mapSize = 50;

    for (let i = 0; i <= mapSize - baseSise; i++) {
        for (let j = 0; j <= mapSize - baseSise; j++) {
            let isFieldEmpty = true;
            for (let x = 0; x < baseSise; x++) {
                for (let y = 0; y < baseSise; y++) {
                    if (terrain.get(i + x, j + y) === TERRAIN_MASK_WALL) {
                        isFieldEmpty = false;
                        break;
                    }
                }
                if (!isFieldEmpty) break;
            }
            if (isFieldEmpty) return true;
        }
    }
    return false;
}


// W14S36
//


exports.buildMissingStructures = profiler.registerFN(exports.buildMissingStructures, "build.buildMissingStructures");
exports.process = profiler.registerFN(exports.process, "build.process");
