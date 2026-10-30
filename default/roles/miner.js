const profiler = require('../screeps-profiler');

const utils        = require('../utils');
const sources      = require('../sources');

const taskResource = require('../tasks/resource');
const settings     = require('../settings');
const log = require('../log');


// 1 WORK part - 2 energy per tick
// 3000 Energy in owned room + Regenerate every 300 game ticks ~= Regenerate 10 energy per tick ~= 5 WORK part

// Когда суммарная энергия (включая батарейки×10) в storage/terminal/factory превышает этот
// порог (настройка miner_pause_total_energy, default 2M) - перестаём спавнить майнеров:
// складам некуда деваться. Существующие доживут TTL.

// Восстановление после вайпа: сколько тиков первый майнер ждёт полное тело, пока чарджер
// доливает spawn/extension из складов. Дальше - тело по energyAvailable, как раньше (склад
// недостижим, чарджер не справляется) - иначе майнер держал бы всю цепочку спавна.
const RECOVERY_WAIT_TICKS = 150;
// Таймер ожидания самовосстанавливается: если проверка восстановления не доходила до него дольше
// этого (цепочка спавна - раз в 10 тиков; прервали атака, пауза, пропавший чарджер и т.п.),
// ожидание начинается заново, а не считается сразу истёкшим.
const RECOVERY_STALE_TICKS = 20;

const configurations = [
    // Bootstrap RCL 2: WORK+CARRY+2*MOVE. С CARRY сам носит энергию в спавн до появления
    // чарджера (без неё энергия дропается и decay-ится - тупик). 2 MOVE = 0 fatigue на plain.
    {"energy": 250,  "miningPower": "1", "parts": [WORK, CARRY, MOVE, MOVE]},
    // Когда появились 5 Extension (на 2 уровне контроллера).
    {"energy": 550,  "miningPower": "1", "parts": [WORK, WORK, WORK, WORK, WORK, MOVE]},
    // Когда в мнате появляются линки
    {"energy": 700,  "miningPower": "1", "parts": [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]},
    // Для сохранения CPU - будем майнить ресурсы раз в 2 тика
    {"energy": 5000, "miningPower": "2", "parts": [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE]},
    // Для сохранения CPU - будем майнить ресурсы раз в 4 тика
];


