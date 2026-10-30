const profiler = require('../screeps-profiler');
const utils = require('../utils');
const taskResource = require('../tasks/resource');
const settings = require('../settings');
const log = require('../log');

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

// Считаем сколько каждого минерала нужно для буста тел squad ([{body, boosts}]) суммарно, и
// проверяем что они есть в storage+terminal home-комнаты. Если чего-то не хватает - закупаем
// через market.deal (один deal на терминал за тик, см. buyMineralForBoost - остальное докупится
// в следующих проходах). На allocate считаем атакера и хилера вместе: XLHO2 нужен обоим
// (300 + 750), а по отдельности при запасе 750 оба проходили проверку, спавнились, и один
// boost_force ждал у лабы минерал до смерти по TTL.
// Возвращает true только когда все минералы доступны прямо сейчас (можно спавнить и
// boost task их дозальёт через чарджера). Иначе false - tryAllocateSquad повторит позже.
function ensureBoostMinerals(home, squad) {
    const need = {};
    for (const {body, boosts} of squad) {
        for (const resource of boosts) {
            const partType = _.findKey(BOOSTS, b => b[resource]);
            if (!partType) {
                log.error('powerBank:bad-boost', `[powerBank] Unknown boost resource ${resource}.`);
                return false;
            }
            need[resource] = (need[resource] || 0) + body.filter(p => p === partType).length * LAB_BOOST_MINERAL;
        }
    }
    // Всё или ничего по месту в терминале: buyMineralForBoost не покупает частями, и если
    // суммарная нехватка не влезает, первый минерал купился бы, а второй не влез бы никогда -
    // allocate висит, купленное лежит мёртвым грузом. Ждём места (pending слот не занимает).
    if (home.terminal) {
        let shortfall = 0;
        for (const resource in need) {
            const have = home.terminal.store.getUsedCapacity(resource)
                       + (home.storage ? home.storage.store.getUsedCapacity(resource) : 0);
            shortfall += Math.max(0, need[resource] - have);
        }
        if (shortfall > home.terminal.store.getFreeCapacity()) {
            log.warn(`boost-buy:squad-terminal:${home.name}`, `[${home.name}][Boost-Buy] Terminal can't fit ${shortfall} boost minerals for squad.`);
            return false;
        }
    }
    let allReady = true;
    for (const resource in need) {
        if (need[resource] === 0) continue;
        if (!taskResource.buyMineralForBoost(home, resource, need[resource])) {
            allReady = false;
        }
    }
    return allReady;
}

exports.process = function() {
    if (settings.get(null, 'power_bank_disabled')) return;
    if (!Memory.power_banks) return;
    if (Game.time % 10 !== 0) return;

    const maxActive = settings.get(null, 'power_bank_max_active');
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
            // Детект смерти банка. Уничтоженный объект Game.getObjectById не возвращает (движок
            // убирает его из roomObjects в structures/_destroy.js), так что старое `hits === 0`
            // было недостижимо, и переход в 'looting' делал только observer на скане (до ~21+10
            // тиков). Критерий: комната видна (наш сквад там), а объекта нет. Убит или decay'нулся -
            // различаем по луту: от убитого остаётся ruin с power (RUIN_DECAY_STRUCTURES.powerBank
            // = 10 тиков), потом drop; после decay - ничего, carrier'ов не шлём.
            const room = Game.rooms[bank.roomName];
            if (room && !Game.getObjectById(bank.id)) {
                bank.status = hasLootInRoom(room) ? 'looting' : 'done';
                log.info('powerBank:gone', `[powerBank] Bank ${bankId} gone -> ${bank.status}.`);
                if (bank.status === 'looting') {
                    bank.lootSeenAt = Game.time;
                    spawnCarriers(bank);
                }
                continue;
            }

            // Если все creeps squad'а мертвы - реабилитируем как pending.
            const squadAlive = (bank.squad || []).some(name => Game.creeps[name]);
            if (!squadAlive) {
                // Squad полностью wiped - даём шанс заспавнить новых.
                log.warn('powerBank:squad-lost', `[powerBank] Squad lost for ${bankId}, reverting to pending.`);
                bank.status = 'pending';
                bank.squad = [];
                delete bank.home_room;
            } else {
                // Хилер ещё не заспавнен (энергия/минералы/спавн) или погиб. Атакер без него не
                // бьёт (roles/powerBankAttacker), так что держим пару, пока жив атакер; если
                // хилера уже не будет - атакер переходит в solo (см. trySpawnHealer).
                trySpawnHealer(bank);
            }

        } else if (bank.status === 'looting') {
            const room = Game.rooms[bank.roomName];
            if (room) {
                // Комната видна (carrier'ы там): лут есть - доспавниваем замену погибшим
                // (spawnCarriers идемпотентен); лута нет и никто не везёт - done.
                if (hasLootInRoom(room)) {
                    bank.lootSeenAt = Game.time;
                    spawnCarriers(bank);
                } else if (!carriersCarrying(bank)) {
                    bank.status = 'done';
                    log.info('powerBank:looted', `[powerBank] Bank ${bankId} fully looted.`);
                }
            } else if (!(bank.carriers || []).some(name => Game.creeps[name])) {
                // Комната не видна и живых carrier'ов нет: первая волна (путь stealing→looting -
                // observer перевёл статус, лут подтверждён на скане) или все погибли по дороге.
                // Шлём вслепую; если лута уже нет, observer переведёт в done на ближайшем скане.
                // Пока хоть один жив (везёт домой / едет) - не спавним: замену даём только по
                // подтверждённому луту выше, иначе ехали бы пустые рейсы.
                spawnCarriers(bank);
            }
        }
    }
};

