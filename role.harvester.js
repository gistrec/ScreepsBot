const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const MAX_PER_ROOM = 0;

// Сверху: 28:25:W8S36 5bbcac769099fc012e6357ed, 34:24:W8S36 5bbcac769099fc012e6357ec
// Снизу: 28:35:W8S38 5bbcac769099fc012e6357f4, 34:23:W8S38 5bbcac769099fc012e6357f3

const roleHarvester = {
    update: function() {
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
        if (harvesters.length < MAX_PER_ROOM) {
            const name  = 'Harvester' + Game.time;
            const parts = [
                WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE, // 550
                CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE // 500
            ];
            Game.spawns['Spawn1'].spawnCreep(parts, name, {
                memory: {
                    role: 'harvester'
                }
            });
            console.log('Spawning new harvester: ' + name);
        }
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если не заданы все параметры для работы
        if (!creep.memory.source_id || !creep.memory.source_location) {
            creep.say('⚠️Memory');
            return;
        }

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
            if (creep.room.name != "W9S37") {
                creep.moveTo(new RoomPosition(49, 24, "W9S37"), {
                    ignoreCreeps: true,
                });
                return;
            }
            
            if (creep.memory.repairing) {
                const target = Game.getObjectById(creep.memory.repairing);
                if (target && target.hits < target.hitsMax) {
                    taskStructure.repearTarget(creep, target);
                    return;
                }else {
                    _.filter(taskStructure.repearing_structures, id => id == target.id);
                    delete creep.memory.repairing;
                }
            }

            // Ищем структуры, которые необходимо достроить
            // if (taskStructure.buildClosest(creep) == OK) return;

            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)   == OK) return;


            // Обновляем контроллер
            if (taskStructure.upgradeController(creep) == OK) return;
        } else {
            // Едем в удаленную комнату
            if (creep.room.name != creep.memory.source_location.roomName()) {
                creep.moveTo(creep.memory.source_location.roomPosition());
                return;
            }
            
            // Основная задача:
            // * Поднимать ресурсы, пока не заполнится отсек
            const source = Game.getObjectById(creep.memory.source_id)
            if (taskResource.harvestTarget(creep, source) == OK) return;
        }
	}
};

module.exports = roleHarvester;