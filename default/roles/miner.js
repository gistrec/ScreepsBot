const profiler = require('../screeps-profiler');

const utils        = require('../utils');
const sources      = require('../sources');

const taskResource = require('../tasks/resource');


// 1 WORK part - 2 energy per tick
// 3000 Energy in owned room + Regenerate every 300 game ticks ~= Regenerate 10 energy per tick ~= 5 WORK part

const configurations = [
    // Когда на старте есть максимум 300 энергии, спавним простого рабочего.
    {"energy": 250,  "miningPower": "1", "parts": [WORK, WORK, MOVE]},
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
        if (room.memory.enemy_creeps && !room.controller.safeMode) {
            return true;
        }

        // Note: Спавнящийся крип не попадает в FIND_MY_SPAWNS, поэтому чтобы не плодились лишние крипы
        // добавляем проверку `spawn.name == room.name` - от неё нужно избавиться
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => spawn.name == room.name && !spawn.spawning && spawn.isActive()}).shift();
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
        const miners = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "miner" && creep.ticksToLive > replacementTtl});
        if (miners.length >= sourcesCount) {
            return true;
        }

        const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});
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
        if (creep.ticksToLive < 200 && creep.memory.source_id) {
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

        // Не майним, если энергии некуда деваться: трюм забит, линк забит/отсутствует
        // и под крипом нет контейнера со свободным местом - иначе harvest пропадёт впустую.
        const trunkFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) == 0;
        const linkFull  = !link || link.store.getFreeCapacity(RESOURCE_ENERGY) == 0;
        const containerUsable = container && creep.pos.isEqualTo(container) && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        if (trunkFull && linkFull && !containerUsable) {
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
