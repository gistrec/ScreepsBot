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
    2: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, R, _, _, _],
        [_, _, _, _, _, _, _, _, R, E, R, _, _],
        [_, _, _, _, _, _, _, R, _, _, E, R, _],
        [_, _, _, _, _, _, R, E, _, E, R, _, _],
        [_, _, _, _, _, _, _, R, E, R, _, _, _],
        [_, _, _, _, _, _, _, _, R, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
    3: [
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _, _, _, _, R, _],
        [_, _, _, _, _, _, _, _, _, _, R, E, R],
        [_, _, _, _, _, _, _, _, _, _, _, E, R],
        [_, _, _, _, _, _, _, _, _, _, _, E, R],
        [_, _, _, _, _, _, _, _, T, E, _, _, _],
        [_, _, _, _, _, _, _, _, E, _, _, _, _],
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
    7: [],
    8: []
};


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
                const structuresAtPos = pos.lookFor(LOOK_STRUCTURES);
                if (structuresAtPos.length === 0) {
                    room.createConstructionSite(pos, structure);
                }
            }
        }
    }
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
