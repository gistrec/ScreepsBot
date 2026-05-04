const profiler = require('../screeps-profiler');

// TODO: Check container near source
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
const H = STRUCTURE_RAMPART   // Hardwall

const spawn_offset_x = 8;
const spawn_offset_y = 6;

const skip_rooms = ["W9S37", "W8S38"]

// TODO: Build extractor
// TODO: Build links near sources
//       Add links to modules/links automatically

const schemes = {
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
    // RCL 8: +9 ext, +1 spawn, +3 towers, nuker, observer, power spawn, +4 labs,
    // плюс рампарты по периметру 13×13 и в "дырах" между структурами в стенке базы.
    8: [
        [H, H, H, H, H, H, H, H, H, H, H, H, H],
        [H, _, _, _, H, _, _, _, H, _, _, N, H],
        [H, _, _, H, _, H, P, H, _, H, O, _, H],
        [H, _, H, _, _, _, _, _, _, _, H, _, H],
        [H, H, _, _, T, _, _, _, _, _, _, H, H],
        [H, _, H, _, _, _, _, _, _, _, H, _, H],
        [H, _, T, _, _, _, _, _, _, _, T, _, H],
        [H, _, H, _, _, _, _, _, _, _, H, _, H],
        [H, H, _, _, _, _, _, _, _, _, _, H, H],
        [H, _, H, _, _, _, _, _, _, _, H, _, H],
        [H, _, E, H, E, H, B, H, _, H, C, C, H],
        [H, E, E, E, H, E, E, E, H, C, C, E, H],
        [H, H, H, H, H, H, H, H, H, H, H, H, H],
    ],
};


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

exports.buildMissingStructures = function(room) {
    if (!room.controller || !room.controller.my) {
        console.log(`[${room.name}][BUILD] Room is not mine`);
        return;
    }
    const spawn = room.find(FIND_MY_SPAWNS, {filter: (s) => s.structureType == STRUCTURE_SPAWN && s.name == room.name}).shift();
    if (!spawn) {
        console.log(`[${room.name}][BUILD] Spanw not found`);
        return;
    }

    for (let level = 2; level <= room.controller.level; level++) {
        const scheme = schemes[level];
        for (let y = 0; y < scheme.length; y++) {
            for (let x = 0; x < scheme[y].length; x++) {
                if (scheme[y][x] === _) {
                    continue;
                }
                const structure = scheme[y][x];
                const pos = new RoomPosition(
                    spawn.pos.x + x - spawn_offset_x,
                    spawn.pos.y + y - spawn_offset_y,
                    room.name
                );
                // Рампарт может ставиться поверх любой структуры (свой/road/extension и т.п.),
                // поэтому проверяем "уже есть рампарт", а не "пусто". Остальные типы остаются
                // строго exclusive: createConstructionSite силится только на чистом тайле.
                const structuresAtPos = pos.lookFor(LOOK_STRUCTURES);
                if (structure == STRUCTURE_RAMPART) {
                    if (!structuresAtPos.some(s => s.structureType == STRUCTURE_RAMPART)) {
                        room.createConstructionSite(pos, structure);
                    }
                } else if (structuresAtPos.length === 0
                        || structuresAtPos.every(s => s.structureType == STRUCTURE_RAMPART)) {
                    // На пустом тайле или на тайле где уже только рампарт - можно ставить.
                    room.createConstructionSite(pos, structure);
                }
            }
        }
    }

    buildExtractor(room);
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
                room.memory.last_build_level = room.controller.level;

                console.log(`[${room.name}][BUILD] Building missing structures after level up`);
                this.buildMissingStructures(room);
            }
        }

        if (Game.time % 500 === 0) {
            this.buildMissingStructures(room);
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