const roleMiner = {
    spawn: function(room) {
        if (room.isUnderAttack) {
            return true;
        }

        // Если стокпайл насыщен - не спавним замены. Старые доживут и источник простаивает,
        // пока энергия не уйдёт на upgrade/repair/что-нибудь ещё.
        const pauseThreshold = settings.get(room, 'miner_pause_total_energy');
        if (room.getTotalEnergy() > pauseThreshold) {
            return true;
        }

        const spawn = utils.findFreeSpawn(room);
        if (!spawn) {
            return true;
        }

        let creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        const replacementTtl = utils.minerReplacementTtl(creepConfiguration.parts.length);

        // На начальном уровне удваиваем количество майнеров: 250e config даёт 1 WORK =
        // 2 e/tick, что сильно меньше source-regen 10 e/tick, поэтому два маленьких
        // миннера на 2-source-комнате полезны. Для 1-source комнаты удвоение бесполезно:
        // source всё равно bottleneck, 2 миннера на одном источнике не дают двойного
        // throughput, а спавн 2×250e впустую.
        const roomSources = utils.getSources(room);
        const sourcesCount = (room.energyCapacityAvailable < 550 && roomSources.length > 1)
            ? 2 * roomSources.length
            : roomSources.length;
        const miners = utils.creepsByRole(room, "miner").filter(c => c.ticksToLive > replacementTtl);
        if (miners.length >= sourcesCount) {
            delete room.memory.miner_recovery;
            return true;
        }

        // Charger-parity gate: не плодим миннеров, для которых нет чарджера, иначе энергия
        // копится в контейнере / на земле. На bootstrap'е charger.spawn капится до 1, что
        // через этот gate автоматически даёт ровно 1 миннера до построения контейнера.
        // Чарджер на переработке (аварийный, см. charger.spawn) энергию уже не носит - не считаем
        // его ни здесь, ни в восстановлении ниже.
        const allChargers = utils.creepsByRole(room, "charger");
        const charger = allChargers.filter(c => !c.memory.recycling);
        if (miners.length > charger.length) {
            return true;
        }

        // Восстановление после вайпа. Энергию в spawn/extension носит только чарджер: майнер со
        // storage к спавну не ходит, а спавн регенерирует +1/тик до 300. Раньше майнер забирал
        // energyAvailable целиком, и первый чарджер ждал регенерацию до 300 тиков, пока storage
        // стоял полный.
        const stored = utils.getStoredSpawnEnergy(room);
        const capacity = utils.getEffectiveEnergyCapacity(room);
        let recovering = false;
        if (charger.length == 0) {
            // 1. Чарджеров нет, в складах запас на полную заливку - чарджер первым (порядок цепочки
            //    не меняем, майнер передаёт ход, как на parity-гейте выше). Остались только чарджеры
            //    на переработке - тоже передаём ход: charger.spawn снимет её с аварийного, а sizing
            //    ниже (getEnergyCapacityAvailable) считал бы их и ждал полное тело.
            if (allChargers.length > 0 || (utils.needsChargers(room) && stored >= capacity)) {
                return true;
            }
        } else if (utils.creepsByRole(room, "miner").length == 0) {
            // 2. Чарджер есть, майнеров нет: getAvailableCreepConfiguration берёт тело по текущему
            //    energyAvailable, и майнер вышел бы 250e (1 WORK на 1500 тиков), пока чарджер ещё
            //    доливает. Если энергии в складах + spawn/extension + трюмах чарджеров хватает на
            //    полную заливку - ждём полное тело, но не дольше RECOVERY_WAIT_TICKS.
            const cargo = charger.reduce((sum, c) => sum + c.store.getUsedCapacity(RESOURCE_ENERGY), 0);
            if (stored + room.energyAvailable + cargo >= capacity) {
                recovering = true;
                const recovery = room.memory.miner_recovery;
                if (!recovery || Game.time - recovery.seen > RECOVERY_STALE_TICKS) {
                    room.memory.miner_recovery = {since: Game.time, seen: Game.time};
                } else {
                    recovery.seen = Game.time;
                }
                if (Game.time - room.memory.miner_recovery.since < RECOVERY_WAIT_TICKS) {
                    creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room, capacity);
                }
            }
        }
        if (!recovering) delete room.memory.miner_recovery;

        if (creepConfiguration["energy"] > room.energyAvailable) {
            log.info(`spawn-energy:${room.name}:miner`, `[${room.name}] Room need Miner, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            utils.recordSpawnNeed(room, 'miner', creepConfiguration["energy"]);
            return false;
        }

        // Pre-assign source: выбираем тот, где меньше всего живых майнеров (тот, что уходит, не считается).
        // Без этого новый рискует попасть на source соседа вместо того, чтобы заменить умирающего.
        const targetSource = roomSources.map((s) => ({
            source: s,
            count: miners.filter((m) => m.memory.source_id == s.id).length,
        })).sort((a, b) => a.count - b.count).shift().source;

        const name = utils.creepName('Miner', room);
        const role = 'miner';
        const miningPower = creepConfiguration["miningPower"];
        const source_id = targetSource.id;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        const result = spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, miningPower, source_id }, energyStructures});
        if (result !== OK) {
            log.error(`spawn-fail:${room.name}:${role}:${result}`, `[${room.name}] spawnCreep ${role} failed: ${result} ${result.toStringStatus()}`);
            // Временный отказ - ждём, как на гейте по энергии; постоянный - не держим цепочку.
            return !utils.isTransientSpawnError(result);
        }
        log.info(`spawn:${room.name}:${role}`, `[${room.name}] Spawning new ${role} ${name} for source ${source_id}`);
        delete room.memory.miner_recovery;

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если рядом стоит свежий майнер на том же source - этот старый уже не нужен.
        // Самоубиваемся, чтобы освободить место (контейнер, спот рядом с source).
        // TTL < 200: я уже доживаю; TTL замены > 800: это явно свежий крип, а не просто другой умирающий.
        // Условие на пустой трюм: суицид с энергией = tombstone -> drop на полный контейнер -> чарджеры отвлекаются.
        if (creep.ticksToLive < 200 && creep.memory.source_id && creep.store.getUsedCapacity() === 0) {
            const replacement = creep.pos.findInRange(FIND_MY_CREEPS, 2, {
                filter: (c) => c.id != creep.id
                            && c.memory.role == 'miner'
                            && c.memory.source_id == creep.memory.source_id
                            && c.ticksToLive > 800
            }).shift();
            if (replacement) {
                log.debug(`miner:handoff:${creep.room.name}`, `[${creep.room.name}] Miner ${creep.name} (TTL ${creep.ticksToLive}) hands off to ${replacement.name}`);
                creep.suicide();
                return;
            }
        }

        // Pre-death drain: в последние ~100 тиков любой ценой пытаемся слить трюм в линк
        // (даже если трюм не полон). Естественную TTL-смерть с непустым трюмом не вытащить
        // целиком, но чем меньше энергии в гробнице - тем меньше дроп после её decay.
        if (creep.ticksToLive < 100 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const link = Game.structures[creep.memory.link_id];
            if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && !utils.isUnreachable(creep, link.id)) {
                taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
                return;
            }
        }

        // Source из памяти; sources.get заодно перепроверяет протухшие container_id/link_id
        // (контейнер отстроен заново или появился после спавна). Поэтому зовём ДО чтения
        // контейнера и до isFull-ветки: майнер с полным трюмом и мёртвым container_id раньше
        // уходил в "💤Full" и до sources.get в конце run() не доходил никогда.
        const target = sources.get(creep);

        // Двигаемся к контейнеру.
        const container = Game.getObjectById(creep.memory.container_id);
        if (container && !creep.pos.isEqualTo(container)) {
            creep.moveTo(container);
            return;
        }

        if (creep.memory.miningPower && (Game.time % creep.memory.miningPower != 0)) {
            return;
        }

        const link = Game.structures[creep.memory.link_id];
        // Линк годится, только если до него дотянуться с места (transfer - range 1). sources.js
        // ищет линк в range 2 от source, что не гарантирует range 1 от контейнера: с контейнера
        // transfer даёт ERR_NOT_IN_RANGE, fillTarget уводит майнера к линку, следующий тик
        // moveTo(container) выше возвращает - осцилляция без единого харвеста. Без контейнера
        // майнер к клетке не привязан, дойти до линка допустимо (как и раньше).
        // Недостижимый линк (utils.moveToTarget в fillTarget) - не годится: fillTarget к нему
        // больше не идёт, а майнер с полным трюмом стоял бы на "return" ниже.
        const linkUsable = link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            && (!container || creep.pos.isNearTo(link))
            && !utils.isUnreachable(creep, link.id);
        const containerUsable = container && creep.pos.isEqualTo(container) && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        const carryCap = creep.store.getCapacity(RESOURCE_ENERGY) || 0;
        const isFull = carryCap > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) == 0;

        // Полный трюм - перед харвестом разгружаемся. Overflow harvest()'а движок кладёт в
        // контейнер на клетке майнера (engine: harvest.js -> drop -> _create-energy: сначала
        // container по x/y крипа, остаток - на пол). Явный transfer нужен ради линка (туда
        // overflow не идёт) и чтобы не дропать на пол при забитом контейнере.
        // Приоритет link > container: link сам пушит на дальний приёмник (storage/upgrader),
        // контейнер требует чарджера. При забитом линке чарджер вообще не нужен этой ветке.
        if (isFull) {
            // 1. Линк со свободным местом.
            if (linkUsable) {
                taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
                return;
            }
            // 2. Контейнер под крипом со свободным местом.
            if (containerUsable) {
                creep.transfer(container, RESOURCE_ENERGY);
                return;
            }
            // 3. Bootstrap-комната (нет storage): сами носим в spawn/extension. Иначе
            //    спавн остаётся пустым - 250e ушло на миннера, чарджеру неоткуда.
            //    Если spawn/extension тоже забиты - вынужденный drop как fallback.
            if (!creep.room.storage) {
                if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN) == OK) return;
                if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
                creep.drop(RESOURCE_ENERGY);
                return;
            }
            // 4. Established (есть storage), контейнер/линк забиты - НЕ МАЙНИМ и НЕ ДРОПАЕМ.
            //    Source регенерируется бесплатно, пусть ждёт пока чарджер вычерпает контейнер.
            //    Раньше делали creep.drop() ("чарджер подберёт"), но при забитом контейнере
            //    чарджер и так не справляется - дроп просто копился на полу.
            //    Пока ждём - тратим трюм на upgradeController, если контроллер в range 3
            //    от контейнера (controller_id выставлен в sources.js).
            if (tryUpgradeController(creep)) return;
            creep.say('💤Full');
            return;
        }

        // Основная задача: добывать ресурсы. Не харвестим если в трюме нет места под полный
        // output одного тика (5 WORK = 10e/tick) - creep.harvest() переливает в drop при
        // партиальной нехватке (freeCap=5, harvest 10 → 5 в трюм + 5 на пол). isFull выше
        // ловит только freeCap==0; partial overflow возникает после tryUpgradeController
        // (drain 5/tick), который оставляет miner на 95/100.
        // Приоритет если харвестить нельзя: линк > контейнер > апгрейд. Линк лучше контейнера
        // (см. isFull-комментарий выше), оба лучше апгрейда (апгрейдить контроллер можно из
        // любой комнаты, а заполнить локальный линк/контейнер - только мы).
        const harvestPerTick = creep.body.filter(p => p.type === WORK).length * HARVEST_POWER;
        // Drop-miner (550e config, без CARRY): трюма нет, freeCap всегда 0 - проверка по трюму
        // навсегда запрещала харвест, крип весь TTL стоял на контейнере без дела (и считался
        // в sourcesCount, так что замену не спавнили). Его harvest() кладёт энергию в контейнер
        // под ногами (см. комментарий к isFull), без контейнера - на пол, откуда подбирает
        // чарджер (needsChargers в utils.js это и подразумевает). "Место в трюме" для него -
        // место в контейнере; без storage сыплем и при забитом (как п.3 выше для CARRY).
        const canFitHarvest = carryCap > 0
            ? creep.store.getFreeCapacity(RESOURCE_ENERGY) >= harvestPerTick
            : !container || !creep.room.storage || container.store.getFreeCapacity(RESOURCE_ENERGY) >= harvestPerTick;
        const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        if (target && target.energy > 0 && canFitHarvest) {
            taskResource.harvestTarget(creep, target);
        } else if (hasEnergy && linkUsable) {
            taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
        } else if (hasEnergy && containerUsable) {
            creep.transfer(container, RESOURCE_ENERGY);
        } else {
            tryUpgradeController(creep);
        }
	}
};

// Опциональный апгрейд контроллера - вызывается из miner.run когда source в cooldown
// или контейнер/линк забиты. Возвращает true если апгрейд выполнен (intent-слот занят).
function tryUpgradeController(creep) {
    if (!creep.memory.controller_id) return false;
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return false;
    const controller = Game.getObjectById(creep.memory.controller_id);
    if (!controller) return false;
    if (creep.upgradeController(controller) === OK) {
        creep.say('⬆️');
        return true;
    }
    return false;
}


module.exports = roleMiner;
// Для console.status (порог "уходящего" майнера = minerReplacementTtl тела текущего конфига).
module.exports.configurations = configurations;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.miner.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.miner.run");
