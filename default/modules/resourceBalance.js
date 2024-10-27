const profiler = require('../screeps-profiler');


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

        for (const poorRoom of poorRooms) {
            // Left 30k energy in rich room
            const richRoomEnergy = richRoom.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (richRoomEnergy < 30000) {
                continue;
            }

            const poorRoomFreeCapacity = poorRoom.terminal.store.getFreeCapacity();
            if (poorRoomFreeCapacity < 60000) {
                continue
            }

            const transferAmount = Math.min(richRoomEnergy - 30000, 30000);

            richRoom.sendEnergy(poorRoom.name, transferAmount);
            console.log(`[EnergyBalance] Sent ${transferAmount} energy from ${richRoom.name} to ${poorRoom.name}`);
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

        // Process energy
        do {
            const energy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
            if (energy < 5000) {
                break
            }

            const battery = room.terminal.store.getUsedCapacity(RESOURCE_BATTERY);
            if (battery < 10000) {
                factory.produce(RESOURCE_BATTERY);
            }
        } while (false);
    }
}


exports.process = function() {
    if (Game.time % 10   == 0) { exports.processFactory(); }
    if (Game.time % 400  == 0) { exports.balanceEnergy();  }
    if (Game.time % 600  == 0) { exports.balanceMineral(); }
}


exports.process = profiler.registerFN(exports.process, "resourceBalance.process");
exports.processFactory = profiler.registerFN(exports.processFactory, "resourceBalance.processFactory");
exports.balanceEnergy = profiler.registerFN(exports.balanceEnergy, "resourceBalance.balanceEnergy");
exports.balanceMineral = profiler.registerFN(exports.balanceMineral, "resourceBalance.balanceMineral");
