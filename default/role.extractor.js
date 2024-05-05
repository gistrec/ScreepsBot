const taskCreep     = require('task.creep');
const taskRoom      = require('task.room');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');


const MAX_EXTRACTORS_IN_ROOM = 1;
const MAX_MINERALS_IN_ROOM = 15000;

const roleExtractor = {
    spawn: function(room) {
        // Не спавним, если в комнате нет минерала
        const [mineralId, mineralType] = taskRoom.getMineral(room);
        if (!mineralId) return false; // No need to spawn

        // Не спавним, если в комнате временно закончились минералы
        const mineral = Game.getObjectById(mineralId);
        if (mineral.mineralAmount == 0) return; // No need to spawn

        // Не спавним, если в хранилищах слишком много минералов
        const mineralCountInStorage = (room.storage ? room.storage.store.getUsedCapacity(mineralType) : 0);
        const mineralcountInTerminal = (room.terminal ? room.terminal.store.getUsedCapacity(mineralType) : 0);
        const mineralCountInRoom = mineralCountInStorage + mineralcountInTerminal;
        if (mineralCountInRoom > MAX_MINERALS_IN_ROOM) return false; // No need to spawn
        
        // Спавним как только появится свободный спавн
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning && spawn.name == room.name && spawn.isActive()}).shift();
        if (!spawn) return true; // Need to spawn
        
        // Не спавним, если в комнате уже есть extractor
        const extractors = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == 'extractor' });
        if (extractors.length >= MAX_EXTRACTORS_IN_ROOM) return false; // No need to spawn

        // Не спавним, если в комнате нет экстрактора
        const extractor = room.find(FIND_MY_STRUCTURES, {filter: (structure) => structure.structureType == STRUCTURE_EXTRACTOR}).shift();
        if (!extractor) return false; // No need to spawn
        
        const name  = 'Extractor' + Game.time;
        const role = 'extractor';
        const mineral_id = mineral.id;
        const extractor_id = extractor.id;
        const parts = [
            WORK,  WORK,  WORK,  WORK,  WORK,
            MOVE,  MOVE,  MOVE,  MOVE,  MOVE,
            CARRY, CARRY, CARRY, CARRY, CARRY,
        ];
        spawn.spawnCreep(parts, name, {memory: { role, mineral_id, extractor_id }, energyStructures: [
            // Сначала выкачиваем энергию из экстеншенов.
            ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_EXTENSION}),
            spawn
        ]});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        // Не пытаемся спавнить других крипов в этот тик
        return true;
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если бот обновляет ttl
        if (taskCreep.checkTTL(creep) == OK) return;

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK);
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK);
        } else {
            const mineral = Game.getObjectById(creep.memory.mineral_id);

            taskResource.harvestTarget(creep, mineral);
        }
	}
};

module.exports = roleExtractor;