// Лежит ли power в комнате: drop, ruin банка или tombstone погибшего carrier'а (движок переносит
// store в tombstone, creeps/_die.js; на землю высыпется через 5 тиков на часть). Нужна видимость.
// Общий критерий для attacking|stealing→looting|done и для замены carrier'ов - здесь и в observer.
function hasLootInRoom(room) {
    if (room.find(FIND_DROPPED_RESOURCES, {filter: r => r.resourceType === RESOURCE_POWER}).length > 0) return true;
    const withPower = r => r.store && r.store.getUsedCapacity(RESOURCE_POWER) > 0;
    return room.find(FIND_RUINS, {filter: withPower}).length > 0
        || room.find(FIND_TOMBSTONES, {filter: withPower}).length > 0;
}
exports.hasLootInRoom = hasLootInRoom;

// Везёт ли кто-то из carrier'ов power (операция ещё не завершена, но замену спавнить не надо).
function carriersCarrying(bank) {
    return (bank.carriers || []).some(name => {
        const c = Game.creeps[name];
        return c && c.store.getUsedCapacity(RESOURCE_POWER) > 0;
    });
}
exports.carriersCarrying = carriersCarrying;

// Ручной override home-комнаты для конкретной target-room (настройка
// power_bank_home_for_room = { 'W10S40': 'W9S39' }). Если задан, проверяем
// тот же filter и route maxDistance что и для auto-pick - override не обходит базовые
// требования (энергия/спавн/проходимость), иначе спавн фейлится каждый тик.
function pickHome(bank, opts) {
    const homeMap = settings.get(null, 'power_bank_home_for_room');
    const override = homeMap ? homeMap[bank.roomName] : undefined;
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
    const minAmount       = settings.get(null, 'power_bank_min_amount');
    const maxDistance     = settings.get(null, 'power_bank_max_distance');
    const minDecayBuffer  = settings.get(null, 'power_bank_min_decay_buffer');

    if (bank.amount < minAmount) return false;
    if (bank.decayAt - Game.time < minDecayBuffer) return false;

    const home = pickHome(bank, {
        filter: r =>
            r.controller.level >= 8
            && r.energyCapacityAvailable >= bodyCost(HEALER_BODY)
            && !!utils.findFreeSpawn(r, {primaryOnly: false, requireActive: false}),
        maxDistance,
    });
    if (!home) return false;

    if (home.energyAvailable < bodyCost(ATTACKER_BODY)) {
        utils.recordModuleSpawnNeed(home, 'powerBankAttacker', bodyCost(ATTACKER_BODY));
        return false;
    }

    // Без T3 буста 20 ATTACK не успевают пробить банк - закупаем минералы (или ждём
    // пока market.deal/cooldown'ы разрешат докупить). Squad allocate откладываем.
    if (!ensureBoostMinerals(home, [{body: ATTACKER_BODY, boosts: ATTACKER_BOOSTS}, {body: HEALER_BODY, boosts: HEALER_BOOSTS}])) return false;

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
        log.error(`powerBank:spawn-attacker:${r}`, `[powerBank] spawnCreep attacker failed: ${r} ${r.toStringStatus()}`);
        return false;
    }

    bank.status = 'attacking';
    bank.squad = [attackerName, healerName];
    bank.home_room = home.name;
    log.info('powerBank:allocated', `[powerBank] Allocated squad for ${bank.id} from ${home.name}: ${attackerName} + ${healerName}.`);
    return true;
}

// Хилер к живому атакеру: первый спавн (сразу после атакера энергии на 7500 обычно нет) и
// респавн после гибели. Game.creeps[name] есть и у спавнящегося крипа, так что отдельный флаг
// "healerNeeded" не нужен; имя погибшего свободно - спавним под тем же, memory перезаписывается.
// TTL атакера идёт с рождения (ageTime, creeps/tick.js), и хилер до него доедет через спавн 150 +
// буст ~100 + дорога ≤200 тиков - ниже 800 TTL он придёт к атакеру, которому на бой осталось
// меньше нескольких сотен тиков (2M HP / 2400 = ~830), т.е. 7500 энергии + XLHO2 впустую.
const HEALER_MIN_ATTACKER_TTL = 800;

