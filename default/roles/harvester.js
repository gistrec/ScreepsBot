const sources      = require('sources');

const taskCreep     = require('../tasks/creep');
const taskStructure = require('../tasks/structure');
const taskResource = require('../tasks/resource');


const MAX_PER_GAME = 6;

// Harvester - крип под remote mining: добывает в target_room, везёт в home_room.
// Маршрут хранится в creep.memory: home_room, target_room и точки въезда home_entry/target_entry
// (RoomPosition-сериализация вида {x,y,roomName}). Значения проставляются при спавне.
//
// Пример вызова из консоли / spawnCreeps:
//   roleHarvester.spawn(spawn, {
//       home_room:    "W8S35",
//       target_room:  "W8S36",
//       home_entry:   {x: 33, y: 48, roomName: "W8S35"},  // куда ехать когда полный
//       target_entry: {x: 33, y: 1,  roomName: "W8S36"},  // куда ехать когда пустой
//   });

const roleHarvester = {
    spawn: function(spawn, opts) {
        if (!opts || !opts.home_room || !opts.target_room || !opts.home_entry || !opts.target_entry) {
            console.log(`[harvester.spawn] Required opts: home_room, target_room, home_entry, target_entry`);
            return false;
        }

        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
        if (harvesters.length >= MAX_PER_GAME) {
            return false;
        }
        const name = 'Harvester' + Game.time;
        const role = 'harvester';
        const parts = [
            WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE, // 650
            CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE // 500
        ];
        const memory = {
            role,
            home_room:    opts.home_room,
            target_room:  opts.target_room,
            home_entry:   opts.home_entry,
            target_entry: opts.target_entry,
        };
        spawn.spawnCreep(parts, name, {memory});
        console.log(`Spawning new harvester: ${name} (${opts.home_room} <-> ${opts.target_room})`);
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