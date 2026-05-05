const sources      = require('sources');
const utils        = require('utils');

const taskCreep     = require('../tasks/creep');
const taskStructure = require('../tasks/structure');
const taskResource = require('../tasks/resource');


const MAX_PER_GAME = 6;
const HARVESTERS_PER_TARGET = 2;

const BODY = [
    WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE,
    CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE
];
const BODY_COST = utils.bodyCost(BODY);  // 1250

// Точки выхода/входа в зависимости от направления target от home. Game.map.describeExits
// возвращает {1:top, 3:right, 5:bottom, 7:left}. home_entry - край home, ведущий в target;
// target_entry - противоположный край target, ведущий обратно в home.
const HOME_ENTRY_BY_DIR = {
    1: {x: 25, y: 0},   // TOP
    3: {x: 49, y: 25},  // RIGHT
    5: {x: 25, y: 49},  // BOTTOM
    7: {x: 0,  y: 25},  // LEFT
};
const TARGET_ENTRY_BY_DIR = {
    1: {x: 25, y: 49},  // home was TOP -> target's BOTTOM faces home
    3: {x: 0,  y: 25},  // home was RIGHT -> target's LEFT
    5: {x: 25, y: 0},   // home was BOTTOM -> target's TOP
    7: {x: 49, y: 25},  // home was LEFT -> target's RIGHT
};

function getEntryPositions(home_room, target_room) {
    const exits = Game.map.describeExits(home_room);
    if (!exits) return null;
    let dir = null;
    for (const d in exits) {
        if (exits[d] === target_room) { dir = parseInt(d); break; }
    }
    if (dir == null) return null;
    return {
        homeEntry:   {...HOME_ENTRY_BY_DIR[dir],   roomName: home_room},
        targetEntry: {...TARGET_ENTRY_BY_DIR[dir], roomName: target_room},
    };
}

// Harvester - крип под remote mining: добывает в target_room, везёт в home_room.
// Маршрут хранится в creep.memory: home_room, target_room и точки въезда home_entry/target_entry
// (RoomPosition-сериализация вида {x,y,roomName}). Значения проставляются при спавне.
//
// Авто-спавн через Memory.remote_rooms[home_room] = [target_room1, ...].
// Также можно спавнить вручную: roleHarvester.spawn(spawn, {home_room, target_room, home_entry, target_entry}).

const roleHarvester = {
    spawn: function(spawn, opts) {
        if (!opts || !opts.home_room || !opts.target_room || !opts.home_entry || !opts.target_entry) {
            console.log(`[harvester.spawn] Required opts: home_room, target_room, home_entry, target_entry`);
            return false;
        }

        const harvesters = utils.allCreepsByRole('harvester');
        if (harvesters.length >= MAX_PER_GAME) {
            return false;
        }
        const name = 'Harvester' + Game.time;
        const role = 'harvester';
        const memory = {
            role,
            home_room:    opts.home_room,
            target_room:  opts.target_room,
            home_entry:   opts.home_entry,
            target_entry: opts.target_entry,
        };
        spawn.spawnCreep(BODY, name, {memory});
        console.log(`Spawning new harvester: ${name} (${opts.home_room} <-> ${opts.target_room})`);
        return true;
    },

    // Авто-спавн под Memory.remote_rooms[home_room]. Паттерн сцеплённого spawnCreeps:
    // true = "ничего делать не нужно или другие могут пробовать", false = "только что заспавнили".
    autoSpawn: function(room) {
        const targets = (Memory.remote_rooms && Memory.remote_rooms[room.name]) || [];
        if (targets.length === 0) return true;

        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true;

        const allHarvesters = utils.allCreepsByRole('harvester');
        for (const target_room of targets) {
            const harvesters = allHarvesters.filter(c => c.memory.target_room == target_room);
            if (harvesters.length >= HARVESTERS_PER_TARGET) continue;

            if (room.energyAvailable < BODY_COST) {
                console.log(`[${room.name}] Need harvester for ${target_room}, but not enough energy [${room.energyAvailable}/${BODY_COST}]`);
                return false;
            }

            const positions = getEntryPositions(room.name, target_room);
            if (!positions) {
                console.log(`[${room.name}] No direct exit to ${target_room}, skipping harvester`);
                continue;
            }

            const name = `Harvester_${target_room}_${Game.time}`;
            const result = spawn.spawnCreep(BODY, name, {
                memory: {
                    role: 'harvester',
                    home_room: room.name,
                    target_room: target_room,
                    home_entry: positions.homeEntry,
                    target_entry: positions.targetEntry,
                }
            });
            if (result === OK) {
                console.log(`[${room.name}] Spawning harvester ${name} for ${target_room}`);
                return false;
            }
        }
        return true;
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // TODO: Логика при нападении на бота
        if (creep.hits != creep.hitsMax) {
            creep.memory.recycling = true;
        }

        // Если бот обновляет ttl
        if (taskCreep.checkTTL(creep) == OK) return;

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        const homeRoom    = creep.memory.home_room;
        const targetRoom  = creep.memory.target_room;
        const homeEntry   = creep.memory.home_entry;
        const targetEntry = creep.memory.target_entry;
        if (!homeRoom || !targetRoom || !homeEntry || !targetEntry) {
            // Старый креп без memory-полей или ошибка спавна - recycle.
            creep.memory.recycling = true;
            return;
        }

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Приезжаем в домашнюю комнату через target_entry (точка выхода из target_room).
            if (creep.room.name != homeRoom) {
                creep.moveTo(new RoomPosition(targetEntry.x, targetEntry.y, targetEntry.roomName), {
                    ignoreCreeps: true,
                    reusePath: 10,
                });
                return;
            }

            // if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)   == OK) return;

            if (taskStructure.buildClosest(creep) == OK) return;

            // Обновляем контроллер
            if (taskStructure.upgradeController(creep) == OK) return;
        } else {
            // Едем в удалённую комнату через home_entry (точка выхода из home_room).
            if (creep.room.name != targetRoom) {
                creep.moveTo(new RoomPosition(homeEntry.x, homeEntry.y, homeEntry.roomName), {
                    reusePath: 10,
                });
                return;
            }

            // Основная задача:
            // * Добывать ресурсы
            const target = sources.get(creep);
            taskResource.harvestTarget(creep, target);
        }
	}
};

module.exports = roleHarvester;