const taskBoost     = require('../tasks/boost');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');

const roleSafeModeGenerator = {
    /** @param {Creep} creep **/
    run: function(creep) {
        // Если не заданы все параметры для работы
        if (!creep.memory.controller_id) {
            creep.say('⚠️Memory');
            return;
        }

        if (taskBoost.checkBoost(creep) == OK) return;

        // Пока гудиума меньше SAFE_MODE_COST - только едем за ним. Раньше withdraw (moveTo к
        // терминалу) и moveTo(controller) шли в один тик: у крипа один слот move-интента,
        // второй перезаписывал первый - крип шёл к контроллеру и до терминала не доходил.
        // minCount 1: берём и часть (запас разложен по terminal/storage), остаток - следующим рейсом.
        const ghodium = creep.store.getUsedCapacity(RESOURCE_GHODIUM);
        if (ghodium < SAFE_MODE_COST) {
            taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL, STRUCTURE_STORAGE], RESOURCE_GHODIUM, SAFE_MODE_COST - ghodium, 1);
            return;
        }

        const controller = Game.getObjectById(creep.memory.controller_id);
        if (!controller) {
            creep.say('⚠️Controller');
            return;
        }

        if (creep.generateSafeMode(controller) == ERR_NOT_IN_RANGE) {
            creep.moveTo(controller);
        }
	}
};

module.exports = roleSafeModeGenerator;