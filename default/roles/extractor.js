const utils = require('../utils');

const taskCreep     = require('../tasks/creep');
const taskRoom      = require('../tasks/room');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');

const lab = require('../modules/lab');
const settings = require('../settings');
const log = require('../log');


const MAX_EXTRACTORS_IN_ROOM = 1;

const roleExtractor = {
    spawn: function(room) {
        // Не спавним, если в комнате нет минерала
        const [mineralId, mineralType] = room.getMineral();
        if (!mineralId) return true; // No need to spawn

        // Не спавним, если в комнате временно закончились минералы
        const mineral = Game.getObjectById(mineralId);
        // mineralId был валиден на момент room.getMineral() (видна комната), но если этот
        // тик мы потеряли видимость - getObjectById вернёт null. Не спавним, проверим позже.
        if (!mineral) return true;
        if (mineral.mineralAmount == 0) return true; // No need to spawn

        // Не спавним, если в хранилищах слишком много минералов
        const mineralCountInStorage = (room.storage ? room.storage.store.getUsedCapacity(mineralType) : 0);
        const mineralcountInTerminal = (room.terminal ? room.terminal.store.getUsedCapacity(mineralType) : 0);
        const mineralCountInRoom = mineralCountInStorage + mineralcountInTerminal;
        if (mineralCountInRoom > settings.get(room, 'extractor_max_minerals')) return true; // No need to spawn

        // Не спавним, если все потребители этого минерала (импортёры через `require`
        // и локальные лабы по `resources`) уже забиты. Добытое некуда девать.
        if (lab.isDownstreamSaturated(mineralType)) return true; // No need to spawn

        // Спавним как только появится свободный спавн
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true; // Need to spawn

        // Не спавним, если в комнате уже есть extractor
        const extractors = utils.creepsByRole(room, 'extractor');
        if (extractors.length >= MAX_EXTRACTORS_IN_ROOM) return true; // No need to spawn

        // Не спавним, если в комнате нет экстрактора
        const extractor = room.find(FIND_MY_STRUCTURES, {filter: (structure) => structure.structureType == STRUCTURE_EXTRACTOR}).shift();
        if (!extractor) return true; // No need to spawn

        const name  = utils.creepName('Extractor', room);
        const role = 'extractor';
        const mineral_id = mineral.id;
        const extractor_id = extractor.id;
        const parts = [
            WORK,  WORK,  WORK,  WORK,  WORK,
            MOVE,  MOVE,  MOVE,  MOVE,  MOVE,
            CARRY, CARRY, CARRY, CARRY, CARRY,
        ];
        // Нет энергии - не держим цепочку: всё, что ниже (reserver 1300e, harvester 1250e),
        // дороже и всё равно не заспавнится, а ложный spawn_need и пустой intent не нужны.
        // Повторим на следующем проходе.
        if (utils.bodyCost(parts) > room.energyAvailable) return true;

        const result = spawn.spawnCreep(parts, name, {memory: { role, mineral_id, extractor_id }, energyStructures: utils.getEnergyStructures(room, spawn)});
        if (result !== OK) {
            log.error(`spawn-fail:${room.name}:${role}:${result}`, `[${room.name}] spawnCreep ${role} failed: ${result} ${result.toStringStatus()}`);
            // Временный отказ - ждём, как остальные роли; постоянный - не держим цепочку.
            return !utils.isTransientSpawnError(result);
        }
        log.info(`spawn:${room.name}:${role}`, `[${room.name}] Spawning new ${role} ${name}`);

        // Не пытаемся спавнить других крипов в этот тик
        return false;
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
            // Mineral может быть невидим если креп ушёл в комнату без vision'а (не должно
            // происходить - extractor живёт в своей комнате - но при downgrade/смене claim'а
            // возможно). Без null-check creep.suicide отсюда правильнее чем TypeError на следующей строке.
            if (!mineral) {
                creep.suicide();
                return;
            }
            if (!mineral.mineralAmount) {
                // Минерал кончился с недобранным трюмом (харвестили до последнего). Раньше суицид
                // сразу - до 250 минерала в гробницу и на пол, подбирать некому (pickup только
                // энергии). Сначала разгружаемся: harvesting=false уводит в fill-ветку выше,
                // после выгрузки chechHarvesting вернёт сюда с пустым трюмом - тогда суицид.
                if (creep.store.getUsedCapacity() > 0) {
                    creep.memory.harvesting = false;
                    return;
                }
                creep.suicide();
                return;
            }

            taskResource.harvestTarget(creep, mineral);
        }
	}
};

module.exports = roleExtractor;