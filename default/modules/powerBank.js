const profiler = require('../screeps-profiler');
const utils = require('../utils');
const taskResource = require('../tasks/resource');

// Squad-coordinator. State machine `Memory.power_banks[bankId].status`:
//   'pending'   -> bank just discovered by observer; squad not yet sent
//   'attacking' -> attacker+healer enroute or fighting
//   'looting'   -> bank dead, carriers picking up dropped power
//   'done'      -> empty room, observer cleanup will drop the entry
//
// Тактика: 1 attacker + 1 healer на банк, после смерти - N carrier'ов.
// Concurrency: max 1 active (attacking|looting) операция, регулируется memory.

// Порядок частей: урон идёт с начала массива, поэтому MOVE-щит впереди
// (просадит скорость, но не DPS), ATTACK в середине, HEAL в конце - self-heal
// доживает до последнего.
const ATTACKER_BODY = [].concat(
    Array(20).fill(MOVE), Array(20).fill(ATTACK), Array(10).fill(HEAL),
);
const HEALER_BODY = [].concat(
    Array(25).fill(HEAL), Array(25).fill(MOVE),
);
const CARRIER_BODY = [].concat(
    Array(25).fill(CARRY), Array(25).fill(MOVE),
);

// T3-бусты для ATTACK/HEAL: x4 урон / x4 хил. Без них 20 ATTACK не пробивают банк
// до его decay (LAB_BOOST_MINERAL=30 на парт, см. ensureBoostMinerals).
const ATTACKER_BOOSTS = ['XUH2O', 'XLHO2'];
const HEALER_BOOSTS   = ['XLHO2'];

// Локальный alias для краткости в матчах ниже.
const bodyCost = utils.bodyCost;

// Считаем сколько каждого минерала нужно для буста тела body, и проверяем что они есть
// в storage+terminal home-комнаты. Если чего-то не хватает - закупаем через market.deal.
// Возвращает true только когда все минералы доступны прямо сейчас (можно спавнить и
// boost task их дозальёт через чарджера). Иначе false - tryAllocateSquad повторит позже.
function ensureBoostMinerals(home, body, boosts) {
    let allReady = true;
    for (const resource of boosts) {
        const partType = _.findKey(BOOSTS, b => b[resource]);
        if (!partType) {
            console.log(`[powerBank] Unknown boost resource ${resource}.`);
            allReady = false;
            continue;
        }
        const partsCount = body.filter(p => p === partType).length;
        if (partsCount === 0) continue;
        const need = partsCount * LAB_BOOST_MINERAL;
        if (!taskResource.buyMineralForBoost(home, resource, need)) {
            allReady = false;
        }
    }
    return allReady;
}

