const profiler = require('../screeps-profiler');
const utils = require('../utils');


// Семантический конфиг лабы: пара входных минералов на комнату. Реакция выводится
// через REACTIONS[r1][r2]. Source/target лабы детектятся автоматически по геометрии
// (см. getLabConfig) - руками править ID после rebuild'а больше не нужно.
const labResources = exports.labResources = {
    "W9S37":  ["H",  "O"],
    "W9S39":  ["LH", "OH"],
    "W8S36":  ["X",  "LH2O"],
    "W11S39": ["L",  "H"],
    "W12S37": ["U",  "H"],     // → UH; U из W13S37 (соседняя), H локально
    "W13S37": ["UH", "OH"],    // → UH2O; UH из W12S37, OH из W9S37
    "W12S39": ["X",  "UH2O"],  // → XUH2O; X из W8S36, UH2O из W13S37 (был Z+H→ZH, ZH никем не consume'ился)
};

// Авто-определение ролей лаб. Source-лаба обязана быть в range 2 от ВСЕХ остальных
// (требование runReaction). Из всех таких берём 2 самые центральные (по сумме Chebyshev-
// дистанций) - на 10-кластере RCL 8 ровно 2 таких и есть. На неполных кластерах
// (RCL 6/7) heuristic может зацепить "не те" лабы, но это transient: при достройке
// до 10 лаб роли стабилизируются. Per-tick кеш на room - find() и сортировка O(N²)
// иначе крутятся в каждом из ~5 вызовов за тик.
exports.getLabConfig = function(room) {
    return room.cache('labConfig', r => {
        if (!labResources[r.name]) return null;

        const labs = utils.getMyStructuresByType(r)[STRUCTURE_LAB] || [];
        if (labs.length < 3) return null;

        const candidates = labs.filter(lab =>
            labs.every(other => lab === other || lab.pos.inRangeTo(other, 2))
        );
        if (candidates.length < 2) return null;

        candidates.sort((a, b) =>
            _.sum(labs, l => l.pos.getRangeTo(a)) - _.sum(labs, l => l.pos.getRangeTo(b))
        );
        const sources = candidates.slice(0, 2);
        const targets = labs.filter(l => !sources.includes(l));

        return { sources, targets, resources: labResources[r.name] };
    });
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
        "require": ["X", "UH2O"],
        "produce": "XUH2O",
    },
    "W12S37": {
        "mineral": "H",
        "require": ["U"],
        "produce": "UH",
    },
    "W13S37": {
        "mineral": "U",
        "require": ["UH", "OH"],
        "produce": "UH2O",
    }
};

