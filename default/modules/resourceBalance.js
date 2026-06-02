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

// Все три уровня считаются по ОДНОЙ метрике - getStoredEnergy() (storage+terminal+factory),
// чтобы классы были взаимоисключающими и согласованными. Раньше veryRich считался по
// суммарному запасу, а rich/poor - только по энергии в терминале, из-за чего комната могла
// быть одновременно "очень богатой" и "бедной" (ей слали энергию, хотя склады забиты), а
// veryRich-комната с терминалом 30-50k не попадала в richRooms и никогда не сжимала излишки.
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

        const stored = room.getStoredEnergy();
        const terminalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        const terminalFree = room.terminal.store.getFreeCapacity();

        if (stored > VERY_RICH_STORED_ENERGY) {
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
            return a.getStoredEnergy() - b.getStoredEnergy();
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

exports.balanceMineral = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my || room.controller.level < 7) {
            continue
        }

        const [mineralId, mineralType] = room.getMineral();
        if (!mineralId) {
            continue
        }

        const factory = room.getFactory();
        if (!factory) {
            continue;
        }

        // Get best place to transfer
        const commoditie = COMMODITIES[mineralType];
        const procudedMineralType = Object.keys(commoditie["components"])[0];
        if (factory.store.getUsedCapacity(procudedMineralType) > 10000) {
            room.transfer(procudedMineralType, "factory", "storage");
            continue
        }

        const terminalUsedCapacity = room.terminal
            ? room.terminal.store.getUsedCapacity(mineralType)
            : 0;
        const storageUsedCapacity = room.storage
            ? room.storage.store.getUsedCapacity(mineralType)
            : 0;

        if (terminalUsedCapacity + storageUsedCapacity < 50000) {
            continue
        }

        if (factory.store.getFreeCapacity() < 20000) {
            continue
        }

        // TODO: Find best place
        if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < 2000) {
            room.transfer(RESOURCE_ENERGY, "terminal", "factory", 5000);
            continue
        }

        if (factory.store.getUsedCapacity(mineralType) > 5000) {
            continue
        }

        if (terminalUsedCapacity > 20000 /** Left extra 10k minerals */) {
            console.log(`[MineralBalance] Transfer ${mineralType} from terminal to factory`);
            room.transfer(mineralType, "terminal", "factory", 10000);
            continue
        }
        if (storageUsedCapacity > 20000 /** Left extra 10k minerals */) {
            console.log(`[MineralBalance] Transfer ${mineralType} from storage to factory`);
            room.transfer(mineralType, "storage", "factory", 10000);
            continue
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

        // Charger dispatch isn't gated by factory cooldown - keep the buffer topped up.
        ensureFactoryHasBatteries(room);
        // Перегоняем присланные батарейки из терминала в storage (только для бедных комнат).
        drainTerminalBatteries(room);

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
        // - Decompression (battery -> energy) kicks in while the room is still "poor"
        //   (stored energy below POOR_STORED_ENERGY) so battery reserves - including
        //   ones shipped in from other rooms - are turned back into usable energy.
        // - Compression (energy -> battery) requires 600 energy in the factory and
        //   stops when the terminal already has enough batteries stockpiled.
        do {
            const factoryEnergy  = factory.store.getUsedCapacity(RESOURCE_ENERGY);
            const factoryBattery = factory.store.getUsedCapacity(RESOURCE_BATTERY);

            // Decompress: 50 batteries -> 500 energy.
            if (room.getStoredEnergy() < POOR_STORED_ENERGY && factoryBattery >= 50) {
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
    if (Game.time % 600  == 0) { exports.balanceMineral(); }
}


exports.process = profiler.registerFN(exports.process, "resourceBalance.process");
exports.processFactory = profiler.registerFN(exports.processFactory, "resourceBalance.processFactory");
exports.balanceEnergy = profiler.registerFN(exports.balanceEnergy, "resourceBalance.balanceEnergy");
exports.balanceMineral = profiler.registerFN(exports.balanceMineral, "resourceBalance.balanceMineral");
