const profiler = require('../screeps-profiler');


// Maintain a permanent battery buffer in the factory so decompression can start
// immediately when stored energy crashes. Hysteresis: charger is dispatched only
// when the factory drops below 3000 batteries, and tops it back up to 5000.
function ensureFactoryHasBatteries(room) {
    const factory = room.getFactory();
    if (!factory) return;
    if (factory.store.getUsedCapacity(RESOURCE_BATTERY) >= 3000) return;

    const storage = room.storage;
    if (!storage || storage.store.getUsedCapacity(RESOURCE_BATTERY) < 50) return;

    // Skip if a charger is already moving batteries to the factory.
    const alreadyAssigned = room.find(FIND_MY_CREEPS, {filter: c =>
        c.memory.role == 'charger'
            && c.memory.transfer
            && c.memory.transfer.resource_type == RESOURCE_BATTERY
            && c.memory.transfer.target_id == factory.id
    }).length > 0;
    if (alreadyAssigned) return;

    room.transfer(RESOURCE_BATTERY, "storage", "factory", 5000);
}

// rich/poor (донор/получатель) считаются по getTotalEnergy() - сырая энергия + батарейки×10
// (storage+terminal+factory): батарейки разжимаются обратно, поэтому комната на батарейках
// богатая и не должна выпрашивать энергию. veryRich (сжатие излишков) считается по сырой
// энергии getStoredEnergy() - батарейки повторно не сжать. Единая метрика на класс держит
// классы взаимоисключающими: раньше veryRich шёл по сумме, а rich/poor - по терминалу, и
// комната могла быть одновременно "очень богатой" и "бедной".
const POOR_STORED_ENERGY      = 50000;   // ниже - комнате нужна энергия
const RICH_STORED_ENERGY      = 100000;  // выше - комната может делиться
const VERY_RICH_STORED_ENERGY = 200000;  // выше - сжимаем излишки в батарейки

// Транспортные предусловия (терминал - буфер пересылки, а не показатель богатства).
const TERMINAL_DONATE_ENERGY  = 50000;   // донор должен иметь столько энергии в терминале
const TERMINAL_RECEIVE_FREE   = 30000;   // получателю нужно столько свободного места
const TERMINAL_ENERGY_FLOOR   = 30000;   // столько энергии оставляем в терминале донора
const POOR_RECEIVE_FREE       = 60000;   // не шлём, если у получателя меньше места под трансфер
const MAX_TRANSFER_ENERGY     = 30000;   // максимум за одну пересылку

// Батарейки как дешёвый транспорт энергии между комнатами: налог Game.market считается по
// числу единиц ресурса, а батарейка = 10 энергии, поэтому слать батарейки в ~10 раз дешевле,
// чем эквивалент в сырой энергии. Донор стейджит батарейки в терминал (stageBatteriesForExport),
// получатель с фабрикой перегоняет их в storage (drainTerminalBatteries) и разжимает обратно
// в энергию (декомпрессия в processFactory).
const TERMINAL_BATTERY_TARGET = 3000;    // сколько батареек держим в терминале донора под экспорт
const MIN_BATTERY_SEND        = 500;     // не шлём батарейки мелкими порциями
const MAX_BATTERY_SEND        = 3000;    // максимум батареек за пересылку (= 30k энергии)

// Два порога декомпрессии (battery -> energy):
// - аварийный: запас энергии рухнул, тратим даже аварийный резерв;
// - "использовать присланное": бедная комната разжимает излишек батареек сверх резерва.
const EMERGENCY_STORED_ENERGY   = 10000; // ниже - аварийная декомпрессия (трогаем резерв)
const BATTERY_EMERGENCY_RESERVE = 5000;  // столько батареек бережём как аварийный резерв

// Подпитка фабрики сырым минералом под компрессию в бары. Дозаправляем по мере расхода
// (гистерезис LOW->REFILL), а не раз в N тиков - иначе фабрика простаивает между дозаправками.
const MINERAL_SURPLUS_THRESHOLD = 50000; // компрессим минерал, только если суммарно его столько (резерв под реакции/бусты не трогаем)
const MINERAL_SOURCE_RESERVE    = 20000; // не берём из источника (terminal/storage), если там меньше
const FACTORY_MINERAL_LOW       = 5000;  // ниже этого минерала в фабрике - дозаправляем
const FACTORY_MINERAL_REFILL    = 10000; // дозаправляем минерал до этого уровня в фабрике
const FACTORY_FREE_FOR_REFILL   = 20000; // нужно столько свободного места в фабрике
const FACTORY_ENERGY_LOW        = 2000;  // ниже этого энергии в фабрике - подаём энергию
const FACTORY_ENERGY_REFILL     = 5000;  // подаём энергию до этого уровня в фабрике
const FACTORY_BAR_EVACUATE      = 10000; // выше этого баров в фабрике - выгружаем в storage

