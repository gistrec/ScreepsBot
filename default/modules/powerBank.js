const profiler = require('../screeps-profiler');

// Squad-coordinator. State machine `Memory.power_banks[bankId].status`:
//   'pending'   -> bank just discovered by observer; squad not yet sent
//   'attacking' -> attacker+healer enroute or fighting
//   'looting'   -> bank dead, carriers picking up dropped power
//   'done'      -> empty room, observer cleanup will drop the entry
//
// Тактика: 1 attacker + 1 healer на банк, после смерти - N carrier'ов.
// Concurrency: max 1 active (attacking|looting) операция, регулируется memory.

const ATTACKER_BODY = [].concat(
    Array(20).fill(ATTACK), Array(20).fill(MOVE), Array(10).fill(HEAL),
);
const HEALER_BODY = [].concat(
    Array(25).fill(HEAL), Array(25).fill(MOVE),
);
const CARRIER_BODY = [].concat(
    Array(25).fill(CARRY), Array(25).fill(MOVE),
);

function bodyCost(body) {
    return _.sum(body, p => BODYPART_COST[p]);
}

exports.process = function() {
    if (!Memory.power_banks) return;
    if (Game.time % 10 !== 0) return;

    const maxActive = Memory.power_bank_max_active || 1;
    const activeCount = _.filter(Memory.power_banks,
        b => b.status === 'attacking' || b.status === 'looting'
    ).length;

    for (const bankId in Memory.power_banks) {
        const bank = Memory.power_banks[bankId];

        if (bank.status === 'pending') {
            if (activeCount >= maxActive) continue;
            tryAllocateSquad(bank);

        } else if (bank.status === 'attacking') {
            // Если все creeps squad'а мертвы - реабилитируем как pending или drop.
            const squadAlive = (bank.squad || []).some(name => Game.creeps[name]);

            // Detect kill: банк больше не в комнате банка (после observer scan следующего
            // тика visibility пропадёт; используем Game.getObjectById пока в радиусе наших
            // creeps).
            const bankObj = Game.getObjectById(bank.id);
            if (bankObj && bankObj.hits === 0) {
                bank.status = 'looting';
                console.log(`[powerBank] Bank ${bankId} killed.`);
                spawnCarriers(bank);
                continue;
            }

            if (!squadAlive) {
                // Squad полностью wiped - даём шанс заспавнить новых.
                console.log(`[powerBank] Squad lost for ${bankId}, reverting to pending.`);
                bank.status = 'pending';
                bank.squad = [];
                delete bank.home_room;
                delete bank.healerNeeded;
            } else {
                // Спавним healer'а если его ещё не успели заспавнить.
                if (bank.healerNeeded) trySpawnHealer(bank);
            }

        } else if (bank.status === 'looting') {
            // Карьеры заберут drop. Когда комнату посетим (через carrier'ов) и видим что
            // ни drop ни ruin не остались - выставляем done.
            const room = Game.rooms[bank.roomName];
            if (room) {
                const drops = room.find(FIND_DROPPED_RESOURCES, {filter: r => r.resourceType === RESOURCE_POWER});
                const ruins = room.find(FIND_RUINS, {filter: r => r.store && r.store.getUsedCapacity(RESOURCE_POWER) > 0});
                if (drops.length === 0 && ruins.length === 0) {
                    // Если есть carrier'ы возвращающиеся с грузом - не done пока.
                    const carriersStillCarrying = (bank.carriers || []).some(name => {
                        const c = Game.creeps[name];
                        return c && c.store.getUsedCapacity(RESOURCE_POWER) > 0;
                    });
                    if (!carriersStillCarrying) {
                        bank.status = 'done';
                        console.log(`[powerBank] Bank ${bankId} fully looted.`);
                    }
                }
            }
        }
    }
};

function tryAllocateSquad(bank) {
    const minAmount = Memory.power_bank_min_amount || 2000;
    const maxHits   = Memory.power_bank_max_hits   || 5_000_000;
    const maxDistance = Memory.power_bank_max_distance || 4;

    if (bank.amount < minAmount) return;
    if (bank.hits > maxHits) return;
    if (bank.decayAt - Game.time < 4000) return;

    const candidates = _.filter(Game.rooms, r =>
        r.controller && r.controller.my
        && r.controller.level >= 8
        && r.energyCapacityAvailable >= bodyCost(HEALER_BODY)
        && r.find(FIND_MY_SPAWNS, {filter: s => !s.spawning}).length >= 1
    );
    if (candidates.length === 0) return;

    candidates.sort((a, b) =>
        Game.map.getRoomLinearDistance(a.name, bank.roomName)
      - Game.map.getRoomLinearDistance(b.name, bank.roomName)
    );
    const home = candidates[0];
    if (Game.map.getRoomLinearDistance(home.name, bank.roomName) > maxDistance) return;

    if (home.energyAvailable < bodyCost(ATTACKER_BODY)) return;

    const spawn = home.find(FIND_MY_SPAWNS, {filter: s => !s.spawning})[0];
    const tag = bank.id.slice(-4);
    const attackerName = `Atk_${tag}_${Game.time}`;
    const healerName   = `Hlr_${tag}_${Game.time}`;

    const r = spawn.spawnCreep(ATTACKER_BODY, attackerName, {
        memory: {
            role: 'powerBankAttacker',
            target_bank_id: bank.id,
            home_room: home.name,
            pair: healerName,
        }
    });
    if (r !== OK) {
        console.log(`[powerBank] spawnCreep attacker failed: ${r}`);
        return;
    }

    bank.status = 'attacking';
    bank.squad = [attackerName, healerName];
    bank.home_room = home.name;
    bank.healerNeeded = true;
    console.log(`[powerBank] Allocated squad for ${bank.id} from ${home.name}: ${attackerName} + ${healerName}.`);
}

function trySpawnHealer(bank) {
    const home = Game.rooms[bank.home_room];
    if (!home) return;
    if (home.energyAvailable < bodyCost(HEALER_BODY)) return;

    const spawn = home.find(FIND_MY_SPAWNS, {filter: s => !s.spawning})[0];
    if (!spawn) return;

    const [attackerName, healerName] = bank.squad;
    const r = spawn.spawnCreep(HEALER_BODY, healerName, {
        memory: {
            role: 'powerBankHealer',
            target_bank_id: bank.id,
            home_room: home.name,
            pair: attackerName,
        }
    });
    if (r === OK) {
        console.log(`[powerBank] Spawned healer ${healerName}.`);
        delete bank.healerNeeded;
    }
}

function spawnCarriers(bank) {
    const count = Memory.power_bank_carriers_per_kill || 3;
    const home = Game.rooms[bank.home_room];
    if (!home) return;

    bank.carriers = [];
    const tag = bank.id.slice(-4);
    for (let i = 0; i < count; i++) {
        const spawn = home.find(FIND_MY_SPAWNS, {filter: s => !s.spawning})[0];
        if (!spawn) break;
        if (home.energyAvailable < bodyCost(CARRIER_BODY)) break;

        const name = `Crr_${tag}_${Game.time}_${i}`;
        const r = spawn.spawnCreep(CARRIER_BODY, name, {
            memory: {
                role: 'powerCarrier',
                target_bank_id: bank.id,
                home_room: home.name,
            }
        });
        if (r === OK) {
            bank.carriers.push(name);
            console.log(`[powerBank] Spawned carrier ${name}.`);
        } else {
            console.log(`[powerBank] spawnCreep carrier failed: ${r}`);
            break;
        }
    }
}

exports.process = profiler.registerFN(exports.process, "powerBank.process");
