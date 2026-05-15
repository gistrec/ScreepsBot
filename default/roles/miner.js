const profiler = require('../screeps-profiler');

const utils        = require('../utils');
const sources      = require('../sources');

const taskResource = require('../tasks/resource');


// 1 WORK part - 2 energy per tick
// 3000 Energy in owned room + Regenerate every 300 game ticks ~= Regenerate 10 energy per tick ~= 5 WORK part

// Когда суммарная энергия (включая батарейки×10) в storage/terminal/factory превышает этот
// порог - перестаём спавнить майнеров: складам некуда деваться. Существующие доживут TTL.
// Можно переопределить per-room через room.memory.miner_pause_total_energy.
const DEFAULT_MINER_PAUSE_TOTAL_ENERGY = 2_000_000;

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
        const pauseThreshold = room.memory.miner_pause_total_energy || DEFAULT_MINER_PAUSE_TOTAL_ENERGY;
        if (room.getTotalEnergy() > pauseThreshold) {
            return true;
        }

        const spawn = utils.findFreeSpawn(room);
        if (!spawn) {
            return true;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        const replacementTtl = utils.minerReplacementTtl(creepConfiguration.parts.length);

        // На начальном уровне удваиваем количество майнеров.
        const roomSources = room.find(FIND_SOURCES);
        const sourcesCount = (room.energyCapacityAvailable < 550)
            ? 2 * roomSources.length
            : roomSources.length;
        const miners = utils.creepsByRole(room, "miner").filter(c => c.ticksToLive > replacementTtl);
        if (miners.length >= sourcesCount) {
            return true;
        }

        // Charger-parity gate: не плодим миннеров, для которых нет чарджера, иначе энергия
        // копится в контейнере / на земле. На bootstrap'е charger.spawn капится до 1, что
        // через этот gate автоматически даёт ровно 1 миннера до построения контейнера.
        const charger = utils.creepsByRole(room, "charger");
        if (miners.length > charger.length) {
            return true;
        }

        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Room need Miner, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        // Pre-assign source: выбираем тот, где меньше всего живых майнеров (тот, что уходит, не считается).
        // Без этого новый рискует попасть на source соседа вместо того, чтобы заменить умирающего.
        const targetSource = roomSources.map((s) => ({
            source: s,
            count: miners.filter((m) => m.memory.source_id == s.id).length,
        })).sort((a, b) => a.count - b.count).shift().source;

        const name = 'Miner' + Game.time;
        const role = 'miner';
        const miningPower = creepConfiguration["miningPower"];
        const source_id = targetSource.id;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, miningPower, source_id }, energyStructures});
        console.log(`[${room.name}] Spawning new ${role} ${name} for source ${source_id}`);

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
                console.log(`[${creep.room.name}] Miner ${creep.name} (TTL ${creep.ticksToLive}) hands off to ${replacement.name}`);
                creep.suicide();
                return;
            }
        }

        // Pre-death drain: в последние ~100 тиков любой ценой пытаемся слить трюм в линк
        // (даже если трюм не полон). Естественную TTL-смерть с непустым трюмом не вытащить
        // целиком, но чем меньше энергии в гробнице - тем меньше дроп после её decay.
        if (creep.ticksToLive < 100 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const link = Game.structures[creep.memory.link_id];
            if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
                return;
            }
        }

        // Двигаемся к контейнеру.
        const container = Game.getObjectById(creep.memory.container_id);
        if (container && !creep.pos.isEqualTo(container)) {
            creep.moveTo(container);
            return;
        }

        if (creep.memory.miningPower && (Game.time % creep.memory.miningPower != 0)) {
            return;
        }

        // Поднимаем ресурсы из контейнера.
        if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            taskResource.withdrawTarget(creep, container);
        }

        const link = Game.structures[creep.memory.link_id];
        const linkFull = !link || link.store.getFreeCapacity(RESOURCE_ENERGY) == 0;
        const containerUsable = container && creep.pos.isEqualTo(container) && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        const carryCap = creep.store.getCapacity(RESOURCE_ENERGY) || 0;
        const isFull = carryCap > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) == 0;

        // Если есть CARRY и ни линка, ни контейнера под нами нет:
        // - В established комнате (есть storage) просто дропаем у source - чарджер заберёт,
        //   тащиться через всю базу в спавн неоправданно.
        // - В bootstrap-комнате (нет storage, RCL<4) сами доставляем в спавн/extension,
        //   потому что иначе спавн остаётся пустым: 250e ушло на миннера, чарджеру неоткуда.
        if (isFull && linkFull && !containerUsable) {
            if (creep.room.storage) {
                creep.drop(RESOURCE_ENERGY);
                return;
            }
            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            creep.drop(RESOURCE_ENERGY);
            return;
        }

        // Основная задача:
        // * Добывать ресурсы
        const target = sources.get(creep);
        taskResource.harvestTarget(creep, target);

        // Передаем ресурсы линку.
        if (link && !creep.store.getFreeCapacity(RESOURCE_ENERGY) && creep.store.getCapacity(RESOURCE_ENERGY) && link.store.getFreeCapacity(RESOURCE_ENERGY)) {
            taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
        }
	}
};


module.exports = roleMiner;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.miner.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.miner.run");
