const profiler = require('../screeps-profiler');


const labs = exports.labs = {
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
    },
    "W11S39": {
        "sources": ["637ef06cfed71f7d69c33e81", "636d60de8d866b7128c9d81a"],
        "targets": [
            "637f70f16d7b71520803ab24", "636dcd91046179e3d70e3b99",
            "64a28cc2312d4c7e0e4f160b", "64a351747efcb80fd437e67b",
            "64a29a662658b7bcad52c53b", "64a37ba7ef4e1641cec512db",
            "637f927fd63e3fa426e59614", "636dbfd6d147b7469cfd1844",
        ],
        "resources": ["L", "H"]
    },
    "W12S39": {
        "sources": ["6365f6133f7af3dd0ab2e981", "6378c26da806deb4764d7196"],
        "targets": [
            "6365d7f57a86a4bf42c52835", "6378b1f5bae3d5cea9243183",
            "64a2156cc3ba53316d6b8147", "64a2b926a238fc9366a3e311",
            "64a24eff877ed8332ba6b0b4", "64a35b4646a53b65a3a9acea",
            "636638aacfa5402f794ceca7", "6378d5733a1a4efa6acb5bbe",
        ],
        "resources": ["Z", "H"]
    }
};

const rooms = exports.rooms = {
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
    "W11S39": {
        "mineral": "Z",
        "require": ["L", "H"],
        "produce": "LH",
    },
    "W12S39": {
        "mineral": "Z",
        "require": ["Z", "H"],
        "produce": "ZH",
    },
    "W12S37": {
        "mineral": "H",
        "require": [],
    }
};

// Шаги:
// 1. Получаем T1 минералы в комнатах.
// 2. Вычисляем какие минералы можно забустить.
// 3. Перемещаем минералы в комнату с лабами.
// 4. Перемещаем минетары в лабы.
// 5. Создаем Т2 минерал.
// 6. Перемещаем минералы в хранилище.

// Через сколько тиков непрерывного stuck-состояния включаем force-evac (выгрузку лаб
// несмотря на soft cap'ы). Запоздание защищает от мини-флаппинга когда storage чуть
// освобождается и тут же снова забивается. Override per-room через memory.
const DEFAULT_LAB_STUCK_EVAC_DELAY = 500;

// Насыщение downstream: ресурс считается "ненужным", если у каждого потребителя
// уже >= этого порога в storage+terminal. Для финальных продуктов (без потребителей)
// функция возвращает false - такие копим до локального cap'а.
const DOWNSTREAM_SATURATION_THRESHOLD = 30000;

// Потребитель = комната, которая импортирует ресурс (`rooms[name].require`)
// или использует его как вход локальной лабы (`labs[name].resources`).
// Используется чтобы тормозить экстрактор и реакции когда дальше складывать некуда.
exports.isDownstreamSaturated = function(mineral) {
    let consumers = 0;
    for (const consumerName in rooms) {
        const isImporter = rooms[consumerName]["require"].includes(mineral);
        const labResources = labs[consumerName] ? labs[consumerName]["resources"] : [];
        const isLocalConsumer = labResources.includes(mineral);
        if (!isImporter && !isLocalConsumer) continue;

        const consumer = Game.rooms[consumerName];
        if (!consumer || !consumer.terminal) continue;

        consumers++;
        const stock = consumer.terminal.store.getUsedCapacity(mineral)
                    + (consumer.storage ? consumer.storage.store.getUsedCapacity(mineral) : 0);
        if (stock < DOWNSTREAM_SATURATION_THRESHOLD) return false;
    }
    return consumers > 0;
}

