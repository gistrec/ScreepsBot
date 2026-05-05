const utils = require('../utils');

const taskCreep     = require('../tasks/creep');
const taskRoom      = require('../tasks/room');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');

const lab = require('../modules/lab');


const MAX_EXTRACTORS_IN_ROOM = 1;
const MAX_MINERALS_IN_ROOM = 150000;

const roleExtractor = {
    spawn: function(room) {
        // Не спавним, если в комнате нет минерала
        const [mineralId, mineralType] = room.getMineral();
        if (!mineralId) return false; // No need to spawn

        // Не спавним, если в комнате временно закончились минералы
        const mineral = Game.getObjectById(mineralId);
        if (mineral.mineralAmount == 0) return; // No need to spawn

        // Не спавним, если в хранилищах слишком много минералов
        const mineralCountInStorage = (room.storage ? room.storage.store.getUsedCapacity(mineralType) : 0);
        const mineralcountInTerminal = (room.terminal ? room.terminal.store.getUsedCapacity(mineralType) : 0);
        const mineralCountInRoom = mineralCountInStorage + mineralcountInTerminal;
        if (mineralCountInRoom > MAX_MINERALS_IN_ROOM) return false; // No need to spawn

        // Не спавним, если все потребители этого минерала (импортёры через `require`
        // и локальные лабы по `resources`) уже забиты. Добытое некуда девать.
        if (lab.isDownstreamSaturated(mineralType)) return false; // No need to spawn

        // Спавним как только появится свободный спавн
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true; // Need to spawn

        // Не спавним, если в комнате уже есть extractor
        const extractors = utils.creepsByRole(room, 'extractor');
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
            // TODO: Fill 10k to terminal, then fill storage
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE) == OK) return;
        } else {
            const mineral = Game.getObjectById(creep.memory.mineral_id);
            if (!mineral.mineralAmount) {
                creep.suicide();
                return;
            }

            taskResource.harvestTarget(creep, mineral);
        }
	}
};

module.exports = roleExtractor;