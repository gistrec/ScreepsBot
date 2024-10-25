const sources      = require('sources');

const taskCreep     = require('../tasks/creep');
const taskStructure = require('../tasks/structure');
const taskResource = require('../tasks/resource');


const MAX_PER_GAME = 6;

// W8S35 ->  39:46:W8S35 5bbcac769099fc012e6357e9
//           30:08:W8S35 5bbcac769099fc012e6357e7
// W8S36 ->  32:24:W8S36 5bbcac769099fc012e6357ec
//           30:26:W8S36 5bbcac769099fc012e6357ed
// W8S38 ->  30:35:W8S38 5bbcac769099fc012e6357f4
//           36:18:W8S38 5bbcac769099fc012e6357f3

const roleHarvester = {
    spawn: function(spawn) {
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
        if (harvesters.length >= MAX_PER_GAME) {
            return false;
        }
        const name = 'Harvester' + Game.time;
        const role = 'harvester'
        const parts = [
            WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE, // 650
            CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE // 500
        ];
        spawn.spawnCreep(parts, name, {memory: { role, /* boost: "GH2O" */ }});
        console.log('Spawning new harvester: ' + name);
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

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Приезжаем в домашнюю комнату
            if (creep.room.name != "W8S35") {
                creep.moveTo(new RoomPosition(33, 1, "W8S36"), {
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
            // Едем в удаленную комнату
            if (creep.room.name != "W8S36") {
                    creep.moveTo(new RoomPosition(33, 48, "W8S35"), {
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