const profiler = require('../screeps-profiler');
const utils = require('../utils');
const taskResource = require('../tasks/resource');

// Модуль power-цикла. Phase 5+6 из плана:
// - process(): каждый тик вызывает processPower() на power_spawn'ах с топливом.
// - schedulePowerSpawnRefill(room): раз в N тиков шедулит charger transfer POWER -> power_spawn.
// - lifecycle операторов (spawn/upgrade) - заглушка для Phase 6.
//
// Operator-creep run-логика - в roles/operator.js.

exports.process = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;
        if (room.memory.power_disabled) continue;

        const powerSpawns = utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [];
        const ps = powerSpawns[0];
        if (!ps) continue;

        // processPower стоит ENERGY_REGEN_TIME -> не нужно проверять cooldown.
        // Тратит POWER_SPAWN_ENERGY_RATIO (50) energy + 1 power, даёт +1 GPL progress.
        if (ps.store.getUsedCapacity(RESOURCE_ENERGY) >= 50
         && ps.store.getUsedCapacity(RESOURCE_POWER)  >= 1) {
            ps.processPower();
        }

        if (Game.time % 1000 === 0) try {
            taskResource.schedulePowerSpawnPower(room);
        } catch (err) { err.log() }
    }

    // Operator lifecycle (Phase 6).
    if (Game.time % 50 === 0) try { spawnDeadOperators(); } catch (err) { err.log() }
    if (Game.time % 500 === 0) try { upgradeOperators();  } catch (err) { err.log() }

    // Periodic GPL log.
    if (Game.time % 1000 === 0) {
        const used = _.sum(Game.powerCreeps, pc => pc.level);
        console.log(`[POWER] GPL=${Game.gpl.level} (progress ${Game.gpl.progress}/${Game.gpl.progressTotal}), used ${used} levels.`);
    }
}

// Спавнит/респавнит зарегистрированных операторов в power_spawn'ах их комнат.
function spawnDeadOperators() {
    if (!Memory.operators) return;
    for (const roomName in Memory.operators) {
        const entry = Memory.operators[roomName];
        const pc = Game.powerCreeps[entry.name];
        if (!pc) {
            console.log(`[${roomName}][POWER] Operator ${entry.name} not found, removing from registry.`);
            delete Memory.operators[roomName];
            continue;
        }
        if (pc.ticksToLive) continue;  // Уже задеплоен.
        if (pc.spawnCooldownTime && pc.spawnCooldownTime > Date.now()) continue;

        const room = Game.rooms[roomName];
        if (!room) continue;

        const ps = (utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [])[0];
        if (!ps) continue;

        const result = pc.spawn(ps);
        if (result === OK) {
            console.log(`[${roomName}][POWER] Spawned operator ${pc.name}.`);
        } else {
            console.log(`[${roomName}][POWER] pc.spawn failed: ${result}`);
        }
    }
}

// Поэтапный upgrade операторов: GENERATE_OPS до уровня 3, потом полезные дополнительные.
const UPGRADE_PRIORITY = [
    [PWR_GENERATE_OPS,       3],
    [PWR_OPERATE_SPAWN,      1],
    [PWR_OPERATE_TOWER,      1],
    [PWR_GENERATE_SAFE_MODE, 1],
];
function upgradeOperators() {
    if (!Memory.operators) return;

    const used = _.sum(Game.powerCreeps, pc => pc.level);
    if (Game.gpl.level - used < 1) return;

    for (const roomName in Memory.operators) {
        const pc = Game.powerCreeps[Memory.operators[roomName].name];
        if (!pc) continue;
        for (const [pwr, targetLevel] of UPGRADE_PRIORITY) {
            const have = (pc.powers[pwr] && pc.powers[pwr].level) || 0;
            if (have >= targetLevel) continue;
            const result = pc.upgrade(pwr);
            if (result === OK) {
                console.log(`[${roomName}][POWER] Upgraded ${pc.name}: ${pwr} ${have} -> ${have + 1}.`);
                return;  // 1 upgrade per cycle.
            }
            break;  // Cap reached for this power - move on by skipping rest of priorities? Keep simple: break.
        }
    }
}

exports.process = profiler.registerFN(exports.process, "power.process");
