const profiler = require('../screeps-profiler');

const utils = require('../utils');

const taskResource = require('../tasks/resource');
const taskCreep  = require('../tasks/creep');
const resourceBalance = require('../modules/resourceBalance');
const settings   = require('../settings');


// max_count подобран по реальной потребности: 2 source × 10 e/tick = 20 e/tick валового
// дохода, каждый чарджер обрабатывает ~30 e/tick (cap/round-trip). По 2 чарджера хватает
// с запасом начиная с 1000e (350e cap, RCL 4+). 300e config держит 4 потому что body очень
// маленькое (100e cap) и часть энергии возится миннером самим - короче спавн ↔ source
// нужно несколько ferries. Раньше 500e/1000e тоже были по 4/3, из-за чего upgrader не
// получал spawn-slot на RCL 2-4 пока ВСЯ квота чарджеров не заполнялась.
const configurations = [
    {"energy": 300,  "max_count": 4, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE]}, // Когда на старте есть максимум 300 энергии, спавним простого перевозчика.
    {"energy": 500,  "max_count": 3, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1000, "max_count": 2, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1500, "max_count": 2, "parts": [MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


// Аварийный чарджер (0 чарджеров, energyAvailable < 300, см. spawn): пары [CARRY, MOVE].
const EMERGENCY_PAIR_COST = BODYPART_COST[CARRY] + BODYPART_COST[MOVE];


// Ищем струкутру около спавна.
// Возврааем её id.
function findStructureNearSpawn(spawn, structureType) {
    const structure = spawn.pos.findClosestByRange(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == structureType && spawn.pos.inRangeTo(s, 3)});
    return structure ? structure.id : null;
}

// Резерв энергии в терминале под пересылки и маркет (см. fill-цепочку в run).
// Настройка terminal_energy_reserve (default 100k).
function terminalEnergyReserve(room) {
    return settings.get(room, 'terminal_energy_reserve');
}

// Пороги балансировки - из modules/resourceBalance.js и settings, без копий:
// resourceBalance.POOR_RECEIVE_FREE - столько свободного места нужно терминалу получателя под
// входящий send (это же покрывает 10k под lab-пересылку и 3k под батарейки на экспорт);
// rb_poor_stored_energy - ниже комната бедная, энергию ей шлют, а не она копит её в терминале.

// Терминал ниже резерва, и его есть чем долить из storage. Кроме чарджера энергию
// storage -> terminal никто не возит (resourceBalance шлёт из терминала, но не пополняет его),
// а fill-цепочка кладёт в терминал только то, что уже в трюме: при паузе майнинга (линк пуст)
// и полных потребителях терминал после send/маркета так и остался бы ниже резерва.
// Без пинг-понга: storage > 20k (как compressEnergy в resourceBalance) - withdraw в run идёт
// из storage первым, а обратного пути terminal -> storage для энергии нет; место в терминале
// под полный трюм - иначе остаток каждый рейс возвращался бы в storage.
// Доливка не съедает место под входящие пересылки: после рейса в терминале остаётся
// >= POOR_RECEIVE_FREE свободного. Бедную комнату не доливаем вовсе - она получатель.
function terminalNeedsStorageEnergy(creep) {
    const terminal = creep.room.terminal;
    const storage  = creep.room.storage;
    if (!terminal || !storage) return false;
    // Недостижимые (utils.moveToTarget) terminal или storage - доливки нет: иначе withdraw из
    // storage не пройдёт, энергия возьмётся из терминала и вернётся в него же (пинг-понг).
    if (utils.isUnreachable(creep, terminal.id) || utils.isUnreachable(creep, storage.id)) return false;
    return terminal.store.getUsedCapacity(RESOURCE_ENERGY) < terminalEnergyReserve(creep.room)
        && terminal.store.getFreeCapacity() - creep.store.getCapacity() >= resourceBalance.POOR_RECEIVE_FREE
        && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 20000
        && creep.room.getTotalEnergy() >= settings.get(null, 'rb_poor_stored_energy');
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
        const charger = utils.creepsByRole(room, "charger");
        // Аварийный чарджер (см. ниже) своё отработал, как только вышел обычный: на переработку
        // (taskCreep.checkRecycling в main.js), его слот в max_count займёт полноразмерный.
        // До ранних выходов: занятый спавн или пропавший needsChargers не должны его оставлять.
        // Обычный умер раньше, чем аварийный дошёл до спавна - снимаем переработку: иначе идущий
        // на переработку считается чарджером и держит спавн замены (charger.length ниже).
        const hasRegular = charger.some(c => !c.memory.emergency);
        for (const c of charger) {
            if (!c.memory.emergency) continue;
            if (hasRegular) c.memory.recycling = true;
            else delete c.memory.recycling;
        }

        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true;

        // Bootstrap RCL 1: ferrying-инфраструктуры нет (контейнер/линк/storage), дропов
        // нет (миннер с CARRY сам несёт в спавн), fillSpawn миннер тоже делает - чарджер
        // 100% idle. Не тратим 300e на бесполезный спавн. Charger-parity gate в miner.spawn
        // (miners > chargers) при 0 чарджерах автоматически капит миннеров до 1, что нам
        // и нужно. Как только появится контейнер у source - needsChargers возвращает true
        // и чарджеры начинают спавниться нормально.
        if (!force && !utils.needsChargers(room)) return true;

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (!force && charger.length >= creepConfiguration.max_count) return true;

        let parts = creepConfiguration.parts;
        let emergency = false;
        if (creepConfiguration.energy > room.energyAvailable) {
            // Чарджеров нет совсем (вайп), а на самое дешёвое тело не хватает: энергию в spawn/extension
            // кроме чарджера не носит никто, спавн регенерирует +1/тик до 300 - до 300 тиков без
            // чарджера. Выпускаем аварийного [CARRY, MOVE] x N на то, что есть (от 100e): довезёт
            // из контейнера/storage, а на полноразмерного его сменят (переработка выше).
            const pairs = Math.floor(room.energyAvailable / EMERGENCY_PAIR_COST);
            if (charger.length > 0 || pairs < 1) {
                console.log(`[${room.name}] Need Charger, but not enought energy [${room.energyAvailable}/${creepConfiguration.energy}]`);
                utils.recordSpawnNeed(room, 'charger', creepConfiguration.energy);
                return false;
            }
            parts = [];
            for (let i = 0; i < pairs; i++) parts.push(CARRY, MOVE);
            emergency = true;
        }

        // Anchor для поиска infrastructure-структур: терминал в RCL 6+ layout стоит в центре
        // ext-кольца, рядом со storage/factory/link/lab. До RCL 6 берём спавн как fallback.
        const anchor = room.terminal || spawn;
        const link_id     = findStructureNearSpawn(anchor, STRUCTURE_LINK);
        const storage_id  = findStructureNearSpawn(anchor, STRUCTURE_STORAGE);
        const factory_id  = findStructureNearSpawn(anchor, STRUCTURE_FACTORY);
        const terminal_id = findStructureNearSpawn(anchor, STRUCTURE_TERMINAL);

        const role = 'charger';
        const name = utils.creepName('Charger', room);
        const energyStructures = utils.getEnergyStructures(room, spawn);
        const memory = {role, link_id, storage_id, factory_id, terminal_id};
        if (emergency) memory.emergency = true;
        const result = spawn.spawnCreep(parts, name, {memory, energyStructures});
        if (result !== OK) {
            console.log(`[${room.name}] spawnCreep ${role} failed: ${result} ${result.toStringStatus()}`);
            // Временный отказ - ждём, как на гейте по энергии; постоянный - не держим цепочку.
            return !utils.isTransientSpawnError(result);
        }
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
            // Лабам из цепочки - только энергия (под бусты); минералы в лабы возят transfer-задачи.
            // С RESOURCES_ALL случайный минерал из трюма уезжал бы в пустую реакционную лабу.
            if (taskResource.fillClosestStructure(creep, STRUCTURE_LAB, 0, RESOURCE_ENERGY) == OK) return;

            // Потребители - раньше складов. terminal/storage принимают любой объём, и всё, что
            // стояло в цепочке после них, не получало энергии никогда: power_spawn стоял с
            // power, но без энергии. Оба шага гейтятся сами: power_spawn - только при power (в нём
            // или в пути) и не под атакой (powerSpawnNeedingEnergy), nuker - по спокойствию и
            // запасу (fillNukerIfCalm).
            if (taskResource.fillPowerSpawnEnergy(creep) == OK) return;
            if (taskResource.fillNukerIfCalm(creep) == OK) return;

            // Склады. В терминале держим резерв под пересылки и маркет (resourceBalance делится
            // при > 50k и по 30k за раз, lab/boost платят комиссию из терминала), остальное - в
            // storage. Раньше терминал (300k) шёл первым и заполнялся энергией под завязку: не
            // оставалось места под минералы из лаб, покупки и входящие пересылки. Если storage
            // нет или он полон - терминал принимает всё последним шагом. Доливку резерва
            // из storage даёт realDemand (terminalNeedsStorageEnergy).
            const terminal = creep.room.terminal;
            const terminalReserve = terminalEnergyReserve(creep.room);
            if (terminal && terminal.store.getUsedCapacity(RESOURCE_ENERGY) < terminalReserve) {
                if (taskResource.fillTarget(creep, terminal) == OK) return;
            }
            if (taskResource.fillClosestStructure(creep, STRUCTURE_STORAGE)   == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TERMINAL)  == OK) return;

            // Ни одна цель не приняла груз: потребители полны, terminal/storage физически полны
            // (типично - минерал/батарейки после снятой transfer-задачи). На пол не выбрасываем:
            // никто не подберёт (политика dumpCargo в tasks/boost.js). Ждём места, логируем редко.
            if (Game.time % 100 == 0) {
                console.log(`[${creep.room.name}] Charger ${creep.name} has nowhere to unload ${JSON.stringify(creep.store)}.`);
            }
            creep.say('🚧Stall');
        } else {
            // Основная задача: получить энергию для заполнения spawn/extension/etc.
            const link = Game.getObjectById(creep.memory.link_id)
	        if (link && link.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
	            // Недостижимый линк (utils.moveToTarget) - берём из складов ниже.
	            if (taskResource.withdrawTarget(creep, link) == OK) return;
	        }

            // Из складов (storage/terminal/factory) берём и остаток (minCount 1): после атаки в
            // storage могло остаться 500 при 600 свободных в трюме - фильтр "store >= free"
            // такой склад пропускал, и чарджер стоял при пустом спавне. Контейнер и дроп в
            // мирном режиме - по-прежнему полной порцией: иначе чарджер "висит" на контейнере
            // майнера, собирая по 10/тик, вместо рейса за полным грузом в storage.
            const ANY = 1;
            if (!creep.room.isUnderAttack) {
                // Мирный режим: сначала pickup и контейнер у майнера (это его выход).
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;

                // Fallback на резервы только если есть РЕАЛЬНЫЙ потребитель: ext/spawn/tower
                // нуждается в энергии. Иначе charger будет вечно гонять storage<->terminal в
                // насыщенной мирной комнате (terminal/storage сами в fill-цепочке).
                // Power_spawn - тоже потребитель (при power в нём или в пути, см. powerSpawnNeedingEnergy):
                // при паузе майнинга (насыщенная комната) линк пуст, нести нечего, и он стоял с
                // power, но без энергии. Из складов под него берём только при запасе
                // >= power_spawn_min_stored_energy (default 50k = default rb_poor_stored_energy,
                // та же метрика getTotalEnergy: энергия + батарейки×10): в бедной энергия нужнее спавну.
                // Терминал ниже резерва - тоже спрос (storage -> terminal, см. terminalNeedsStorageEnergy).
                const byType = utils.getMyStructuresByType(creep.room);
                const psMinStored = settings.get(creep.room, 'power_spawn_min_stored_energy');
                // Потребители из списка недостижимых (utils.moveToTarget) - не спрос: fill-цепочка
                // их пропускает, и взятое из storage вернулось бы в storage (пинг-понг).
                const reachable = (s) => !utils.isUnreachable(creep, s.id);
                const ps = taskResource.powerSpawnNeedingEnergy(creep.room);
                const realDemand =
                       (byType[STRUCTURE_SPAWN]     || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && reachable(s))
                    || (byType[STRUCTURE_EXTENSION] || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && reachable(s))
                    || (byType[STRUCTURE_TOWER]     || []).some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 350 && reachable(s))
                    || (!!ps && reachable(ps) && creep.room.getTotalEnergy() >= psMinStored)
                    || terminalNeedsStorageEnergy(creep);
                if (realDemand) {
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE],  RESOURCE_ENERGY, 0, ANY) == OK) return;
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY, 0, ANY) == OK) return;
                    if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY],  RESOURCE_ENERGY, 0, ANY) == OK) return;
                }
            } else {
                // Под атакой: контейнеры/дроп вне rampart небезопасны. Берём только из защищённых складов.
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE],  RESOURCE_ENERGY, 0, ANY) == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY],  RESOURCE_ENERGY, 0, ANY) == OK) return;
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY, 0, ANY) == OK) return;
                // Защищённых складов нет (RCL 3-5: башни уже есть, storage ещё нет) или они
                // пусты. Без энергии башни и экстеншены не заправить - это проигранная оборона,
                // риск потерять чарджера у контейнера меньше. Дроп берём любой: он decay'ится.
                if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], false) == OK) return;
            }

            // Взять нечего. С непустым трюмом не ждём полного (chechHarvesting снимает harvesting
            // только при полном трюме) - везём, что есть: после частичного withdraw или дозабора
            // из линка чарджер иначе стоял бы с энергией в трюме при пустом спавне.
            if (creep.store.getUsedCapacity() > 0) {
                creep.memory.harvesting = false;
                return;
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