// Планировщик цепочки реакций для нового продукта. Зови из консоли:
// `require('modules_lab').planPipeline('XUH2O')`. Раскладывает target в дерево
// реакций (через REACTIONS константу), помечает что уже работает / что mining'ится /
// что отсутствует. Для каждой missing-реакции предлагает host-комнату с минимальной
// linear distance до источников input'ов - чем ближе, тем дешевле transaction cost
// терминала. Кандидаты - owned rooms без активной реакции в labResources.
exports.planPipeline = function(target) {
    // 1. Reverse-индекс: product -> [input1, input2].
    const inputsOf = {};
    for (const a in REACTIONS) {
        for (const b in REACTIONS[a]) {
            inputsOf[REACTIONS[a][b]] = [a, b];
        }
    }

    // 2. Кто что добывает / производит.
    const minedIn    = {};  // mineral -> [roomName]
    const producedIn = {};  // product -> roomName
    for (const name in rooms) {
        const m = rooms[name].mineral;
        if (m) (minedIn[m] = minedIn[m] || []).push(name);
    }
    for (const name in labResources) {
        const [r1, r2] = labResources[name];
        const p = REACTIONS[r1] && REACTIONS[r1][r2];
        if (p) producedIn[p] = name;
    }

    // 3. Предложение host'а для отсутствующей реакции: candidate = owned-комната
    // без активной реакции; минимизируем sum(linear distance) до источников inputs.
    const candidateHosts = Object.keys(rooms).filter(r => !labResources[r]);
    function suggestHost(inputs) {
        const sources = inputs.map(i => producedIn[i] || (minedIn[i] && minedIn[i][0]));
        if (sources.some(s => !s) || candidateHosts.length === 0) return null;
        let best = null, bestDist = Infinity;
        for (const c of candidateHosts) {
            const d = sources.reduce((s, src) => s + Game.map.getRoomLinearDistance(c, src), 0);
            if (d < bestDist) { bestDist = d; best = c; }
        }
        return best ? `${best} (dist=${bestDist})` : null;
    }

    // 4. Рекурсивный обход цепочки.
    const missing = [];
    const lines = [`[planPipeline] ${target}:`];
    function walk(product, depth) {
        const indent = '  '.repeat(depth);
        const inputs = inputsOf[product];
        if (!inputs) {
            const mines = minedIn[product] || [];
            const tag = mines.length ? `mined in ${mines.join(', ')}` : 'NOT MINED';
            lines.push(`${indent}${mines.length ? '+' : '!'} ${product} (raw) - ${tag}`);
            return;
        }
        const [a, b] = inputs;
        const room = producedIn[product];
        if (room) {
            lines.push(`${indent}+ ${product} = ${a} + ${b}  [in ${room}]`);
        } else {
            const host = suggestHost([a, b]);
            const hint = host ? `, suggest host: ${host}` : ', no free host';
            lines.push(`${indent}! ${product} = ${a} + ${b}  [MISSING${hint}]`);
            missing.push({product, inputs: [a, b], host});
        }
        walk(a, depth + 1);
        walk(b, depth + 1);
    }
    walk(target, 0);

    lines.push('');
    if (missing.length) {
        lines.push(`Missing: ${missing.length} reaction(s)`);
        for (const m of missing) {
            lines.push(`  ${m.product} = ${m.inputs.join(' + ')}${m.host ? ` → ${m.host}` : ''}`);
        }
    } else {
        lines.push('All reactions in place.');
    }

    console.log(lines.join('\n'));
    return missing;
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

// Лабы, занятые активным буст-таском (powerBank attacker/healer и т.п.) - lab.js должен
// пропускать их в runReaction/forceEvacuateLabs, иначе runReaction дампит boost-минерал
// сразу после того как чарджер его залил. Реквизит - creep.memory.boost_force=true и
// creep.memory.lab_id указывает на target-лабу.
// Кешируем по тику: каждый из 5 лаб-комнат зовёт это в runReaction, ещё раз
// в forceEvacuateLabs - иначе 10+ пробегов по Game.creeps (~100 крипов) на тик.
let boostReservedCache = {tick: -1, ids: null};

function getBoostReservedLabIds() {
    if (boostReservedCache.tick === Game.time) return boostReservedCache.ids;
    const ids = new Set();
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.boost_force && c.memory.lab_id) {
            ids.add(c.memory.lab_id);
        }
    }
    boostReservedCache = {tick: Game.time, ids};
    return ids;
}

// Насыщение downstream: ресурс считается "ненужным", если у каждого потребителя
// уже >= этого порога в storage+terminal. Для финальных продуктов (без потребителей)
// функция возвращает false - такие копим до локального cap'а.
const DOWNSTREAM_SATURATION_THRESHOLD = 30000;

