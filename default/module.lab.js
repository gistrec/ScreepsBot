// Шаги:
// 1. Получаем T1 минералы в комнатах.
// 2. Вычисляем какие минералы можно забустить.
// 3. Перемещаем минералы в комнату с лабами.
// 4. Перемещаем минетары в лабы.
// 5. Создаем Т2 минерал.
// 6. Перемещаем минералы в хранилище.

const labs = {
    "W9S37": {
        "sources": ["63440992ab176745a40c5ec2", "6343d07c2b2c07264c03585b"],
        "targets": [
            "6343ee8734a4628e41ca248b", "63444cf6be20d6760d95a87c", 
            "6343b6c191a2f44e18eec75e", "63445eef427aeb1854551f6b",
            "6343b17e85f9845110af51c4", "634430cf80f0efd17aff4fde",
            "6343c4b3e49929a158587811", "6343e4e16fb76ec434da414b",
        ],
        "resources": ["H", "O"],
    },
    "W9S39": {
        "sources": ["635e2440d147b7492df830d6", "635e33316a3846049e2fc313"],
        "targets": [
            "635e216cb16ac13d68c83bf4", "635e2b44d0e8e344cf6861ed", 
            "635e1ddbbe2959e3a11fb3bc", "635e2f53fed71fba94ba1f1e",
            "635e29b6cb5f3a2e7e766129", "635e43d54581866082f4ccfa",
            "635e39befed71f32a2ba2274", "635e4c5aade4e148d9fb9fb9",
        ],
        "resources": ["LH", "OH"]
    },
    "W8S36": {
        "sources": ["6356cff6b16ac1e50dc5ee88", "6356bfe05e9c7b4a5a6fde2d"],
        "targets": [
            "6357115b6a3846ac6f2d87e5", "63578426fb83953ef004f7ed", 
            "6356c44b5bcf9d0681031fec", "635742a2cfa540c1c6485667",
            "6356b5104419950918038e5b", "6356e061f2c78209c5fc44e0",
            "635bb7cd6a38464fae2efbde", "635be33aea1f7e61c8ab5a9e",
        ],
        "resources": ["X", "LH2O"]
    }
};
const rooms = {
    "W9S37": {
        "mineral": "H",
        "require": ["O"],
        "produce": "OH",        
    },
    "W9S39": {
        "mineral": "O",
        "require": ["LH", "OH"],
        "produce": "LH2O",
    },
    "W8S36": {
        "mineral": "X",
        "require": ["LH2O"],
        "produce": "XLH2O",
    },
    "W8S38": {
        "mineral": "L",
        "require": [],
    },
};

const runReaction = function(room) {
    if (room.memory.enemy_creeps) return;
    
    const source1 = Game.getObjectById(labs[room.name]["sources"][0]);
    const source2 = Game.getObjectById(labs[room.name]["sources"][1]);
    if (!source1 || !source2) {
        console.log(`[${room.name}] Нет source лаборатории`);
        return;
    }

    for (const lab_id of labs[room.name]["targets"]) try {
        const lab = Game.getObjectById(lab_id);
        if (!lab.id) {
            console.log(`[${room.name}] Нет source лаборатории ${lab_id}`);
            continue;
        }
        lab.runReaction(source1, source2);
        
        // Перемещаем 
        if (lab.store.getUsedCapacity(lab.mineralType) > 2000) {
            const target_id = room.storage ? room.storage.id : room.terminal.id;
            const transfer = {resource_type: lab.mineralType, source_id: lab_id, target_id};
            
            const charger = room.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger" && !c.memory.transfer}).shift();
            if (charger) charger.memory.transfer = transfer;
        }
    } catch (err) { err.log() }
}

