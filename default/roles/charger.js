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

// Парковка чарджера в фиксированной точке (storage.x+1, storage.y) - в layout-е
// эта клетка соседняя и со storage, и с линком, и обычно с терминалом, поэтому
// withdraw из линка + transfer в storage идут без беготни. Работает только для
// closest-to-link чарджера: иначе при нескольких чарджерах все встанут в очередь.
function parkNearLink(creep) {
    const storage = creep.memory.storage_id ? Game.getObjectById(creep.memory.storage_id) : null;
    if (!storage) return;
    const link = creep.memory.link_id ? Game.getObjectById(creep.memory.link_id) : null;
    if (!link) return;

    const parkPos = new RoomPosition(storage.pos.x + 1, storage.pos.y, storage.pos.roomName);
    if (creep.pos.isEqualTo(parkPos)) return;

    const chargers = utils.creepsByRole(creep.room, 'charger');
    const myRange = creep.pos.getRangeTo(link);
    if (chargers.some(c => c.id !== creep.id && c.pos.getRangeTo(link) < myRange)) return;

    creep.moveTo(parkPos, {reusePath: 20, visualizePathStyle: {stroke: '#888888', lineStyle: 'dotted'}});
}

const roleCharger = {
    spawn: function(room, force = false) {
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true;

        // Bootstrap RCL 1: ferrying-инфраструктуры нет (контейнер/линк/storage), дропов
        // нет (миннер с CARRY сам несёт в спавн), fillSpawn миннер тоже делает - чарджер
        // 100% idle. Не тратим 300e на бесполезный спавн. Charger-parity gate в miner.spawn
        // (miners > chargers) при 0 чарджерах автоматически капит миннеров до 1, что нам
        // и нужно. Как только появится контейнер у source - needsChargers возвращает true
        // и чарджеры начинают спавниться нормально.
        if (!force && !utils.needsChargers(room)) return true;

        const charger = utils.creepsByRole(room, "charger");
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (!force && charger.length >= creepConfiguration.max_count) return true;

        if (creepConfiguration.energy > room.energyAvailable) {
            console.log(`[${room.name}] Need Charger, but not enought energy [${room.energyAvailable}/${creepConfiguration.energy}]`);
            return false;
        }

        // Anchor для поиска infrastructure-структур: терминал в RCL 6+ layout стоит в центре
        // ext-кольца, рядом со storage/factory/link/lab. До RCL 6 берём спавн как fallback.
        const anchor = room.terminal || spawn;
        const link_id     = findStructureNearSpawn(anchor, STRUCTURE_LINK);
        const storage_id  = findStructureNearSpawn(anchor, STRUCTURE_STORAGE);
        const factory_id  = findStructureNearSpawn(anchor, STRUCTURE_FACTORY);
        const terminal_id = findStructureNearSpawn(anchor, STRUCTURE_TERMINAL);

        const role = 'charger';
        const name = 'Charger' + Game.time;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration.parts, name, {memory: {role, link_id, storage_id, factory_id, terminal_id}, energyStructures});
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

            // Под атакой порог ниже (200 vs 350) - чаще дозаливаем, чтобы tower не остался
            // на нуле в разгар боя. Fallback на 350 не нужен: free>350 ⊂ free>200, если
            // 200-фильтр ничего не нашёл, 350 тем более ничего не найдёт.
            const towerThreshold = creep.room.isUnderAttack ? 200 : 350;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, towerThreshold) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_LAB)                   == OK) return;

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

            // Дошли сюда - в комнате нет источника энергии. Сидим у линка вместо случайной
            // позиции после последнего fill: source-link пушнёт - заберём на следующем тике.
            parkNearLink(creep);
        }
	}
};

module.exports = roleCharger;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.charger.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.charger.run");
