const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');

const roleSafeModeGenerator = {
    /** @param {Creep} creep **/
    run: function(creep) {
        // Если не заданы все параметры для работы
        if (!creep.memory.controller_id) {
            creep.say('⚠️Memory');
            return;
        }

        if (taskCreep.checkBoost(creep) == OK) return;

        if (creep.store.getUsedCapacity(RESOURCE_GHODIUM) != 1000) {
            taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_GHODIUM, 1000);
        }

        const controller = Game.getObjectById(creep.memory.controller_id);
        if (!controller) {
            creep.say('⚠️Controller');
            return;
        }

        creep.moveTo(controller);
        creep.generateSafeMode(controller);
	}
};

module.exports = roleSafeModeGenerator;