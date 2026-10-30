// Реестр настроек (knobs) бота. Одно место, где описаны все ручки, которые игрок может
// крутить из консоли: ключ, область (global/room), значение по умолчанию, тип, описание.
//
// Хранение:
//   Memory.settings.version          - версия схемы (миграция ниже)
//   Memory.settings.global[key]      - глобальный override
//   Memory.settings.rooms[room][key] - override для одной комнаты (только для scope 'room')
//
// Чтение: settings.get(roomOrNull, key).
//   scope 'room':   room override -> global override -> default. Global override у room-ключа
//                   разрешён: "для всех комнат" одной записью (например power_disabled везде),
//                   а точечное исключение - room override поверх. Исключение - roomOnly
//                   (remote_rooms): глобальный список целей для всех комнат смысла не имеет.
//   scope 'global': только global override -> default; аргумент room игнорируется.
// Значение undefined/null = "не задано" (идём дальше по цепочке). 0 и false - настоящие значения:
// в отличие от старых `memory.x || default`, ноль больше не подменяется дефолтом.
//
// Невалидный override (не тот тип, вне min/max, плохой элемент list/map) - пропускается как "не задано" с одним
// console.log на ключ до global reset. Memory правят руками из консоли в обход set() - без
// этой проверки, например, power_bank_carriers_per_kill=0 молча выключил бы вывоз power.
//
// Неизвестный ключ в get() - throw: это опечатка в коде, а не в данных. Тихий undefined
// превращался бы в незаметно сломанную логику (`x > undefined` всегда false).
//
// Без `??`/`?.`: в коде бота их нигде нет, синтаксис держим на уровне остального кода.
//
// Поля записи реестра (для будущих settings()/set() в консоли):
//   key, scope, type ('number'|'boolean'|'list'|'map'|'enum'), def, desc, group,
//   min/max     - допустимый диапазон для number (и для значений map с valueType 'number'),
//   valueType   - тип значений map: 'number' | 'string',
//   values      - допустимые строки для enum,
//   nullable    - def === null означает "вычисляется в коде / пусто" (см. desc),
//   roomOnly    - room-ключ без global-слоя,
//   legacy      - где ключ жил до v1: 'Memory' (Memory[key]), 'room' (room.memory[key]),
//                 'Memory.byRoom' (Memory[key][roomName] -> rooms[roomName][key]),
//   legacyOr    - старый код читал через `|| default`: сохранённый falsy (0, '', null) значил
//                 default - при миграции отбрасываем, чтобы поведение не поменялось.

const VERSION = 1;

const GROUPS = {
    economy:   'Экономика: майнинг, терминал, балансировка энергии',
    remote:    'Удалённые комнаты: резерв и харвестинг',
    defense:   'Оборона: safe mode, рампарты',
    power:     'Power: power spawn, GPL',
    powerBank: 'Power bank: атака и вывоз',
    market:    'Маркет: закупка минералов под бусты',
    nuker:     'Nuker: заливка и закупка G',
    lab:       'Лабы',
    build:     'Автостройка',
    debug:     'Отладка и визуализация',
};

