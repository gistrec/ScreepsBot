const taskCreep     = require('task.creep');
const taskBoost     = require('task.boost');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');

// Сверху: 28:25:W8S36 5bbcac769099fc012e6357ed, 34:24:W8S36 5bbcac769099fc012e6357ec
// Снизу:  28:35:W8S38 5bbcac769099fc012e6357f4, 34:23:W8S38 5bbcac769099fc012e6357f3

const roleRemoteUpgrader = {
    run: function(creep) {
        if (creep.fatigue != 0) return;

        if (taskCreep.checkTTL(creep)   == OK) return; // Проверяем TTL бота
        if (taskBoost.checkBoost(creep) == OK) return; // Проверяем необходимость в бусте
        
        // Если не заданы все параметры для работы
        if (!creep.memory.source_id || !creep.memory.source_location || !creep.memory.controller_id) {
            creep.say('⚠️ Memory');
            return;
        }
        
        
        if (taskBoost.canBoost(creep, "XKH2O") && !taskBoost.hasBoost(creep, "XKH2O")) {
            console.log("Need XKH2O")
            creep.memory.boost = "XKH2O";
            return;
        }

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Обновляем контроллер
            const controller = Game.getObjectById(creep.memory.controller_id);
            if (taskStructure.upgradeController(creep, controller) == OK) return;
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

module.exports = roleRemoteUpgrader;