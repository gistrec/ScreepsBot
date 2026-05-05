const profiler = require('../screeps-profiler');

const utils = require('../utils');

const taskResource = require('../tasks/resource');
const taskCreep  = require('../tasks/creep');


const configurations = [
    {"energy": 300,  "max_count": 4, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE]}, // Когда на старте есть максимум 300 энергии, спавним простого перевозчика.
    {"energy": 500,  "max_count": 4, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1000, "max_count": 3, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1500, "max_count": 2, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


// Ищем струкутру около спавна.
// Возврааем её id.
function findStructureNearSpawn(spawn, structureType) {
    const structure = spawn.pos.findClosestByRange(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == structureType && spawn.pos.inRangeTo(s, 3)});
    return structure ? structure.id : null;
}

const roleCharger = {
    spawn: function(room, force = false) {
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) {
            return true;
        }

        const charger = utils.creepsByRole(room, "charger");
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (charger.length >= creepConfiguration['max_count']) {
            if (!force) return true;
        }

        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`Room ${room.name} need Charger, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        // TODO: Мб искать рядом с терминалом?
        // Ищем link рядом со спавном
        const link_id     = findStructureNearSpawn(room.terminal ? room.terminal : spawn, STRUCTURE_LINK);
        const storage_id  = findStructureNearSpawn(room.terminal ? room.terminal : spawn, STRUCTURE_STORAGE);
        const factory_id  = findStructureNearSpawn(room.terminal ? room.terminal : spawn, STRUCTURE_FACTORY);
        const terminal_id = findStructureNearSpawn(room.terminal ? room.terminal : spawn, STRUCTURE_TERMINAL);

        const role = 'charger';
        const name = 'Charger' + Game.time;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, link_id, storage_id, factory_id, terminal_id }, energyStructures});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если бот лечится.
        // if (taskCreep.checkTTL(creep) == OK) return;

        // Проверяем нужно ли переместить ресурсы в Factory
        if (taskResource.disassembleResource(creep) == OK) return;

        if (taskResource.transferResource(creep) == OK) return;

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // Основные задачи:
            // * Заполнить спавн
            // * Заполнить extension
            // * Заполнить контейнеры
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
                if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
                if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            }

            if (creep.room.isUnderAttack) {
                if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 200) == OK) return;
            }
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 350)   == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_LAB)          == OK) return;
            // if (taskResource.fillClosestStructure(creep, STRUCTURE_FACTORY, 200) == OK) return;

            // TODO: Сделать так, чтобы в терминале всегда было 30к энергии для резерва
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL)  == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)   == OK) return;
            if (taskResource.fillPowerSpawnEnergy(creep) == OK) return;
            if (taskResource.fillNukerIfCalm(creep) == OK) return;
        } else {
            // Основная задача: получить энергию для заполнения spawn/extension/etc.
            const link = Game.getObjectById(creep.memory.link_id)
	        if (link && link.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
	            taskResource.withdrawTarget(creep, link);
	            return;
	        }

            if (!creep.room.isUnderAttack) {
                // Мирный режим: сначала pickup и контейнер у майнера (это его выход).
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;

                // Fallback на резервы только если есть РЕАЛЬНЫЙ потребитель: ext/spawn/tower
                // нуждается в энергии. Иначе charger будет вечно гонять storage<->terminal в
                // насыщенной мирной комнате (terminal/storage сами в fill-цепочке).
                const byType = utils.getMyStructuresByType(creep.room);
                const realDemand =
                       (byType[STRUCTURE_SPAWN]     || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                    || (byType[STRUCTURE_EXTENSION] || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                    || (byType[STRUCTURE_TOWER]     || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 350);
                if (realDemand) {
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE])  == OK) return;
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY])  == OK) return;
                }
            } else {
                // Под атакой: контейнеры/дроп вне rampart небезопасны. Берём только из защищённых складов.
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE])  == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY])  == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
            }
        }
	}
};

module.exports = roleCharger;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.charger.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.charger.run");