function trySpawnHealer(bank) {
    const [attackerName, healerName] = bank.squad;
    if (Game.creeps[healerName]) return;
    const attacker = Game.creeps[attackerName];
    if (!attacker || attacker.memory.recycling) return;
    if (!attacker.spawning && attacker.ticksToLive < HEALER_MIN_ATTACKER_TTL) {
        // Хилера не будет - атакер не должен ждать его до смерти, держа слот впустую. Solo:
        // бьёт только на полных hits (1 удар в 4 тика, 600 DPS, без риска умереть от отдачи).
        // Урон по банку не восстанавливается - следующему скваду (pending по смерти) меньше.
        if (!attacker.memory.solo) {
            attacker.memory.solo = true;
            log.info('powerBank:solo', `[powerBank] No healer for ${attackerName} (TTL ${attacker.ticksToLive}) - solo.`);
        }
        return;
    }

    const home = Game.rooms[bank.home_room];
    if (!home) return;
    if (home.energyAvailable < bodyCost(HEALER_BODY)) {
        utils.recordModuleSpawnNeed(home, 'powerBankHealer', bodyCost(HEALER_BODY));
        return;
    }
    if (!ensureBoostMinerals(home, [{body: HEALER_BODY, boosts: HEALER_BOOSTS}])) return;

    const spawn = utils.findFreeSpawn(home, {primaryOnly: false, requireActive: false});
    if (!spawn) return;

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
        log.info('powerBank:spawn-healer', `[powerBank] Spawned healer ${healerName}.`);
    }
}

function spawnCarriers(bank) {
    const count = settings.get(null, 'power_bank_carriers_per_kill');
    // Мёртвых (TTL, хостайлы) и фантомов (интент отброшен процессором, см. ниже) из списка
    // убираем: старый guard по длине списка считал их живыми и блокировал респавн до самого
    // decayAt, а запись держала слот power_bank_max_active. Доспавниваем до count живых;
    // ограничитель - looting→done, как только power не осталось (process() и observer).
    bank.carriers = (bank.carriers || []).filter(name => Game.creeps[name]);
    if (bank.carriers.length >= count) return;

    const home = Game.rooms[bank.home_room];
    if (!home) return;

    const tag = bank.id.slice(-4);
    // energyAvailable - снимок начала тика, а процессор списывает энергию по очереди интентов
    // (spawns/_charge-energy.js) и лишние молча отбрасывает - считаем остаток сами, чтобы не
    // записать имя крипа, который не родится.
    let energy = home.energyAvailable;
    for (let i = bank.carriers.length; i < count; i++) {
        const spawn = utils.findFreeSpawn(home, {primaryOnly: false, requireActive: false});
        if (!spawn) break;
        if (energy < bodyCost(CARRIER_BODY)) break;

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
            energy -= bodyCost(CARRIER_BODY);
            log.info('powerBank:spawn-carrier', `[powerBank] Spawned carrier ${name}.`);
        } else {
            log.error(`powerBank:spawn-carrier-fail:${r}`, `[powerBank] spawnCreep carrier failed: ${r} ${r.toStringStatus()}`);
            break;
        }
    }
}

// Контест-флоу: вместо сквада только готовим home_room под будущих carrier'ов.
// Требования к home мягче, чем у attack-сквада: RCL/labs не нужны (без boost'а),
// только энергия на CARRIER_BODY и свободный спавн. Дистанция короче дефолтной
// атаковой (3 vs 4) - carrier'ы без защиты, дальше слишком рискованно.
function tryScheduleSteal(bank) {
    const stealMaxDistance = settings.get(null, 'power_bank_steal_max_distance');
    const home = pickHome(bank, {
        filter: r =>
            r.energyCapacityAvailable >= bodyCost(CARRIER_BODY)
            && !!utils.findFreeSpawn(r, {primaryOnly: false, requireActive: false}),
        maxDistance: stealMaxDistance,
    });
    if (!home) {
        log.info('powerBank:drop', `[powerBank] Bank ${bank.id} contested, no own room within steal range (${stealMaxDistance}) - dropping.`);
        delete Memory.power_banks[bank.id];
        return false;
    }
    bank.home_room = home.name;
    bank.status = 'stealing';
    log.info('powerBank:steal', `[powerBank] Bank ${bank.id} contested, scheduled loot from ${home.name}.`);
    return true;
}

exports.process = profiler.registerFN(exports.process, "powerBank.process");
