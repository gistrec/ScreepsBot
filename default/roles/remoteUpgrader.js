const utils = require('../utils');

const sources      = require('../sources');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');


const configurations = [
    // energy = реальная стоимость тела (6 WORK + 6 CARRY + 13 MOVE = 1550). Раньше стояло 1100:
    // спавн-комната с capacity 1100..1549 проходила фильтр, а spawnCreep молча отказывал.
    {"energy": 1550, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]},
];


MAX_UPGRADERS = 3;

STATUS_IDLE = "idle";
STATUS_BUILDING = "building";


// Спавн-комната для RU: ближайшая к target по эффективной capacity (только активные
// spawn/extension: после downgrade'а energyCapacityAvailable завышена и тело в 1550 не
// собрать). Экспортируется для preflight в claimer.spawn: без такой комнаты клейм бесполезен -
// сайт спавна останется без строителей, а expansion зависнет в BUILDING. Плюс активный спавн:
// комната без него (спавны разрушены, extension'ы живы) проходила бы по capacity и навсегда
// заслоняла бы дальнюю рабочую - findFreeSpawn вернул бы null.
function findSpawnRoom(targetRoomName) {
    return utils.findNearestOwnRoom(targetRoomName, {
        filter: r => utils.getEffectiveEnergyCapacity(r) >= configurations[0].energy
                  && (utils.getMyStructuresByType(r)[STRUCTURE_SPAWN] || []).some(s => s.isActive()),
    });
}


const roleRemoteUpgrader = {
    findSpawnRoom,
    spawn: function() {
        if (Memory.expansion.status != STATUS_BUILDING) {
            return true;
        }

        const expand = Game.flags['Expand'];
        if (!expand) return true;

        // Считаем только RU текущей цели: RU прошлой expansion'ы намеренно живут до TTL в
        // своей комнате и не должны занимать слоты новой.
        const remoteUpgraders = utils.allCreepsByRole('remote_upgrader')
            .filter(c => c.memory.target_room == expand.pos.roomName);
        if (remoteUpgraders.length >= MAX_UPGRADERS) {
            return true;
        }

        const room = findSpawnRoom(expand.pos.roomName);
        if (!room) {
            console.log(`[EXPANSION] No own room with energyCapacity >= ${configurations[0].energy} for remote_upgrader`);
            return true;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Need RemoteUpgrader, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            utils.recordModuleSpawnNeed(room, 'remote_upgrader', creepConfiguration["energy"]);
            return false;
        }

        const spawn = utils.findFreeSpawn(room, {primaryOnly: false});
        if (!spawn) return false;

        const name = 'RemoteUpgrader' + Game.time;
        const role = 'remote_upgrader';
        // Запоминаем target-комнату в памяти крипа: после удаления флага (на детект-тике)
        // нужно продолжать работать в новой комнате до TTL, иначе спавн остаётся пустым -
        // спавн из сайта создаётся с 0 энергии, первые 250 для миннера приносит только RU.
        const target_room = expand.pos.roomName;
        // Результат только логируем: expansion.process возвращаемые значения ролей не читает.
        const result = spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, target_room }});
        if (result === OK) {
            console.log(`[${room.name}] Spawning new ${role} ${name}`);
        } else {
            console.log(`[${room.name}] spawnCreep ${role} failed: ${result} ${result.toStringStatus()}`);
        }

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
        // К флагу - только если он в нашей target-комнате: старый RU в пути к прошлой цели
        // иначе ушёл бы к флагу новой expansion'ы и застрял там (target_room != комната флага).
        if (creep.room.name != targetRoom) {
            if (expand && expand.pos.roomName == targetRoom) {
                creep.moveTo(expand, {reusePath: 30});
            } else {
                creep.moveTo(new RoomPosition(25, 25, targetRoom), {reusePath: 30});
            }
            return;
        }

        // В целевой комнате. Проверяем не построен ли спавн (детект-тик: снимаем флаг,
        // дальше RU остаётся живым и продолжает заливать спавн до TTL - это важно для
        // bootstrap'а, без этого спавн остаётся почти пустым и первый миннер съедает всё).
        // Только если флаг стоит в этой же комнате: RU прошлой expansion'ы (живёт до TTL в
        // своей комнате, где спавн уже есть) иначе снимал бы флаг следующей и гасил её.
        const isTenthSecond = (Game.time % 10 === 0);
        if (expand && isTenthSecond && Memory.expansion.status == STATUS_BUILDING
                && creep.room.name == expand.pos.roomName) {
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
            if (target && target.energy && taskResource.harvestTarget(creep, target) == OK) return;

            // if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
        } else {
            // Сначала спавн и экстеншены: новый спавн строится с 0 энергии (движок), и пока RU
            // достраивал scheme RCL 2-3, первый локальный миннер (250e) ждал сотни тиков - см.
            // комментарий у детект-тика выше. Стройка - когда спавн/экстеншены полны.
            if (taskResource.fillClosestStructure(creep, STRUCTURE_SPAWN)     == OK) return;
            if (taskResource.fillClosestStructure(creep, STRUCTURE_EXTENSION) == OK) return;

            // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepairStructure(creep) == OK) return;
            if (taskStructure.buildClosest(creep) == OK) return;

            if (taskResource.fillClosestStructure(creep, STRUCTURE_TOWER, 400) == OK) return;

	        const types = [STRUCTURE_ROAD, STRUCTURE_CONTAINER];
            if (taskStructure.startRepairClosestStructs(creep, types) == OK) return;

            taskStructure.upgradeController(creep);
        }
	}
};

module.exports = roleRemoteUpgrader;