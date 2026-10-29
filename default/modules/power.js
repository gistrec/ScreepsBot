const profiler = require('../screeps-profiler');
const utils = require('../utils');
const taskResource = require('../tasks/resource');
const settings = require('../settings');

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
        if (settings.get(room, 'power_disabled')) continue;

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
        const used = usedPowerLevels();
        console.log(`[POWER] GPL=${Game.gpl.level} (progress ${Game.gpl.progress}/${Game.gpl.progressTotal}), used ${used} levels.`);
    }
}

// Занятые GPL-уровни, как их считает движок (game/power-creeps.js calcFreePowerLevels):
// 1 за сам факт создания каждого PC + его уровень. Одна сумма уровней занижает на число PC.
function usedPowerLevels() {
    return _.size(Game.powerCreeps) + _.sum(Game.powerCreeps, pc => pc.level);
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
            console.log(`[${roomName}][POWER] pc.spawn failed: ${result} ${result.toStringStatus()}`);
        }
    }
}

// Поэтапный upgrade операторов: GENERATE_OPS до уровня 2. Ступень 1 -> 2 требует level 2, поэтому
// одна ступень-наполнитель OPERATE_SPAWN (бот её не применяет). GENERATE_OPS 3 требует level 7 -
// ещё 4 чужих ступени, не окупается. Итого 4 GPL на оператора (1 за создание + 3); свободные
// уровни расходуются автоматически - второго PC создавать до того, как этот доберёт свои.
const UPGRADE_PRIORITY = [
    [PWR_GENERATE_OPS,  2],
    [PWR_OPERATE_SPAWN, 1],
];
function upgradeOperators() {
    if (!Memory.operators) return;

    if (Game.gpl.level - usedPowerLevels() < 1) return;

    for (const roomName in Memory.operators) {
        const pc = Game.powerCreeps[Memory.operators[roomName].name];
        if (!pc) continue;
        for (const [pwr, targetLevel] of UPGRADE_PRIORITY) {
            const have = (pc.powers[pwr] && pc.powers[pwr].level) || 0;
            if (have >= targetLevel) continue;
            // Ступень силы требует уровень PC (POWER_INFO[pwr].level = [0, 2, 7, 14, 22]): GENERATE_OPS
            // 1 -> 2 хочет level >= 2, а свежий оператор - level 1. Не прерываем цикл, а берём
            // следующую силу из списка - она и поднимет уровень (иначе ERR_FULL и стоп навсегда).
            if (pc.level < POWER_INFO[pwr].level[have]) continue;
            const result = pc.upgrade(pwr);
            if (result === OK) {
                console.log(`[${roomName}][POWER] Upgraded ${pc.name}: ${pwr} ${have} -> ${have + 1}.`);
                return;  // 1 upgrade per cycle.
            }
            console.log(`[${roomName}][POWER] pc.upgrade(${pwr}) failed: ${result} ${result.toStringStatus()}`);
        }
    }
}

exports.process = profiler.registerFN(exports.process, "power.process");