const refillLab = function(room) {
    if (room.memory.enemy_creeps) return;

    const source1 = Game.getObjectById(labs[room.name]["sources"][0]);
    const source2 = Game.getObjectById(labs[room.name]["sources"][1]);
    if (!source1 || !source2) {
        console.log(`[${room.name}] Нет source лаборатории`);
        return;
    }
    
    const resource1 = labs[room.name]["resources"][0];
    const resource2 = labs[room.name]["resources"][1];

    if (source1.store.getUsedCapacity(resource1) < 500) {
        // Ищем откуда можно достать ресурсы.
        const warehouse = [room.terminal.id, room.storage.id]
            .map(id => Game.getObjectById(id))
            .filter(warehouse => warehouse.store.getUsedCapacity(resource1) > 500)
            .shift();
        if (warehouse) {
            const transfer = {resource_type: resource1, source_id: warehouse.id, target_id: source1.id};

            const charger = room.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger" && !c.memory.transfer}).shift();
            if (charger) charger.memory.transfer = transfer;
        }
    }
    if (source2.store.getUsedCapacity(resource2) < 500) {
        // Ищем откуда можно достать ресурсы.
        const warehouse = [room.terminal.id, room.storage.id]
            .map(id => Game.getObjectById(id))
            .filter(warehouse => warehouse.store.getUsedCapacity(resource2) > 500)
            .shift();
        if (warehouse) {
            const transfer = {resource_type: resource2, source_id: warehouse.id, target_id: source2.id};
            
            const charger = room.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger" && !c.memory.transfer}).shift();
            if (charger) charger.memory.transfer = transfer;
        }
    }
}

// Передаём ресурсы если:
// * В комнате-источнике есть 10к минералов.
// * В комнате-приёмнике нет 10к минералов.
const transferResourcesBetweenRooms = function() {
    const findRoomWithMineral = (mineral) => {
        for (const roomName in rooms) {
            // console.log(`${roomName} -> ${rooms[roomName]["mineral"]} ${rooms[roomName]["produce"]} -> ${mineral}`);
            if (rooms[roomName]["mineral"] == mineral || rooms[roomName]["produce"] == mineral) {
                // Если нет терминала, то комната нас не интересует.
                const room = Game.rooms[roomName];
                if (!room.terminal) continue;

                return room;
            }
        }
        return null;
    }
    
    for (const roomName in rooms) {
        const room = Game.rooms[roomName];
        for (const requireMineral of rooms[roomName]["require"]) {
            // Если нет терминала, то комната не интересует.
            if (!room.terminal) continue;
            
            // Если в комнате больше 5к минералов, то комната не нуждается в минералах.
            const targetRoomMineralCount = [room.terminal, room.storage].reduce((mineralsCount, structure) => {
                return mineralsCount + (structure ? structure.store.getUsedCapacity(requireMineral) : 0)
            }, 0);
            if (targetRoomMineralCount > 5000) continue;
            
            // Ищем комнату, в которой производится необходимый ресурс.
            const sourceRoom = findRoomWithMineral(requireMineral);
            if (!sourceRoom) continue;
            
            // Если в комнате больше 10к минералов, то мы не можем транспортировать из неё минералы.
            const sourceRoomMineralsCount = [sourceRoom.terminal, sourceRoom.storage].reduce((mineralsCount, structure) => {
                return mineralsCount + (structure ? structure.store.getUsedCapacity(requireMineral) : 0)
            }, 0);
            if (sourceRoomMineralsCount < 10000) continue;
            
            // Нужно либо переместить ресурсы из терминала, либо заполнить его из хранилища.
            const sourceTerminalMineralCount = sourceRoom.terminal.store.getUsedCapacity(requireMineral);
            if (sourceTerminalMineralCount > 10000) {
                console.log(`[Module lab] Send 10k ${requireMineral} from ${sourceRoom.name} to ${roomName}`);
                sourceRoom.terminal.send(requireMineral, 10000, roomName)
            } else {
                console.log(`[Module lab] Transfer 10k ${requireMineral} in ${sourceRoom.name} from Storage to Terminal`);
                
                const transfer = {resource_type: requireMineral, source_id: sourceRoom.storage.id, target_id: sourceRoom.terminal.id, max_resource_count_in_target: 10000};
                
                const charger = sourceRoom.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger" && !c.memory.transfer}).shift();
                if (charger) charger.memory.transfer = transfer;
            }
        }
    }
}

exports.process = function() {
    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        // Обрабатываем только комнаты с лабами.
        if (!labs[roomName]) continue;
        
        if (Game.time % 5 === 0) {
            runReaction(room);
        }
        if (Game.time % 500 === 0) {
            refillLab(room);
        }
    } catch (err) { err.log() }
    
    if (Game.time % 300 == 0) try {
        transferResourcesBetweenRooms();
    } catch (err) { err.log() }
}