// Снимок состояния лаб для визуализации. Сохраняется в room.memory.lab_status,
// читается из visualization.js. Обновляется на каждый вызов runReaction (раз в 10 тиков).
function updateLabStatus(room, expectedOutput, source1, source2) {
    const targetLabs = labs[room.name]["targets"].map(id => Game.getObjectById(id)).filter(l => l);
    let cooling = 0, runnable = 0, stuck = 0, dirty = 0;
    for (const lab of targetLabs) {
        if (lab.mineralType && expectedOutput && lab.mineralType != expectedOutput) {
            dirty++;
            continue;
        }
        if (lab.cooldown > 0) {
            cooling++;
            continue;
        }
        if (expectedOutput && lab.store.getUsedCapacity(expectedOutput) > LAB_MINERAL_CAPACITY * 0.75) {
            // Лаба заполнена выходным минералом - проверяем, можем ли вылить.
            const terminalHasSpace = room.terminal && room.terminal.store.getUsedCapacity(expectedOutput) < 10000 && room.terminal.store.getFreeCapacity() > 10000;
            const storageHasSpace  = room.storage  && room.storage.store.getUsedCapacity(expectedOutput)  < 100000 && room.storage.store.getFreeCapacity()  > 10000;
            if (!terminalHasSpace && !storageHasSpace) {
                stuck++;
                continue;
            }
        }
        runnable++;
    }
    const sourceLow = source1.store.getUsedCapacity(source1.mineralType) < LAB_REACTION_AMOUNT
                   || source2.store.getUsedCapacity(source2.mineralType) < LAB_REACTION_AMOUNT;

    // Отслеживаем длительность stuck-состояния для force-evac логики.
    if (stuck > 0) {
        if (!room.memory.lab_stuck_since) {
            room.memory.lab_stuck_since = Game.time;
        }
    } else {
        delete room.memory.lab_stuck_since;
    }

    const evacDelay = room.memory.lab_stuck_evac_delay || DEFAULT_LAB_STUCK_EVAC_DELAY;
    const stuckDuration = room.memory.lab_stuck_since ? Game.time - room.memory.lab_stuck_since : 0;
    const forceEvac = stuckDuration >= evacDelay;

    room.memory.lab_status = {
        output: expectedOutput,
        total: targetLabs.length,
        runnable, cooling, stuck, dirty,
        sourceLow,
        forceEvac,
        at: Game.time,
    };
}

// Force-evacuation: дампим все target-labs в terminal/storage игнорируя soft cap'ы.
// Запускается, когда stuck-статус продержался дольше evacDelay - чтобы освободить
// лабы для других задач (boost, смена реакции). Throttle: 1 transfer-task за вызов.
function forceEvacuateLabs(room, expectedOutput) {
    const targetLabs = labs[room.name]["targets"].map(id => Game.getObjectById(id)).filter(l => l);
    for (const lab of targetLabs) {
        if (!lab.mineralType) continue;
        if (lab.store.getUsedCapacity(lab.mineralType) == 0) continue;

        // Дампим куда есть физическое место. Soft cap игнорируем - сама причина force-evac
        // в том, что storage уже выше soft cap, но физического места обычно вагон.
        const dump = (room.terminal && room.terminal.store.getFreeCapacity() > 0)
            ? room.terminal
            : (room.storage && room.storage.store.getFreeCapacity() > 0 ? room.storage : null);
        if (!dump) {
            console.log(`[${room.name}][LAB] Force-evac: нет физического места ни в terminal, ни в storage.`);
            return;
        }
        console.log(`[${room.name}][LAB] Force-evac ${lab.mineralType} from lab ${lab.id} -> ${dump.structureType}`);
        room.transfer(lab.mineralType, lab.id, dump.id);
        return; // 1 transfer per call (charger-throttle).
    }
}

