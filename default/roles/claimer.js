const utils = require('../utils');

const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');
const roleRemoteUpgrader = require('./remoteUpgrader');


const configurations = [
    {"energy": 1200, "parts": [CLAIM, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]}
]


STATUS_IDLE = "idle";
STATUS_CLAIMING = "claiming";
STATUS_BUILDING = "building";


const roleClaimer = {
    spawn: function() {
        if (Memory.expansion.status !== STATUS_CLAIMING) {
            return true;
        }

        const claimers = utils.allCreepsByRole('claimer');
        if (claimers.length !== 0) {
            return true;
        }

        const expand = Game.flags['Expand'];
        if (!expand) return true;

        // Эффективная capacity (только активные spawn/extension): после downgrade'а ближняя
        // комната с завышенной energyCapacityAvailable навсегда заслоняла бы дальнюю рабочую.
        // Плюс активный спавн: комната без него (спавны разрушены, extension'ы живы) проходила
        // бы по capacity, а findFreeSpawn ниже вернул бы null - тоже вечное заслонение.
        const room = utils.findNearestOwnRoom(expand.pos.roomName, {
            filter: r => utils.getEffectiveEnergyCapacity(r) >= configurations[0].energy
                      && (utils.getMyStructuresByType(r)[STRUCTURE_SPAWN] || []).some(s => s.isActive()),
        });
        if (!room) {
            console.log(`[EXPANSION] No own room with energyCapacity >= ${configurations[0].energy} for claimer`);
            return true;
        }
        // Preflight: клеймер (1200) дешевле remoteUpgrader'а (1550). Если RU собрать негде, клейм
        // даст сайт спавна без строителей и expansion зависнет в BUILDING - не начинаем.
        if (!roleRemoteUpgrader.findSpawnRoom(expand.pos.roomName)) {
            console.log(`[EXPANSION] No own room able to spawn remote_upgrader - claimer not spawned, expansion on hold`);
            return true;
        }

        const spawn = utils.findFreeSpawn(room, {primaryOnly: false});
        if (!spawn) {
            return false;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyAvailable) {
            console.log(`[${room.name}] Need Claimer, but not enought energy [${room.energyAvailable}/${creepConfiguration["energy"]}]`)
            utils.recordSpawnNeed(room, 'claimer', creepConfiguration["energy"]);
            return false;
        }

        const name = 'Claimer' + Game.time;
        const role = 'claimer';
        const spawn_room = room.name;
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role, spawn_room }});
        console.log(`[${room.name}] Spawning new ${role} ${name} for ${expand.pos.roomName}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если у крипа нет ресурсов.
        if (creep.room.name == creep.memory.spawn_room && creep.store.getUsedCapacity() != creep.store.getCapacity()) {
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE]) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL]) == OK) return;
            return; // Ждём появления ресурсов
        }

        const expand = Game.flags['Expand']
        if (!expand) {
            console.log('[EXPANSION] Expand flag not found - stop claiming')
            Memory.expansion.status = STATUS_IDLE;

            creep.suicide();
            return;
        }

        // Move to expand room
        if (expand.room != creep.room) {
            creep.moveTo(expand, {reusePath: 10});
            return;
        }

        // Attack or clime controller
        const controller = creep.room.controller;
        if (!controller.my) {
            if (controller.owner) {
                const status = creep.attackController(controller);
                if (status === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller);
                }
                return;
            } else {
                const status = creep.claimController(controller);
                if (status === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller);
                }
                return;
            }
        }

        // Upgrade controller to level 2
        taskStructure.upgradeController(creep);
        if (controller.level >= 2) {
            // В BUILDING переходим только когда сайт спавна реально стоит: без primary спавна
            // build.js ничего не разместит, remoteUpgrader'ы будут ездить впустую, и expansion
            // зависнет в BUILDING. При отказе (стена, exit-зона, занятая клетка, лимит сайтов)
            // остаёмся в CLAIMING и повторяем каждый тик - флаг Expand можно передвинуть.
            // Уже стоящий спавн/сайт засчитываем только primary (имя ровно `{room}`): по чужому
            // имени (авто "Spawn1") build.js anchor не найдёт, а `{room}D`/`{room}E` на RCL 2
            // занимает единственный слот спавна - primary не встанет (ERR_RCL_NOT_ENOUGH), а
            // miner/charger спавнятся только из primary (findFreeSpawn primaryOnly) - bootstrap'а нет.
            const x = expand.pos.x + 2;
            const y = expand.pos.y;
            const roomName = creep.room.name;
            const ownName = s => s.structureType == STRUCTURE_SPAWN && s.name == roomName;
            const hasSpawn = creep.room.find(FIND_MY_SPAWNS, {filter: ownName}).length > 0
                || creep.room.find(FIND_MY_CONSTRUCTION_SITES, {filter: ownName}).length > 0;
            const result = hasSpawn ? OK : creep.room.createConstructionSite(x, y, STRUCTURE_SPAWN, roomName);
            if (result !== OK) {
                if (Game.time % 10 === 0) {
                    console.log(`[${creep.room.name}] createConstructionSite spawn at ${x}:${y} failed: ${result} ${result.toStringStatus()} - move the Expand flag`);
                }
                return;
            }

            Memory.expansion.status = STATUS_BUILDING;
            console.log(`[${creep.room.name}] Claiming complete. Start building`);

            creep.suicide();
        }
	}
};

module.exports = roleClaimer;