// Сжать излишки энергии в батарейки (storage/terminal -> factory). Не зависит от донорства:
// зовётся для каждой veryRich-комнаты отдельным проходом.
function compressEnergy(room) {
    const factory = room.getFactory();
    if (!factory) return;

    if (factory.store.getUsedCapacity(RESOURCE_BATTERY) > 10000) {
        // Оставляем буфер 5000 батареек в фабрике для быстрой декомпрессии.
        room.transfer(RESOURCE_BATTERY, "factory", "storage", null, 5000);
        return;
    }
    if (factory.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) return;
    if (factory.store.getFreeCapacity() < 20000) return;

    const terminalEnergy = room.terminal ? room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) : 0;
    const storageEnergy  = room.storage  ? room.storage.store.getUsedCapacity(RESOURCE_ENERGY)  : 0;

    if (storageEnergy > 20000 /** Left extra 20k energy */) {
        room.transfer(RESOURCE_ENERGY, "storage", "factory", 10000);
        return;
    }
    if (terminalEnergy > 20000 /** Left extra 20k energy */) {
        room.transfer(RESOURCE_ENERGY, "terminal", "factory", 10000);
        return;
    }
}

// Держим запас батареек в терминале донора, чтобы было что слать в бедные комнаты.
// No-op, если в storage батареек нет (комната их не производит) - тогда донор шлёт сырую энергию.
function stageBatteriesForExport(room) {
    if (!room.terminal || !room.storage) return;
    if (room.terminal.store.getUsedCapacity(RESOURCE_BATTERY) >= TERMINAL_BATTERY_TARGET) return;
    if (room.storage.store.getUsedCapacity(RESOURCE_BATTERY) < 50) return;

    const alreadyAssigned = room.find(FIND_MY_CREEPS, {filter: c =>
        c.memory.role == 'charger'
            && c.memory.transfer
            && c.memory.transfer.resource_type == RESOURCE_BATTERY
            && c.memory.transfer.target_id == room.terminal.id
    }).length > 0;
    if (alreadyAssigned) return;

    room.transfer(RESOURCE_BATTERY, "storage", "terminal", TERMINAL_BATTERY_TARGET);
}

// Присланные из других комнат батарейки оседают в терминале получателя. Бедная комната
// перегоняет их в storage, откуда ensureFactoryHasBatteries поднимет их в фабрику, а
// декомпрессия превратит обратно в энергию. Гейт по stored < POOR, чтобы не сливать
// батарейки, которые донор сам застейджил под экспорт (у донора stored большой).
function drainTerminalBatteries(room) {
    if (!room.terminal || !room.storage) return;
    if (room.getStoredEnergy() >= POOR_STORED_ENERGY) return;
    if (room.terminal.store.getUsedCapacity(RESOURCE_BATTERY) === 0) return;

    const alreadyAssigned = room.find(FIND_MY_CREEPS, {filter: c =>
        c.memory.role == 'charger'
            && c.memory.transfer
            && c.memory.transfer.resource_type == RESOURCE_BATTERY
            && c.memory.transfer.target_id == room.storage.id
    }).length > 0;
    if (alreadyAssigned) return;

    room.transfer(RESOURCE_BATTERY, "terminal", "storage");
}

// Дозаправка фабрики ресурсом до target в фабрике (room.transfer останавливается, когда в
// target набралось max_resource_count_in_target). Не плодим дубли: один charger на ресурс.
function dispatchFactoryRefill(room, resourceType, source, target) {
    const factory = room.getFactory();
    if (!factory) return;

    const alreadyAssigned = room.find(FIND_MY_CREEPS, {filter: c =>
        c.memory.role == 'charger'
            && c.memory.transfer
            && c.memory.transfer.resource_type == resourceType
            && c.memory.transfer.target_id == factory.id
    }).length > 0;
    if (alreadyAssigned) return;

    room.transfer(resourceType, source, "factory", target);
}