exports.runReaction = function(room) {
    if (room.hasHostiles) return;

    const source1 = Game.getObjectById(labs[room.name]["sources"][0]);
    const source2 = Game.getObjectById(labs[room.name]["sources"][1]);
    if (!source1 || !source2) {
        console.log(`[${room.name}] Нет source лаборатории`);
        return;
    }

    const resource1 = labs[room.name]["resources"][0];
    const resource2 = labs[room.name]["resources"][1];
    const expectedOutput = REACTIONS[resource1] && REACTIONS[resource1][resource2];

    // Обновляем статус ДО ранних возвратов, чтобы случай "нет входных минералов" попадал в визуализацию.
    updateLabStatus(room, expectedOutput, source1, source2);

    // Если stuck продержался дольше evacDelay - выгружаем лабы и не запускаем новые реакции
    // (иначе лабы тут же наливаются обратно, ratchet-эффект).
    if (room.memory.lab_status && room.memory.lab_status.forceEvac) {
        forceEvacuateLabs(room, expectedOutput);
        return;
    }

    // Все потребители produce-минерала забиты - смысла гонять реакцию нет.
    // Существующие лабы доедят cooldown, дальше runReaction сюда не зайдёт.
    if (expectedOutput && exports.isDownstreamSaturated(expectedOutput)) {
        return;
    }

    if (source1.store.getUsedCapacity(source1.mineralType) < LAB_REACTION_AMOUNT) return;
    if (source2.store.getUsedCapacity(source2.mineralType) < LAB_REACTION_AMOUNT) return;

    // Только одна транспортная задача за вызов: charger'ов обычно мало,
    // лишние назначения упадут с "No creep to transfer".
    let transfersQueued = 0;

    let reactionsQueued = 0;
    for (const lab_id of labs[room.name]["targets"]) try {
        const lab = Game.getObjectById(lab_id);
        if (!lab) {
            console.log(`[${room.name}] Нет target лаборатории ${lab_id}`);
            continue;
        }
        // Если в target-лабе оказался "чужой" минерал (после boost-задачи или смены конфига) -
        // выгружаем его, иначе runReaction вернёт ERR_INVALID_TARGET и лаба простаивает.
        if (lab.mineralType && expectedOutput && lab.mineralType != expectedOutput) {
            if (transfersQueued > 0) continue;
            const dump = (room.terminal && room.terminal.store.getFreeCapacity() > 0)
                ? room.terminal
                : (room.storage && room.storage.store.getFreeCapacity() > 0 ? room.storage : null);
            if (dump) {
                console.log(`[${room.name}][LAB] Evacuating ${lab.mineralType} from lab ${lab_id} (expected ${expectedOutput})`);
                room.transfer(lab.mineralType, lab_id, dump.id);
                transfersQueued++;
            }
            continue;
        }
        if (lab.cooldown != 0) {
            continue;
        }
        // Каждая реакция тратит LAB_REACTION_AMOUNT из каждого source. Останавливаемся,
        // как только в source-лабе не остаётся ресурсов на следующую реакцию.
        const requiredAmount = LAB_REACTION_AMOUNT * (reactionsQueued + 1);
        if (source1.store.getUsedCapacity(source1.mineralType) < requiredAmount) break;
        if (source2.store.getUsedCapacity(source2.mineralType) < requiredAmount) break;

        if (lab.runReaction(source1, source2) == OK) {
            reactionsQueued++;
        }

        // Перемещаем ресурсы из лабы, если она заполнена. Только одна задача за вызов.
        if (transfersQueued == 0 && lab.store.getUsedCapacity(lab.mineralType) > LAB_MINERAL_CAPACITY * 0.75) {
            if (room.terminal && room.terminal.store.getUsedCapacity(lab.mineralType) < 10000 && room.terminal.store.getFreeCapacity() > 10000) {
                room.transfer(lab.mineralType, lab_id, room.terminal.id);
                transfersQueued++;
                continue;
            }
            if (room.storage && room.storage.store.getUsedCapacity(lab.mineralType) < 100000 && room.storage.store.getFreeCapacity() > 10000) {
                room.transfer(lab.mineralType, lab_id, room.storage.id);
                transfersQueued++;
                continue;
            }
        }
    } catch (err) { err.log() }
}

exports.refillLabs = function(room) {
    if (room.hasHostiles) return;

    const source1 = Game.getObjectById(labs[room.name]["sources"][0]);
    const source2 = Game.getObjectById(labs[room.name]["sources"][1]);
    if (!source1 || !source2) {
        console.log(`[${room.name}] Нет source лаборатории`);
        return;
    }

    const resource1 = labs[room.name]["resources"][0];
    const resource2 = labs[room.name]["resources"][1];

    // Не заливаем под завязку: 1500 хватит на ~30 циклов реакций, но не блокирует ценные ресурсы.
    const REFILL_TARGET = 1500;

    if (source1.store.getUsedCapacity(resource1) < 500) {
        // Ищем откуда можно достать ресурсы.
        const warehouse = [room.storage, room.terminal]
            .filter(s => s)
            .filter(s => s.store.getUsedCapacity(resource1) > 500)
            .shift();
        if (warehouse) {
            room.transfer(resource1, warehouse.id, source1.id, REFILL_TARGET);
        }
    }
    if (source2.store.getUsedCapacity(resource2) < 500) {
        // Ищем откуда можно достать ресурсы.
        const warehouse = [room.storage, room.terminal]
            .filter(s => s)
            .filter(s => s.store.getUsedCapacity(resource2) > 500)
            .shift();
        if (warehouse) {
            room.transfer(resource2, warehouse.id, source2.id, REFILL_TARGET);
        }
    }
}

