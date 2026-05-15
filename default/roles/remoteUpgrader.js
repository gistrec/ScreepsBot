const utils = require('../utils');

const sources      = require('../sources');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');


const configurations = [
    {"energy": 1100, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]},
];


MAX_UPGRADERS = 3;

STATUS_IDLE = "idle";
STATUS_BUILDING = "building";


const roleRemoteUpgrader = {
    spawn: function() {
        if (Memory.expansion.status != STATUS_BUILDING) {
            return true;
        }

        const remoteUpgraders = utils.allCreepsByRole('remote_upgrader');
        if (remoteUpgraders.length >= MAX_UPGRADERS) {
            return true;
        }

        const expand = Game.flags['Expand'];
        if (!expand) return true;

        const room = utils.findNearestOwnRoom(expand.pos.roomName, configurations[0].energy);
        if (!room) return true;

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Need RemoteUpgrader, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const spawn = utils.findFreeSpawn(room, {primaryOnly: false});
        if (!spawn) return false;

        const name = 'RemoteUpgrader' + Game.time;
        const role = 'remote_upgrader';
        // Запоминаем target-комнату в памяти крипа: после удаления флага (на детект-тике)
        // нужно продолжать работать в новой комнате до TTL, иначе спавн остаётся пустым -
        // у первого локального миннера config[0] нет CARRY, без RU энергии для чарджера нет.
        const target_room = expand.pos.roomName;
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, target_room }});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        const expand = Game.flags["Expand"];
        // Миграция для крипов, заспавненных до фикса памяти - подхватываем имя комнаты
        // из активного флага.
        if (!creep.memory.target_room && expand) {
            creep.memory.target_room = expand.pos.roomName;
        }
        const targetRoom = creep.memory.target_room;
        if (!targetRoom) {
            // Ни флага, ни памяти - крип не знает куда идти. Suicide чтобы не висел.
            creep.suicide();
            return;
        }

        // Если ещё не в целевой комнате - двигаемся туда. С флагом удобнее (нормальный
        // pathfinding в moveTo), без флага - целимся в центр комнаты как best-effort.
        if (creep.room.name != targetRoom) {
            if (expand) {
                creep.moveTo(expand, {reusePath: 10});
            } else {
                creep.moveTo(new RoomPosition(25, 25, targetRoom), {reusePath: 10});
            }
            return;
        }

        // В целевой комнате. Проверяем не построен ли спавн (детект-тик: снимаем флаг,
        // дальше RU остаётся живым и продолжает заливать спавн до TTL - это важно для
        // bootstrap'а, без этого спавн остаётся почти пустым и первый миннер съедает всё).
        const isTenthSecond = (Game.time % 10 === 0);
        if (expand && isTenthSecond && Memory.expansion.status == STATUS_BUILDING) {
            const spawns = creep.room.find(FIND_MY_SPAWNS);
            if (spawns.length > 0) {
                Memory.expansion.status = STATUS_IDLE;

                console.log(`[${creep.room.name}][EXPANSION] Claiming finished. Spawn was built`);
                console.log(`[${creep.room.name}][EXPANSION] Flag Expand was deleted`);
                expand.remove();
                // Не return - продолжаем работать (harvest/fill spawn) на этом же тике.
            }
        }

        // Проверяем нужно ли получить ресурсы для выполнения основных задач
        taskResource.chechHarvesting(creep);

	    if(creep.memory.harvesting) {
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER]) == OK) return;
            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;

            // if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;

            const target = sources.get(creep);
            if (target.energy && taskResource.harvestTarget(creep, target) == OK) return;

            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
        } else {
            // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepairStructure(creep) == OK) return;
            if (taskStructure.buildClosest(creep) == OK) return;

            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 400) == OK) return;

	        const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER];
            if (taskStructure.startRepairClosestStructs(creep, types) == OK) return;

            taskStructure.upgradeController(creep);
        }
	}
};

module.exports = roleRemoteUpgrader;