const ENTRIES = [
    // --- economy ---
    {key: 'miner_pause_total_energy', scope: 'room', type: 'number', def: 2000000, min: 0, group: 'economy', legacy: 'room', legacyOr: true,
     desc: 'Не спавнить майнеров, пока энергия комнаты (storage+terminal+factory, батарейки x10) выше порога. 0 = майнеры не спавнятся, как только в складах есть энергия'},
    {key: 'terminal_energy_reserve', scope: 'room', type: 'number', def: 100000, min: 0, max: 300000, group: 'economy', legacy: 'room',
     desc: 'Резерв энергии в терминале: чарджер доливает его из storage. 0 = не доливать'},
    {key: 'extractor_max_minerals', scope: 'room', type: 'number', def: 150000, min: 0, group: 'economy',
     desc: 'Не спавнить экстрактор, если своего минерала в storage+terminal больше порога'},
    {key: 'rb_poor_stored_energy', scope: 'global', type: 'number', def: 50000, min: 0, group: 'economy',
     desc: 'Балансировка: ниже этой энергии (с батарейками) комната бедная - ей шлют энергию. Должно быть < rb_rich_stored_energy'},
    {key: 'rb_rich_stored_energy', scope: 'global', type: 'number', def: 100000, min: 0, group: 'economy',
     desc: 'Балансировка: выше этой энергии (с батарейками) комната делится с бедными'},
    {key: 'rb_very_rich_stored_energy', scope: 'global', type: 'number', def: 200000, min: 0, group: 'economy',
     desc: 'Балансировка: выше этой сырой энергии излишки сжимаются в батарейки'},

    // --- remote ---
    {key: 'remote_rooms', scope: 'room', roomOnly: true, type: 'list', def: null, nullable: true, group: 'remote', legacy: 'Memory.byRoom',
     desc: 'Комнаты, которые эта комната резервирует (reserver) и харвестит (harvester): ["W10S38", ...]. Не задано = нет'},

    // --- defense ---
    {key: 'disable_safe_mode', scope: 'room', type: 'boolean', def: false, group: 'defense', legacy: 'room',
     desc: 'Запретить автоматическую активацию safe mode'},
    {key: 'rampart_target_hits', scope: 'room', type: 'number', def: null, nullable: true, min: 0, group: 'defense', legacy: 'room',
     desc: 'Мирная цель ремонта рампартов/стен до RCL 8. Не задано = таблица по RCL (10k..3M); на RCL 8 и в осаде всегда hitsMax'},

    // --- power ---
    {key: 'power_disabled', scope: 'room', type: 'boolean', def: false, group: 'power', legacy: 'room',
     desc: 'Не жечь power в power spawn и не возить в него power/энергию'},
    {key: 'power_spawn_min_power', scope: 'room', type: 'number', def: 50, min: 0, group: 'power', legacy: 'room', legacyOr: true,
     desc: 'Довозить power в power spawn, когда в нём меньше. 1 = только в пустой; 0 = не довозить никогда'},
    {key: 'power_spawn_min_stored_energy', scope: 'room', type: 'number', def: 50000, min: 0, group: 'power', legacy: 'room', legacyOr: true,
     desc: 'Энергию для power spawn брать из складов только при запасе комнаты (с батарейками) не ниже'},

    // --- powerBank ---
    {key: 'power_bank_disabled', scope: 'global', type: 'boolean', def: false, group: 'powerBank', legacy: 'Memory',
     desc: 'Выключить координатор power bank (атака и воровство)'},
    {key: 'power_bank_max_active', scope: 'global', type: 'number', def: 1, min: 0, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Сколько банков атакуем одновременно. 0 = только воровство чужих'},
    {key: 'power_bank_min_amount', scope: 'global', type: 'number', def: 2000, min: 0, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Минимум power в банке для атаки'},
    {key: 'power_bank_max_distance', scope: 'global', type: 'number', def: 4, min: 0, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Максимум комнат от home до банка для атаки'},
    {key: 'power_bank_min_decay_buffer', scope: 'global', type: 'number', def: 3000, min: 0, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Атаковать, только если до исчезновения банка осталось не меньше тиков'},
    {key: 'power_bank_carriers_per_kill', scope: 'global', type: 'number', def: 3, min: 1, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Сколько carrier-ов спавнить на вывоз одного банка'},
    {key: 'power_bank_steal_max_distance', scope: 'global', type: 'number', def: 3, min: 0, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Максимум комнат от home до чужого (контестного) банка для воровства'},
    {key: 'power_bank_home_for_room', scope: 'global', type: 'map', valueType: 'string', def: null, nullable: true, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Ручная home-комната для банков в target-комнате: {W10S40: "W9S39"}. Фильтры home (энергия, спавн, дистанция) всё равно действуют'},
    {key: 'travel_avoid_rooms', scope: 'global', type: 'list', def: null, nullable: true, group: 'powerBank', legacy: 'Memory', legacyOr: true,
     desc: 'Комнаты, которые power bank сквад обходит при прокладке маршрута: ["W5S35", ...]'},

    // --- market ---
    {key: 'boost_buy_max_price', scope: 'global', type: 'map', valueType: 'number', def: null, nullable: true, min: 0, group: 'market', legacy: 'Memory', legacyOr: true,
     desc: 'Потолок цены cr/u по минералам: {XGHO2: 8000, ...}. Минерала нет в карте = boost_buy_max_price_default; 0 = не покупать'},
    {key: 'boost_buy_max_price_default', scope: 'global', type: 'number', def: 5000, min: 0, group: 'market', legacy: 'Memory', legacyOr: true,
     desc: 'Потолок цены cr/u для минерала под буст power bank сквада. 0 = не покупать'},
    {key: 'boost_buy_min_credits', scope: 'global', type: 'number', def: 500000, min: 0, group: 'market', legacy: 'Memory', legacyOr: true,
     desc: 'Неприкосновенный остаток кредитов при закупке под бусты'},

    // --- nuker ---
    {key: 'nuker_fill_min_total_energy', scope: 'room', type: 'number', def: 1500000, min: 0, group: 'nuker', legacy: 'room', legacyOr: true,
     desc: 'Заливать nuker только при энергии комнаты (с батарейками) не ниже'},
    {key: 'nuker_fill_peace_ticks', scope: 'room', type: 'number', def: 5000, min: 0, group: 'nuker', legacy: 'room', legacyOr: true,
     desc: 'Заливать nuker только через столько тиков после последней атаки'},
    {key: 'nuker_buy_max_price', scope: 'room', type: 'number', def: 400, min: 0, group: 'nuker', legacy: 'room',
     desc: 'Потолок цены cr/u для BUY-ордера на G под nuker. 0 = не покупать'},
    {key: 'nuker_buy_target_amount', scope: 'room', type: 'number', def: 5000, min: 0, group: 'nuker', legacy: 'room', legacyOr: true,
     desc: 'Целевой запас G (terminal+storage+nuker) для закупки'},
    {key: 'nuker_buy_min_credits', scope: 'global', type: 'number', def: 100000, min: 0, group: 'nuker', legacy: 'Memory', legacyOr: true,
     desc: 'Неприкосновенный остаток кредитов при закупке G (с учётом fee)'},

    // --- lab ---
    {key: 'lab_stuck_evac_delay', scope: 'room', type: 'number', def: 500, min: 0, group: 'lab', legacy: 'room', legacyOr: true,
     desc: 'Через сколько тиков stuck-состояния лаб выгружать их принудительно'},

    // --- build ---
    {key: 'auto_build_disabled', scope: 'room', type: 'boolean', def: false, group: 'build',
     desc: 'Не строить структуры базы автоматически (комнаты с ручной планировкой)'},

    // --- debug ---
    {key: 'profiler_enabled', scope: 'global', type: 'boolean', def: false, group: 'debug', legacy: 'Memory',
     desc: 'Включить screeps-profiler. Читается при загрузке кода: применится после global reset (push кода)'},
    {key: 'viz_mode', scope: 'global', type: 'enum', values: ['off', 'min', 'full'], def: 'full', group: 'debug',
     desc: 'Визуализация: off - не рисовать ничего; min - иконки на карте и только тревоги в панели комнаты; full - всё. Консоль: viz(режим)'},
    {key: 'viz_min_bucket', scope: 'global', type: 'number', def: 3000, min: 0, max: 10000, group: 'debug', legacy: 'Memory',
     desc: 'Не рисовать визуализацию при CPU bucket ниже. 0 = рисовать всегда'},
];

// Бывший хардкод skip_rooms в modules/build.js - сеется в auto_build_disabled при миграции v1.
const LEGACY_SKIP_BUILD_ROOMS = ['W9S37', 'W8S38'];

// key -> entry. Без прототипа: get('toString') не должен найти Object.prototype.toString.
const REGISTRY = Object.create(null);
for (const e of ENTRIES) {
    if (REGISTRY[e.key]) throw new Error(`[settings] Дубликат ключа ${e.key}`);
    if (!GROUPS[e.group]) throw new Error(`[settings] Неизвестная группа ${e.group} у ${e.key}`);
    Object.freeze(e);
    REGISTRY[e.key] = e;
}

exports.VERSION = VERSION;
exports.GROUPS = GROUPS;
exports.ENTRIES = ENTRIES;       // в порядке объявления (по группам) - для листинга
exports.REGISTRY = REGISTRY;

// --- Проверка значений ----------------------------------------------------------------------
// Одна функция и для get() (горячий путь: только typeof/сравнения, без аллокаций), и для
// validate()/миграции. Возвращает null, если значение годится, иначе текст ошибки.
function inRange(e, v) {
    return typeof v === 'number' && isFinite(v)
        && (e.min === undefined || v >= e.min) && (e.max === undefined || v <= e.max);
}
function checkValue(e, v) {
    switch (e.type) {
        case 'number':
            if (typeof v !== 'number' || !isFinite(v)) return `ожидается число, получено ${JSON.stringify(v)}`;
            if (e.min !== undefined && v < e.min) return `меньше минимума ${e.min}`;
            if (e.max !== undefined && v > e.max) return `больше максимума ${e.max}`;
            return null;
        case 'boolean':
            return typeof v === 'boolean' ? null : `ожидается true/false, получено ${JSON.stringify(v)}`;
        case 'enum':
            return e.values.indexOf(v) >= 0 ? null : `ожидается одно из ${e.values.join('|')}, получено ${JSON.stringify(v)}`;
        case 'list':
            if (!Array.isArray(v)) return 'ожидается массив имён комнат';
            // Индексный цикл, не for...of: зовётся из get() (remote_rooms - каждый тик), без итератора.
            for (let i = 0; i < v.length; i++) {
                if (typeof v[i] !== 'string') return `элемент ${JSON.stringify(v[i])} - не строка`;
            }
            return null;
        case 'map':
            if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'ожидается объект {ключ: значение}';
            for (const k in v) {
                const x = v[k];
                if (e.valueType === 'string' ? typeof x !== 'string' : !inRange(e, x)) {
                    return `${k}: недопустимое значение ${JSON.stringify(x)}`;
                }
            }
            return null;
    }
    return `неизвестный тип ${e.type}`;
}

// Быстрая проверка для get(): тип + диапазон. list/map проверяются поэлементно (списки и карты
// короткие, строки ошибок строятся только на невалидном) - один плохой элемент делает весь
// override невалидным: get() идёт к следующему слою, как и для number.
function fastValid(e, v) {
    switch (e.type) {
        case 'number':  return inRange(e, v);
        case 'boolean': return typeof v === 'boolean';
        case 'enum':    return e.values.indexOf(v) >= 0;
        case 'list':
        case 'map':     return checkValue(e, v) === null;
    }
    return false;
}

// Невалидные override'ы логируем один раз на (слой, ключ) до global reset.
const warned = Object.create(null);
function warnInvalid(layer, e, v) {
    const id = layer + '|' + e.key;
    if (warned[id]) return;
    warned[id] = true;
    console.log(`[settings] Невалидный override ${layer}.${e.key}=${JSON.stringify(v)} (${checkValue(e, v)}) - игнорирую, см. settings.js`);
}

// Горячий путь: lookup в реестре + 2-4 чтения свойств + typeof, без аллокаций.
// room: Room | имя комнаты | null.
exports.get = function(room, key) {
    const e = REGISTRY[key];
    if (e === undefined) throw new Error(`[settings] Неизвестный ключ '${key}'`);
    const s = Memory.settings;
    if (s) {
        if (room && e.scope === 'room' && s.rooms) {
            const roomName = typeof room === 'string' ? room : room.name;
            const r = s.rooms[roomName];
            if (r) {
                const v = r[key];
                if (v !== undefined && v !== null) {
                    if (fastValid(e, v)) return v;
                    warnInvalid('rooms.' + roomName, e, v);
                }
            }
        }
        if (s.global && !e.roomOnly) {
            const v = s.global[key];
            if (v !== undefined && v !== null) {
                if (fastValid(e, v)) return v;
                warnInvalid('global', e, v);
            }
        }
    }
    return e.def;
}

// Проверка значения перед записью (для будущего set() в консоли). null = ок, иначе текст ошибки.
// null/undefined - это "снять override", всегда допустимо.
exports.validate = function(key, value, roomName) {
    const e = REGISTRY[key];
    if (!e) return `неизвестный ключ '${key}'`;
    if (e.scope === 'global' && roomName) return `${key} - глобальная настройка, комнату указывать нельзя`;
    if (e.roomOnly && !roomName) return `${key} задаётся только для комнаты`;
    if (value === undefined || value === null) return null;
    return checkValue(e, value);
}

// --- Миграция ------------------------------------------------------------------------------

function toNumber(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : undefined;
    if (typeof raw === 'string' && raw.trim() !== '' && isFinite(Number(raw))) return Number(raw);
    return undefined;
}

// Старое значение -> новое (undefined = не переносить). Цель - то же поведение, что давал
// старый код на этом значении:
//  - legacyOr (`x || default`): любой falsy (0, '', null, NaN) значил default - отбрасываем;
//    truthy-строка '0' в старом коде проходила `||` и сравнивалась как 0 - переносим 0.
//  - `x !== undefined ? x : default` (number без legacyOr): null был настоящим значением и во
//    всех таких местах вёл себя как 0 (`< null`, `<= null`, Math.min(.., null)) - переносим 0.
//    JSON превращает в null и NaN/Infinity.
//  - boolean: truthy-проверки -> !!raw.
function normalize(e, raw) {
    if (raw === undefined) return undefined;
    if (e.type === 'boolean') return !!raw;
    if (e.legacyOr && !raw) return undefined;
    if (e.type === 'number') {
        if (raw === null) return 0;
        return toNumber(raw);
    }
    if (raw === null) return undefined;
    if (e.type === 'list') {
        if (!Array.isArray(raw)) return undefined;
        const out = raw.filter(x => typeof x === 'string');
        return out.length ? out : undefined;
    }
    if (e.type === 'map') {
        if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
        const out = {};
        let any = false;
        for (const k in raw) {
            const x = raw[k];
            let v;
            if (e.valueType === 'string') v = typeof x === 'string' && x ? x : undefined;
            else v = (e.legacyOr && !x) ? undefined : toNumber(x);
            if (v === undefined) continue;
            out[k] = v;
            any = true;
        }
        return any ? out : undefined;
    }
    return undefined;
}

// Переносит src[srcKey] в dst[e.key] и удаляет src[srcKey]. Уже заданное новое значение не
// затираем. Невалидное после нормализации (мусор, нарушение min/max) - не переносим, но пишем в лог.
function moveValue(src, srcKey, dst, e, label, log) {
    if (!Object.prototype.hasOwnProperty.call(src, srcKey)) return;
    const raw = src[srcKey];
    delete src[srcKey];
    const v = normalize(e, raw);
    if (v === undefined) {
        log.push(`${label}=${JSON.stringify(raw)} отброшено (действует default ${JSON.stringify(e.def)})`);
        return;
    }
    const err = checkValue(e, v);
    if (err) {
        log.push(`${label}=${JSON.stringify(raw)} ОТБРОШЕНО как невалидное (${err}) - проверь вручную`);
        return;
    }
    if (dst[e.key] === undefined || dst[e.key] === null) dst[e.key] = v;
    log.push(`${label}=${JSON.stringify(raw)} -> ${JSON.stringify(dst[e.key])}`);
}

// Только обычный объект: в массив/примитив записанные поля молча теряются (JSON массива их не
// сохраняет), а version=1 не даст миграции повториться - старые ключи к тому моменту уже удалены.
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function roomDst(s, roomName) {
    const r = s.rooms[roomName];
    return isPlainObject(r) ? r : (s.rooms[roomName] = {});
}
function dropEmptyRoom(s, roomName) {
    if (s.rooms[roomName] && Object.keys(s.rooms[roomName]).length === 0) delete s.rooms[roomName];
}

// Одноразовая миграция старых ключей в Memory.settings. Идемпотентна: после успеха стоит
// version, повторный вызов - одно сравнение. Зовётся из main.js при загрузке кода и в начале
// каждого тика (самовосстановление, если Memory.settings снесли руками).
// Возвращает true, если миграция выполнялась.
exports.migrate = function() {
    let s = Memory.settings;
    if (s && s.version >= VERSION) return false;
    if (!isPlainObject(s)) s = Memory.settings = {};
    if (!isPlainObject(s.global)) s.global = {};
    if (!isPlainObject(s.rooms)) s.rooms = {};

    const log = [];
    const roomsMem = Memory.rooms || {};
    for (const e of ENTRIES) {
        if (e.legacy === 'Memory') {
            moveValue(Memory, e.key, s.global, e, `Memory.${e.key}`, log);
        } else if (e.legacy === 'room') {
            for (const roomName in roomsMem) {
                const mem = roomsMem[roomName];
                if (!mem || !Object.prototype.hasOwnProperty.call(mem, e.key)) continue;
                moveValue(mem, e.key, roomDst(s, roomName), e, `rooms.${roomName}.${e.key}`, log);
                dropEmptyRoom(s, roomName);
            }
        } else if (e.legacy === 'Memory.byRoom') {
            const old = Memory[e.key];
            if (old === undefined) continue;
            if (old && typeof old === 'object' && !Array.isArray(old)) {
                for (const roomName in old) {
                    moveValue(old, roomName, roomDst(s, roomName), e, `Memory.${e.key}.${roomName}`, log);
                    dropEmptyRoom(s, roomName);
                }
            } else {
                log.push(`Memory.${e.key}=${JSON.stringify(old)} отброшено (ожидался объект {комната: ...})`);
            }
            delete Memory[e.key];
        }
    }

    // Хардкоды, ставшие настройками: сохраняем прежнее поведение.
    for (const roomName of LEGACY_SKIP_BUILD_ROOMS) {
        const dst = roomDst(s, roomName);
        if (dst.auto_build_disabled === undefined) {
            dst.auto_build_disabled = true;
            log.push(`rooms.${roomName}.auto_build_disabled=true (бывший skip_rooms в build.js)`);
        }
    }

    s.version = VERSION;
    console.log(`[settings] Миграция до v${VERSION}:` + (log.length ? '\n  ' + log.join('\n  ') : ' старых ключей нет'));
    return true;
}