// Передаём ресурсы если:
// * В комнате-источнике есть 10к минералов.
// * В комнате-приёмнике нет 10к минералов.
exports.transferResourcesBetweenRooms = function() {
    const stockOf = (room, mineral) => {
        return (room.terminal ? room.terminal.store.getUsedCapacity(mineral) : 0)
             + (room.storage  ? room.storage.store.getUsedCapacity(mineral)  : 0);
    };

    // Ищет комнату с наибольшим запасом нужного минерала, исключая саму комнату-получателя
    // (комната может одновременно добывать и потреблять один и тот же ресурс - например, Z).
    const findRoomWithMineral = (mineral, excludeRoomName) => {
        let best = null;
        let bestStock = 0;
        for (const roomName in rooms) {
            if (roomName == excludeRoomName) continue;
            if (rooms[roomName]["mineral"] != mineral && rooms[roomName]["produce"] != mineral) continue;
            const room = Game.rooms[roomName];
            if (!room || !room.terminal) continue;

            const stock = stockOf(room, mineral);
            if (stock > bestStock) {
                best = room;
                bestStock = stock;
            }
        }
        return best;
    }

    for (const roomName in rooms) {
        const room = Game.rooms[roomName];
        if (!room) continue;
        for (const requireMineral of rooms[roomName]["require"]) {
            // Если нет терминала, то комната не интересует.
            if (!room.terminal) continue;

            // Если в комнате больше 5к минералов, то комната не нуждается в минералах.
            const targetRoomMineralCount = stockOf(room, requireMineral);
            if (targetRoomMineralCount > 5000) continue;

            // Ищем комнату, в которой производится необходимый ресурс.
            const sourceRoom = findRoomWithMineral(requireMineral, roomName);
            if (!sourceRoom) {
                console.log(`[${roomName}][LAB] Not found another room with ${requireMineral}. Lab will idle`);
                continue;
            }

            // Минимум 10к на складах - иначе нет излишка, чтобы транспортировать.
            const sourceRoomMineralsCount = stockOf(sourceRoom, requireMineral);
            if (sourceRoomMineralsCount < 10000) continue;

            // Нужно либо переместить ресурсы из терминала, либо сначала заполнить терминал из хранилища.
            const sourceTerminalMineralCount = sourceRoom.terminal.store.getUsedCapacity(requireMineral);
            if (sourceTerminalMineralCount > 10000) {
                if (sourceRoom.terminal.cooldown) {
                    // Терминал на перезарядке - попробуем в следующем проходе.
                    continue;
                }
                console.log(`[${sourceRoom.name}][LAB] Send 10k ${requireMineral} to ${roomName}`);
                sourceRoom.terminal.send(requireMineral, 10000, roomName)
            } else {
                if (!sourceRoom.storage) continue;
                console.log(`[${sourceRoom.name}][LAB] Transfer 10k ${requireMineral} from Storage to Terminal`);

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

        // Cooldown реакции (REACTION_TIME) минимум 15 тиков, поэтому опрос раз в 10 тиков ничего не упускает.
        if (Game.time % 10 === 0) {
            exports.runReaction(room);
        }
        if (Game.time % 100 === 0) {
            exports.refillLabs(room);
        }
    } catch (err) { err.log() }

    if (Game.time % 300 == 0) try {
        exports.transferResourcesBetweenRooms();
    } catch (err) { err.log() }
}


exports.transferResourcesBetweenRooms = profiler.registerFN(exports.transferResourcesBetweenRooms, "lab.transferResourcesBetweenRooms");
exports.runReaction = profiler.registerFN(exports.runReaction, "lab.runReaction");
exports.refillLabs = profiler.registerFN(exports.refillLabs, "lab.refillLabs");
exports.process = profiler.registerFN(exports.process, "lab.process");