// Потребитель = комната, которая импортирует ресурс (`rooms[name].require`)
// или использует его как вход локальной лабы (`labResources[name]`).
// Используется чтобы тормозить экстрактор и реакции когда дальше складывать некуда.
exports.isDownstreamSaturated = function(mineral) {
    let consumers = 0;
    for (const consumerName in rooms) {
        const isImporter = rooms[consumerName]["require"].includes(mineral);
        const isLocalConsumer = (labResources[consumerName] || []).includes(mineral);
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
    const targetLabs = exports.getLabConfig(room).targets;
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
    const reservedLabs = getBoostReservedLabIds();
    const targetLabs = exports.getLabConfig(room).targets;
    for (const lab of targetLabs) {
        if (reservedLabs.has(lab.id)) continue;
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

    const cfg = exports.getLabConfig(room);
    if (!cfg) {
        console.log(`[${room.name}] Нет полного лаб-кластера (source-лабы не определились)`);
        return;
    }
    const [source1, source2] = cfg.sources;
    const [resource1, resource2] = cfg.resources;
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

    const reservedLabs = getBoostReservedLabIds();

    let reactionsQueued = 0;
    for (const lab of cfg.targets) try {
        // Лаба занята активным буст-таском - не запускаем реакции и не дампим её содержимое,
        // иначе boost.js придётся постоянно перезаливать её через чарджера.
        if (reservedLabs.has(lab.id)) continue;
        // Если в target-лабе оказался "чужой" минерал (после boost-задачи или смены конфига) -
        // выгружаем его, иначе runReaction вернёт ERR_INVALID_TARGET и лаба простаивает.
        if (lab.mineralType && expectedOutput && lab.mineralType != expectedOutput) {
            if (transfersQueued > 0) continue;
            const dump = (room.terminal && room.terminal.store.getFreeCapacity() > 0)
                ? room.terminal
                : (room.storage && room.storage.store.getFreeCapacity() > 0 ? room.storage : null);
            if (dump) {
                console.log(`[${room.name}][LAB] Evacuating ${lab.mineralType} from lab ${lab.id} (expected ${expectedOutput})`);
                room.transfer(lab.mineralType, lab.id, dump.id);
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
                room.transfer(lab.mineralType, lab.id, room.terminal.id);
                transfersQueued++;
                continue;
            }
            if (room.storage && room.storage.store.getUsedCapacity(lab.mineralType) < 100000 && room.storage.store.getFreeCapacity() > 10000) {
                room.transfer(lab.mineralType, lab.id, room.storage.id);
                transfersQueued++;
                continue;
            }
        }
    } catch (err) { err.log() }
}

exports.refillLabs = function(room) {
    if (room.hasHostiles) return;

    const cfg = exports.getLabConfig(room);
    if (!cfg) return;
    const [source1, source2] = cfg.sources;
    const [resource1, resource2] = cfg.resources;

    // Source-лаба с чужим минералом - её нельзя refill'ить (transfer→ERR_INVALID_TARGET),
    // и без эвакуации она зависнет навсегда. Случается после смены labResources в конфиге
    // или ручного transfer'а в лабу. Эвакуируем как обычные target-лабы в runReaction.
    for (const [sourceLab, expectedResource] of [[source1, resource1], [source2, resource2]]) {
        if (!sourceLab.mineralType) continue;
        if (sourceLab.mineralType === expectedResource) continue;
        if (sourceLab.store.getUsedCapacity(sourceLab.mineralType) === 0) continue;

        const dump = (room.terminal && room.terminal.store.getFreeCapacity() > 0)
            ? room.terminal
            : (room.storage && room.storage.store.getFreeCapacity() > 0 ? room.storage : null);
        if (!dump) {
            console.log(`[${room.name}][LAB] Source lab ${sourceLab.id} has ${sourceLab.mineralType} (expected ${expectedResource}), но дамп некуда`);
            continue;
        }
        console.log(`[${room.name}][LAB] Evacuating ${sourceLab.mineralType} from source lab ${sourceLab.id} (expected ${expectedResource})`);
        room.transfer(sourceLab.mineralType, sourceLab.id, dump.id);
        return; // 1 transfer task на вызов - дадим чарджеру время.
    }

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

                const charger = utils.creepsByRole(sourceRoom, "charger").filter(c => !c.memory.transfer).shift();
                if (charger) charger.memory.transfer = transfer;
            }
        }
    }
}

exports.process = function() {
    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        // Обрабатываем только комнаты с лабами.
        if (!labResources[roomName]) continue;

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