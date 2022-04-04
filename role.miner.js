const utils        = require('utils')
const sources      = require('sources');

const taskCreep    = require('task.creep');
const taskResource = require('task.resource');


// 1 WORK part - 2 energy per tick
// 3000 Energy in owned room + Regenerate every 300 game ticks ~= Regenerate 10 energy per tick ~= 5 WORK part

const configurations = [
    // Когда на старте есть максимум 300 энергии, спавним простого рабочего.
    {"energy": 250, "miningPower" : 0.4, "parts": [WORK, WORK, MOVE]},
    // Когда появились 5 Extension (на 2 уровне контроллера).
    {"energy": 550, "miningPower" : 1.0, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE]},
];


const roleMiner = {
    spawn: function(room) {
        const spawns = room.find(FIND_MY_SPAWNS, {filter: (spawn) => !spawn.spawning});
        if (spawns.length == 0) {
            return true;
        }
        
        // На начальном уровне удваиваем количество майнеров.
        const sourcesCount = (room.energyCapacityAvailable < 550)
            ? 2 * room.find(FIND_SOURCES).length
            : room.find(FIND_SOURCES).length;
        const miners = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "miner"});
        if (miners.length >= sourcesCount) {
            return true;
        }

        const charger = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "charger"});
        if (miners.length > charger.length) {
            return true;
        }
        
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Miner, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }
        
        const name = 'Miner' + Game.time;
        const role = 'miner';
        const mining_power = creepConfiguration["miningPower"];
        spawns[0].spawnCreep(creepConfiguration["parts"], name, {memory: { role, mining_power }});
        console.log(`Spawning new ${role} ${name} with ${mining_power} mining power in ${room.name}`);

        return false;
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если бот лечится
        // if (taskCreep.checkTTL(creep) == OK) return;

        if (creep.memory.container_location && !creep.pos.isEqualTo(creep.memory.container_location.roomPosition())) {
            creep.moveTo(creep.memory.container_location.roomPosition());
            return;
        }


        // TODO: Автоматически назначать container_location

        // Основная задача:
        // * Добывать ресурсы
        const target = sources.get(creep);
        taskResource.harvestTarget(creep, target);
	}
};

module.exports = roleMiner;
