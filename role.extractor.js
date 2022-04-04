const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const MAX_PER_ROOM = 0;

const roleHarvester = {
    update: function() {
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
        if (harvesters.length < MAX_PER_ROOM) {
            const name  = 'Extractor' + Game.time;
            const parts = [
                // WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE, // 550
                // CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE // 500
                WORK, WORK, WORK, MOVE, // 550
                CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,  // 500
            ];
            Game.spawns['Spawn1'].spawnCreep(parts, name, {
                memory: {
                    role: 'extractor'
                }
            });
            console.log('Spawning new extractor: ' + name);
        }
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если не заданы все параметры для работы
        if (!creep.memory.source_id) {
            creep.say('⚠️Memory');
            return;
        }

        // Если бот обновляет ttl
        if (taskCreep.checkTTL(creep) == OK) return;

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK);
        } else {
            // Основная задача:
            // * Поднимать ресурсы, пока не заполнится отсек
            const source = Game.getObjectById(creep.memory.source_id)
            if (taskResource.harvestTarget(creep, source) == OK) return;
        }
	}
};

module.exports = roleHarvester;