// Держим в фабрике запас сырого минерала под компрессию в бары, дозаправляя по мере расхода.
// Компрессим только ИЗЛИШЕК минерала: если суммарный запас мал, минерал нужен лабам/бустам.
function ensureFactoryHasMineral(room) {
    const factory = room.getFactory();
    if (!factory) return;

    const [mineralId, mineralType] = room.getMineral();
    if (!mineralType) return;

    const terminalMineral = room.terminal ? room.terminal.store.getUsedCapacity(mineralType) : 0;
    const storageMineral  = room.storage  ? room.storage.store.getUsedCapacity(mineralType)  : 0;

    if (terminalMineral + storageMineral < MINERAL_SURPLUS_THRESHOLD) return;
    if (factory.store.getFreeCapacity() < FACTORY_FREE_FOR_REFILL) return;

    // Фабрике нужна энергия на компрессию бара.
    if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < FACTORY_ENERGY_LOW) {
        dispatchFactoryRefill(room, RESOURCE_ENERGY, "terminal", FACTORY_ENERGY_REFILL);
        return;
    }

    // Гистерезис: дозаправляем минерал, только когда фабрика просела ниже нижней границы.
    if (factory.store.getUsedCapacity(mineralType) > FACTORY_MINERAL_LOW) return;

    if (terminalMineral > MINERAL_SOURCE_RESERVE) {
        dispatchFactoryRefill(room, mineralType, "terminal", FACTORY_MINERAL_REFILL);
        return;
    }
    if (storageMineral > MINERAL_SOURCE_RESERVE) {
        dispatchFactoryRefill(room, mineralType, "storage", FACTORY_MINERAL_REFILL);
        return;
    }
}

// Выгружаем накопленные бары из фабрики в storage, чтобы освободить место под минерал.
function evacuateFactoryBars(room) {
    const factory = room.getFactory();
    if (!factory) return;

    const [mineralId, mineralType] = room.getMineral();
    if (!mineralType) return;

    const commoditie = COMMODITIES[mineralType];
    if (!commoditie) return;

    const producedMineralType = Object.keys(commoditie["components"])[0];
    if (factory.store.getUsedCapacity(producedMineralType) <= FACTORY_BAR_EVACUATE) return;

    const alreadyAssigned = room.find(FIND_MY_CREEPS, {filter: c =>
        c.memory.role == 'charger'
            && c.memory.transfer
            && c.memory.transfer.resource_type == producedMineralType
            && c.memory.transfer.source_id == factory.id
    }).length > 0;
    if (alreadyAssigned) return;

    room.transfer(producedMineralType, "factory", "storage");
}

exports.balanceEnergy = function() {
    const veryRichRooms = [];
    const richRooms = [];
    const poorRooms = [];

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) {
            continue
        }
        if (!room.terminal) {
            continue
        }

        // Богатство для донор/получатель считаем с батарейками (их можно разжать/переслать),
        // а сжатие излишков (veryRich) - только по сырой энергии: батарейки повторно не сжать.
        const storedRaw = room.getStoredEnergy();
        const stored = room.getTotalEnergy();
        const terminalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        const terminalFree = room.terminal.store.getFreeCapacity();

        if (storedRaw > VERY_RICH_STORED_ENERGY) {
            veryRichRooms.push(room);
        }

        if (stored > RICH_STORED_ENERGY && terminalEnergy > TERMINAL_DONATE_ENERGY) {
            console.log(`[EnergyBalance] Room ${roomName} can share energy [stored ${stored} / terminal ${terminalEnergy}]`)
            richRooms.push(room);
        } else if (stored < POOR_STORED_ENERGY && terminalFree > TERMINAL_RECEIVE_FREE) {
            console.log(`[EnergyBalance] Room ${roomName} need more energy [stored ${stored} / terminal ${terminalEnergy}]`)
            poorRooms.push(room);
        }
    }

    // Сжимаем излишки независимо от донорства.
    for (const room of veryRichRooms) {
        compressEnergy(room);
    }

    // Шлём энергию из богатых комнат самым нуждающимся.
    for (const richRoom of richRooms) {
        // Подкладываем батарейки в терминал, чтобы было чем дёшево делиться.
        stageBatteriesForExport(richRoom);

        // Беднейшие (по суммарному запасу) первыми.
        const sortedPoorRooms = poorRooms.slice().sort((a, b) => {
            return a.getTotalEnergy() - b.getTotalEnergy();
        });
        for (const poorRoom of sortedPoorRooms) {
            // Terminal has 10-tick cooldown after each send - only one send per rich room per tick.
            if (richRoom.terminal.cooldown) break;

            if (poorRoom.terminal.store.getFreeCapacity() < POOR_RECEIVE_FREE) {
                continue
            }

            // Дешёвый путь: шлём батарейки, если у получателя есть фабрика для декомпрессии.
            const donorBatteries = richRoom.terminal.store.getUsedCapacity(RESOURCE_BATTERY);
            if (poorRoom.getFactory() && donorBatteries >= MIN_BATTERY_SEND) {
                const amount = Math.min(donorBatteries, MAX_BATTERY_SEND);
                if (richRoom.terminal.send(RESOURCE_BATTERY, amount, poorRoom.name) == OK) {
                    console.log(`[EnergyBalance] Sent ${amount} batteries (~${amount * 10} energy) ${richRoom.name} -> ${poorRoom.name}`);
                    break;
                }
            }

            // Fallback: сырая энергия (получатель без фабрики или у донора нет батареек).
            const richRoomEnergy = richRoom.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (richRoomEnergy < TERMINAL_ENERGY_FLOOR) {
                break;
            }

            const transferAmount = Math.min(richRoomEnergy - TERMINAL_ENERGY_FLOOR, MAX_TRANSFER_ENERGY);
            if (transferAmount <= 0) {
                break;
            }

            if (richRoom.sendEnergy(poorRoom.name, transferAmount) == OK) {
                break;
            }
        }
    }
}