exports.process = function() {
    if (!Memory.power_banks) return;
    if (Game.time % 10 !== 0) return;

    const maxActive = Memory.power_bank_max_active || 1;
    let activeCount = _.filter(Memory.power_banks,
        b => b.status === 'attacking' || b.status === 'looting'
    ).length;

    for (const bankId in Memory.power_banks) {
        const bank = Memory.power_banks[bankId];

        if (bank.status === 'pending') {
            if (bank.contested) {
                // Контест: банк бьёт другой игрок. Свой сквад не шлём - воровать дешевле
                // и безопаснее. Готовим home_room для будущих carrier'ов; реальный спавн -
                // когда observer переведёт запись в 'looting' (см. spawnCarriers ниже).
                if (tryScheduleSteal(bank)) {
                    // Stealing не занимает active слот - там нет attacker/healer, только
                    // carrier'ы, и они независимы от power_bank_max_active.
                }
                continue;
            }
            if (activeCount >= maxActive) continue;
            // tryAllocateSquad возвращает true при успехе - инкрементим локальный счётчик,
            // иначе при нескольких pending банках в одном проходе все получили бы сквад.
            if (tryAllocateSquad(bank)) activeCount++;

        } else if (bank.status === 'stealing') {
            // Ждём пока observer переведёт в 'looting' при исчезновении банка из комнаты.
            // Если банк просто decay'нется без убийства - cleanup ниже (decayAt < Game.time)
            // или общий 100-тиковый sweep удалит запись и carrier'ов мы не пошлём.

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
            // spawnCarriers идемпотентен - страховка для пути stealing→looting (observer
            // переводит статус, но carrier'ов не спавнит) и для случая если attacking→looting
            // переход в observer'e (банк убили на скане, process() детект не успел).
            spawnCarriers(bank);

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

// Ручной override home-комнаты для конкретной target-room (через консоль:
// `Memory.power_bank_home_for_room = { 'W10S40': 'W9S39' }`). Если задан, проверяем
// тот же filter и route maxDistance что и для auto-pick - override не обходит базовые
// требования (энергия/спавн/проходимость), иначе спавн фейлится каждый тик.
function pickHome(bank, opts) {
    const override = (Memory.power_bank_home_for_room || {})[bank.roomName];
    if (override) {
        const home = Game.rooms[override];
        if (!home || !home.controller || !home.controller.my) return null;
        if (opts.filter && !opts.filter(home)) return null;
        if (opts.maxDistance !== undefined) {
            const route = Game.map.findRoute(home.name, bank.roomName);
            if (route === ERR_NO_PATH) return null;
            if (route.length > opts.maxDistance) return null;
        }
        return home;
    }
    return utils.findNearestOwnRoom(bank.roomName, opts);
}

// Возвращает true если сквад заспавнен в этом проходе - вызывающий инкрементит
// activeCount для соблюдения power_bank_max_active при нескольких pending банках.
function tryAllocateSquad(bank) {
    const minAmount = Memory.power_bank_min_amount || 2000;
    const maxDistance = Memory.power_bank_max_distance || 4;

    if (bank.amount < minAmount) return false;
    if (bank.decayAt - Game.time < 4000) return false;

    const home = pickHome(bank, {
        filter: r =>
            r.controller.level >= 8
            && r.energyCapacityAvailable >= bodyCost(HEALER_BODY)
            && !!utils.findFreeSpawn(r, {primaryOnly: false, requireActive: false}),
        maxDistance,
    });
    if (!home) return false;

    if (home.energyAvailable < bodyCost(ATTACKER_BODY)) return false;

    // Без T3 буста 20 ATTACK не успевают пробить банк - закупаем минералы (или ждём
    // пока market.deal/cooldown'ы разрешат докупить). Squad allocate откладываем.
    if (!ensureBoostMinerals(home, ATTACKER_BODY, ATTACKER_BOOSTS)) return false;

    const spawn = utils.findFreeSpawn(home, {primaryOnly: false, requireActive: false});
    const tag = bank.id.slice(-4);
    const attackerName = `Atk_${tag}_${Game.time}`;
    const healerName   = `Hlr_${tag}_${Game.time}`;

    const r = spawn.spawnCreep(ATTACKER_BODY, attackerName, {
        memory: {
            role: 'powerBankAttacker',
            target_bank_id: bank.id,
            home_room: home.name,
            pair: healerName,
            boost_queue: ATTACKER_BOOSTS.slice(),
            boost_force: true,
        }
    });
    if (r !== OK) {
        console.log(`[powerBank] spawnCreep attacker failed: ${r} ${r.toStringStatus()}`);
        return false;
    }

    bank.status = 'attacking';
    bank.squad = [attackerName, healerName];
    bank.home_room = home.name;
    bank.healerNeeded = true;
    console.log(`[powerBank] Allocated squad for ${bank.id} from ${home.name}: ${attackerName} + ${healerName}.`);
    return true;
}

function trySpawnHealer(bank) {
    const home = Game.rooms[bank.home_room];
    if (!home) return;
    if (home.energyAvailable < bodyCost(HEALER_BODY)) return;
    if (!ensureBoostMinerals(home, HEALER_BODY, HEALER_BOOSTS)) return;

    const spawn = utils.findFreeSpawn(home, {primaryOnly: false, requireActive: false});
    if (!spawn) return;

    const [attackerName, healerName] = bank.squad;
    const r = spawn.spawnCreep(HEALER_BODY, healerName, {
        memory: {
            role: 'powerBankHealer',
            target_bank_id: bank.id,
            home_room: home.name,
            pair: attackerName,
            boost_queue: HEALER_BOOSTS.slice(),
            boost_force: true,
        }
    });
    if (r === OK) {
        console.log(`[powerBank] Spawned healer ${healerName}.`);
        delete bank.healerNeeded;
    }
}

function spawnCarriers(bank) {
    // Идемпотентность: для path attacking→looting carrier'ы уже заспавнены до перехода;
    // для path stealing→looting через observer повторно зовётся из 'looting' ветки process().
    if (bank.carriers && bank.carriers.length > 0) return;

    const count = Memory.power_bank_carriers_per_kill || 3;
    const home = Game.rooms[bank.home_room];
    if (!home) return;

    bank.carriers = [];
    const tag = bank.id.slice(-4);
    for (let i = 0; i < count; i++) {
        const spawn = utils.findFreeSpawn(home, {primaryOnly: false, requireActive: false});
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
            console.log(`[powerBank] spawnCreep carrier failed: ${r} ${r.toStringStatus()}`);
            break;
        }
    }
}

// Контест-флоу: вместо сквада только готовим home_room под будущих carrier'ов.
// Требования к home мягче, чем у attack-сквада: RCL/labs не нужны (без boost'а),
// только энергия на CARRIER_BODY и свободный спавн. Дистанция короче дефолтной
// атаковой (3 vs 4) - carrier'ы без защиты, дальше слишком рискованно.
function tryScheduleSteal(bank) {
    const stealMaxDistance = Memory.power_bank_steal_max_distance || 3;
    const home = pickHome(bank, {
        filter: r =>
            r.energyCapacityAvailable >= bodyCost(CARRIER_BODY)
            && !!utils.findFreeSpawn(r, {primaryOnly: false, requireActive: false}),
        maxDistance: stealMaxDistance,
    });
    if (!home) {
        console.log(`[powerBank] Bank ${bank.id} contested, no own room within steal range (${stealMaxDistance}) - dropping.`);
        delete Memory.power_banks[bank.id];
        return false;
    }
    bank.home_room = home.name;
    bank.status = 'stealing';
    console.log(`[powerBank] Bank ${bank.id} contested, scheduled loot from ${home.name}.`);
    return true;
}

exports.process = profiler.registerFN(exports.process, "powerBank.process");
