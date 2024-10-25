const profiler = require('../screeps-profiler');

const utils        = require('../utils');
const sources      = require('../sources');

const taskResource = require('../tasks/resource');


// 1 WORK part - 2 energy per tick
// 3000 Energy in owned room + Regenerate every 300 game ticks ~= Regenerate 10 energy per tick ~= 5 WORK part

const configurations = [
    // Когда на старте есть максимум 300 энергии, спавним простого рабочего.
    {"energy": 250, "parts": [WORK, WORK, MOVE]},
    // Когда появились 5 Extension (на 2 уровне контроллера).
    {"energy": 550, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE]},
    // Когда в мнате появляются линки
    {"energy": 700, "parts": [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]},
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

        // На начальном уровне удваиваем количество майнеров.
        const sourcesCount = (room.energyCapacityAvailable < 550)
            ? 2 * room.find(FIND_SOURCES).length
            : room.find(FIND_SOURCES).length;
        const miners = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "miner" && creep.ticksToLive > 150});
        if (miners.length >= sourcesCount) {
            return true;
        }

        const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});
        if (miners.length > charger.length) {
            return true;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Room need Miner, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const name = 'Miner' + Game.time;
        const role = 'miner';
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role }, energyStructures});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если бот лечится
        // if (taskCreep.checkTTL(creep) == OK) return;

        // Двигаемся к контейнеру.
        const container = Game.getObjectById(creep.memory.container_id);
        if (container && !creep.pos.isEqualTo(container)) {
            creep.moveTo(container);
            return;
        }

        // Поднимаем ресурсы из контейнера.
        if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            taskResource.withdrawTarget(creep, container);
        }

        // Передаем ресурсы линку.
        const link = Game.structures[creep.memory.link_id];
        if (link && !creep.store.getFreeCapacity(RESOURCE_ENERGY) && creep.store.getCapacity(RESOURCE_ENERGY) && link.store.getFreeCapacity(RESOURCE_ENERGY)) {
            taskResource.fillTarget(creep, link, RESOURCE_ENERGY);
        }

        // Основная задача:
        // * Добывать ресурсы
        const target = sources.get(creep);
        taskResource.harvestTarget(creep, target);
	}
};


module.exports = roleMiner;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.miner.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.miner.run");
