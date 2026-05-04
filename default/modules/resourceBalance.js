const profiler = require('../screeps-profiler');


// Ensure the factory has at least one decompression batch of batteries (50 = 500 energy).
// Called when the room is under stress so processFactory can run produce(RESOURCE_ENERGY).
function ensureFactoryHasBatteries(room) {
    const factory = room.getFactory();
    if (!factory) return;
    if (factory.store.getUsedCapacity(RESOURCE_BATTERY) >= 50) return;

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

exports.balanceEnergy = function() {
    let veryRichRooms = [];
    let richRooms = [];
    let poorRooms = [];

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) {
            continue
        }
        if (!room.terminal) {
            continue
        }

        // When under attack or critically low on energy, prep the factory to decompress
        // batteries back into energy on the next processFactory tick.
        const underStress = room.hasHostiles
            || room.energyAvailable < room.energyCapacityAvailable * 0.3;
        if (underStress) {
            ensureFactoryHasBatteries(room);
        }

        const energy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        const usedCapacity = room.terminal.store.getUsedCapacity();
        const freeCapacity = room.terminal.store.getFreeCapacity();

        if (room.getStoredEnergy() > 200000) {
            console.log(`[EnergyBalance] Room ${roomName} have a lot of energy (${energy} energy)`)
            veryRichRooms.push(room);
        }

        if (energy < 30000 && freeCapacity > 30000) {
            console.log(`[EnergyBalance] Room ${roomName} need more energy [${energy} energy / ${usedCapacity} all resources]`)
            poorRooms.push(room);
            continue
        }
        if (energy > 50000) {
            console.log(`[EnergyBalance] Room ${roomName} have extra energy [${energy} energy / ${usedCapacity} all resources]`)
            richRooms.push(room);
            continue
        }
    }

    // Send energy from rich room to poor rooms if needed
    for (const richRoom of richRooms) {
        do {
            if (veryRichRooms.includes(richRoom)) {
                // Try to compress energy
                const factory = richRoom.getFactory();
                if (!factory) {
                    break;
                }

                if (factory.store.getUsedCapacity(RESOURCE_BATTERY) > 10000) {
                    richRoom.transfer(RESOURCE_BATTERY, "factory", "storage");
                    break
                }

                if (factory.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
                    break
                }

                if (factory.store.getFreeCapacity() < 20000) {
                    break;
                }
                const terminalUsedCapacity = richRoom.terminal
                    ? richRoom.terminal.store.getUsedCapacity(RESOURCE_ENERGY)
                    : 0;
                const storageUsedCapacity = richRoom.storage
                    ? richRoom.storage.store.getUsedCapacity(RESOURCE_ENERGY)
                    : 0;

                if (storageUsedCapacity > 20000 /** Left extra 20k energy */) {
                    richRoom.transfer(RESOURCE_ENERGY, "storage", "factory", 10000);
                    break
                }
                if (terminalUsedCapacity > 20000 /** Left extra 20k energy */) {
                    richRoom.transfer(RESOURCE_ENERGY, "terminal", "factory", 10000);
                    break
                }
            }
        } while (false);

        // Sort poorest first so the most needy room gets the next available transfer.
        const sortedPoorRooms = poorRooms.slice().sort((a, b) => {
            return a.terminal.store.getUsedCapacity(RESOURCE_ENERGY) - b.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        });
        for (const poorRoom of sortedPoorRooms) {
            // Terminal has 10-tick cooldown after each send - only one send per rich room per tick.
            if (richRoom.terminal.cooldown) break;

            // Left 30k energy in rich room
            const richRoomEnergy = richRoom.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (richRoomEnergy < 30000) {
                break;
            }

            const poorRoomFreeCapacity = poorRoom.terminal.store.getFreeCapacity();
            if (poorRoomFreeCapacity < 60000) {
                continue
            }

            const transferAmount = Math.min(richRoomEnergy - 30000, 30000);

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
        // - Decompression (battery -> energy) is preferred when the room is under
        //   stress: enemies present, or available energy critically low.
        // - Compression (energy -> battery) requires 600 energy in the factory and
        //   stops when the terminal already has enough batteries stockpiled.
        do {
            const factoryEnergy  = factory.store.getUsedCapacity(RESOURCE_ENERGY);
            const factoryBattery = factory.store.getUsedCapacity(RESOURCE_BATTERY);

            const underStress = room.hasHostiles
                || room.energyAvailable < room.energyCapacityAvailable * 0.3;

            // Decompress: 50 batteries -> 500 energy.
            if (underStress && factoryBattery >= 50) {
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