exports.processFactory = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my || room.controller.level < 7) {
            continue
        }

        const factory = room.getFactory();
        if (!factory) {
            continue;
        }

        // Charger dispatch isn't gated by factory cooldown - keep the buffers topped up.
        ensureFactoryHasBatteries(room);
        // Перегоняем присланные батарейки из терминала в storage (только для бедных комнат).
        drainTerminalBatteries(room);
        // Подпитываем фабрику минералом по мере расхода и выгружаем готовые бары.
        ensureFactoryHasMineral(room);
        evacuateFactoryBars(room);

        if (factory.cooldown) {
            continue
        }

        // Process minerals
        do {
            const [mineralId, mineralType] = room.getMineral();
            if (!mineralId) {
                break
            }

            const commoditie = COMMODITIES[mineralType];
            const consumptionMineralAmount = commoditie["amount"];

            if (factory.store.getUsedCapacity(mineralType) >= consumptionMineralAmount) {
                const procudedMineralType = Object.keys(commoditie["components"])[0];
                factory.produce(procudedMineralType)
            }
        } while (false);

        // Process energy <-> battery in the factory itself.
        // - Decompression (battery -> energy) has two triggers: an emergency one that
        //   taps the protected reserve when stored energy crashes, and a "use shipped
        //   surplus" one that lets a poor room burn batteries above the reserve (e.g.
        //   ones shipped in from other rooms) back into usable energy.
        // - Compression (energy -> battery) requires 600 energy in the factory and
        //   stops when the terminal already has enough batteries stockpiled.
        do {
            const factoryEnergy  = factory.store.getUsedCapacity(RESOURCE_ENERGY);
            const factoryBattery = factory.store.getUsedCapacity(RESOURCE_BATTERY);
            const storageBattery = room.storage ? room.storage.store.getUsedCapacity(RESOURCE_BATTERY) : 0;
            const stored = room.getStoredEnergy();

            // Decompress (emergency): 50 batteries -> 500 energy, даже из аварийного резерва.
            if (stored < EMERGENCY_STORED_ENERGY && factoryBattery >= 50) {
                factory.produce(RESOURCE_ENERGY);
                break;
            }

            // Decompress (use shipped surplus): только излишек сверх резерва. ensureFactoryHasBatteries
            // подпитывает фабрику из storage, поэтому считаем суммарно factory+storage и стопаем,
            // когда суммарно остаётся ровно аварийный резерв.
            if (stored < POOR_STORED_ENERGY
                    && factoryBattery + storageBattery > BATTERY_EMERGENCY_RESERVE
                    && factoryBattery >= 50) {
                factory.produce(RESOURCE_ENERGY);
                break;
            }

            // Compress: 600 energy -> 50 batteries.
            if (factoryEnergy < 600) break;

            const terminalBattery = room.terminal
                ? room.terminal.store.getUsedCapacity(RESOURCE_BATTERY)
                : 0;
            if (terminalBattery >= 10000) break;

            factory.produce(RESOURCE_BATTERY);
        } while (false);
    }
}


exports.process = function() {
    if (Game.time % 10   == 0) { exports.processFactory(); }
    if (Game.time % 100  == 0) { exports.balanceEnergy();  }
}

// Классификация по запасу энергии - та же метрика, что в balanceEnergy (донор/получатель).
// Считаем батарейки×10 (getTotalEnergy): они разжимаются обратно в энергию, поэтому комната
// на батарейках по факту богатая. Используется визуализацией для иконки богатая/бедная.
exports.classifyEnergy = function(room) {
    // Без терминала комната не участвует в обмене (как и в balanceEnergy) - ни донор, ни
    // получатель, поэтому ни rich, ни poor.
    if (!room.terminal) return 'neutral';

    const stored = room.getTotalEnergy();
    if (stored > RICH_STORED_ENERGY) return 'rich';
    if (stored < POOR_STORED_ENERGY) return 'poor';
    return 'neutral';
}


exports.process = profiler.registerFN(exports.process, "resourceBalance.process");
exports.processFactory = profiler.registerFN(exports.processFactory, "resourceBalance.processFactory");
exports.balanceEnergy = profiler.registerFN(exports.balanceEnergy, "resourceBalance.balanceEnergy");
