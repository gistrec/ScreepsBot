// Консольные команды бота: help(), status(room), settings()/set()/unset() и обёртки над ручными
// хелперами (transfer, goto, boost, ...).
//
// Регистрация: на global, один раз при загрузке кода (require из main.js). После global reset
// global пустой, main.js грузится заново - команды появляются снова. В loop модуль не участвует:
// per-tick стоимость нулевая.
//
// Правила для команд:
//  - Возвращают строку: консоль Screeps печатает результат выражения. console.log не спамим;
//    хелперы, которые сами пишут в лог (room.transfer, findBestAnchor, planPipeline), зовём
//    через captureLog - их вывод уходит в возвращаемый текст.
//  - Никогда не бросают: ошибка аргументов (CmdError) -> текст; баг -> текст + место в стеке.
//  - Комнату и крипа принимают и объектом, и именем.
//  - Plain text: консоль рендерит HTML, поэтому '<' перед буквой заменяется (см. plain).
//
// Новая команда: cmd(name, signature, desc, fn, group). desc: первая строка - кратко (для
// help()), остальные - подробности и примеры (для help('name')). Имена - английские,
// описания - русские.

const settings = require('settings');
const utils = require('utils');
const roleMiner = require('roles/miner');
const roleCharger = require('roles/charger');
const roleUpgrader = require('roles/upgrader');
const roleRampartDefender = require('roles/rampartDefender');
const moduleLab = require('modules/lab');
const moduleRoomSurvey = require('modules/roomSurvey');

const GROUPS = {
    info:      'Сводки и справка',
    config:    'Настройки (Memory.settings)',
    creeps:    'Ручные команды крипам',
    logistics: 'Перевозки и спавн',
    planning:  'Экспансия и планировка',
    debug:     'Отладка',
};

// name -> {name, signature, desc, group, fn}. Порядок регистрации = порядок в help().
const COMMANDS = Object.create(null);
const ORDER = [];

// --- Инфраструктура ---------------------------------------------------------------------------

// Ошибка пользователя (плохие аргументы, комната не видна): печатаем только текст.
class CmdError extends Error {}
function fail(message) {
    throw new CmdError(message);
}

// Консоль Screeps рендерит вывод как HTML: `<room>` пропал бы как тег. Пробелы консоль
// сохраняет (моноширинный вывод) - выравнивание колонок работает.
function plain(text) {
    return text.replace(/<(?=[A-Za-z\/!?])/g, '‹');
}

function toText(result) {
    if (result === undefined) return 'OK';
    if (typeof result === 'string') return result;
    return show(result, 2000);
}

function errorText(name, err) {
    if (err instanceof CmdError) return `${name}: ${err.message}`;
    const msg = err && err.message !== undefined ? err.message : String(err);
    const where = err && typeof err.stack === 'string' ? (err.stack.split('\n')[1] || '').trim() : '';
    return `${name}: ошибка ${msg}${where ? ` (${where})` : ''}. help('${name}') - справка`;
}

// Только свои ключи: GROUPS['toString'] и т.п. из прототипа - не группа.
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function firstLine(desc) {
    return desc.split('\n')[0];
}

// Регистрирует команду в реестре и на global. Чужой глобал (Screeps API, implicit global
// кода) не перетираем: только свою же прошлую регистрацию. Ошибки - в лог и false, не throw:
// одна кривая команда не должна ронять регистрацию остальных.
function cmd(name, signature, desc, fn, group) {
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name) || typeof fn !== 'function' || !hasOwn(GROUPS, group)) {
        console.log(`[console] Некорректная регистрация команды ${name} (группа ${group})`);
        return false;
    }
    if (name in global && !(global[name] && global[name].isConsoleCommand)) {
        console.log(`[console] Команда ${name} не зарегистрирована: global.${name} уже занят`);
        return false;
    }
    const wrapped = function() {
        try {
            return plain(toText(fn.apply(null, arguments)));
        } catch (err) {
            return plain(errorText(name, err));
        }
    };
    wrapped.isConsoleCommand = true;
    // `status` без скобок печатает функцию - показываем подпись вместо исходника обёртки.
    wrapped.toString = () => `${signature} - ${firstLine(desc)}`;
    if (!COMMANDS[name]) ORDER.push(name);
    COMMANDS[name] = {name, signature, desc, group, fn: wrapped};
    global[name] = wrapped;
    return true;
}

// Вывод хелпера, который пишет в console.log, - в массив строк. Если console.log в рантайме
// окажется незаписываемым, присваивание молча не сработает (модуль не strict) и вывод просто
// уйдёт в консоль отдельными строками.
function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = function() {
        lines.push(Array.prototype.map.call(arguments, String).join(' '));
    };
    try {
        return {result: fn(), lines};
    } finally {
        console.log = original;
    }
}

function show(value, max = 40) {
    let s;
    try {
        s = JSON.stringify(value);
    } catch (err) {
        s = undefined;  // циклические Room/Creep
    }
    if (s === undefined) s = String(value);
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e4) return Math.round(n / 1e3) + 'k';
    return String(Math.round(n * 100) / 100);
}

function pad(s, width) {
    return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// rows: массив массивов строк. Колонки выравниваются по самой широкой ячейке, последняя - нет.
function table(rows, indent = '  ') {
    const widths = [];
    for (const row of rows) {
        row.forEach((cell, i) => { widths[i] = Math.max(widths[i] || 0, String(cell).length); });
    }
    return rows.map(row => indent + row.map((cell, i) =>
        i === row.length - 1 ? String(cell) : pad(String(cell), widths[i])).join('  ').replace(/\s+$/, '')).join('\n');
}

const ROOM_NAME_RE = /^([WE]\d+[NS]\d+|sim)$/;

function roomNameOf(arg) {
    const name = typeof arg === 'string' ? arg : (arg && typeof arg.name === 'string' ? arg.name : null);
    if (!name || !ROOM_NAME_RE.test(name)) fail(`ожидается комната (имя или Room), получено ${show(arg)}`);
    return name;
}

function visibleRoom(arg) {
    const name = roomNameOf(arg);
    const room = Game.rooms[name];
    if (!room) fail(`комната ${name} не видна`);
    return room;
}

function myRoom(arg) {
    const room = visibleRoom(arg);
    if (!room.controller || !room.controller.my) fail(`${room.name} - не своя комната`);
    return room;
}

function creepOf(arg) {
    const name = typeof arg === 'string' ? arg : (arg && typeof arg.name === 'string' ? arg.name : null);
    if (!name) fail(`ожидается крип (имя или Creep), получено ${show(arg)}`);
    const creep = Game.creeps[name];
    if (!creep) fail(`крип '${name}' не найден`);
    return creep;
}

// Позиция: 'x:y:room', 'x:y' (комната defaultRoom), RoomPosition или объект с .pos.
function parsePos(arg, defaultRoom) {
    let x, y, roomName;
    if (typeof arg === 'string') {
        const parts = arg.split(':');
        // Number('') === 0: пустая координата (':10') прошла бы как 0.
        if (parts.length < 2 || parts.length > 3 || parts[0].trim() === '' || parts[1].trim() === '') {
            fail(`позиция '${arg}': ожидается 'x:y:room'`);
        }
        x = Number(parts[0]);
        y = Number(parts[1]);
        roomName = parts.length === 3 ? parts[2] : defaultRoom;
    } else if (arg && typeof arg === 'object') {
        const pos = arg.pos || arg;
        x = pos.x;
        y = pos.y;
        roomName = pos.roomName;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 49 || y < 0 || y > 49) {
        fail(`позиция ${show(arg)}: x и y - целые 0..49`);
    }
    if (!roomName) fail(`позиция ${show(arg)}: не указана комната ('x:y:room')`);
    if (!ROOM_NAME_RE.test(roomName)) fail(`позиция ${show(arg)}: некорректная комната '${roomName}'`);
    return {x, y, roomName};
}

function isWall(roomName, x, y) {
    return (Game.map.getRoomTerrain(roomName).get(x, y) & TERRAIN_MASK_WALL) !== 0;
}

function optInt(value, name, min, max, def) {
    if (value === undefined || value === null) return def;
    if (!Number.isInteger(value) || value < min || value > max) fail(`${name}: целое ${min}..${max}, получено ${show(value)}`);
    return value;
}

function age(at) {
    return typeof at === 'number' ? `${Game.time - at}т назад` : 'время неизвестно';
}

// --- help ------------------------------------------------------------------------------------

const HELP_SIG_WIDTH = 36;

function helpCmd(topic) {
    if (topic === undefined || topic === null) {
        // Колонка подписи не шире HELP_SIG_WIDTH: длинная подпись - отдельной строкой, описание под ней.
        const width = Math.min(HELP_SIG_WIDTH, Math.max(...ORDER.map(n => COMMANDS[n].signature.length)));
        const lines = [`Консольные команды. help('имя') - подробно о команде, help('группа') - группа.`];
        for (const group in GROUPS) {
            const names = ORDER.filter(n => COMMANDS[n].group === group);
            if (!names.length) continue;
            lines.push(`${group} - ${GROUPS[group]}`);
            for (const n of names) {
                const c = COMMANDS[n];
                if (c.signature.length > width) lines.push(`  ${c.signature}`, `  ${pad('', width)}  ${firstLine(c.desc)}`);
                else lines.push(`  ${pad(c.signature, width)}  ${firstLine(c.desc)}`);
            }
        }
        return lines.join('\n');
    }
    if (typeof topic === 'function' && topic.isConsoleCommand) {
        // help(status) - без кавычек.
        topic = ORDER.find(n => COMMANDS[n].fn === topic);
    }
    if (typeof topic === 'string' && COMMANDS[topic]) {
        const c = COMMANDS[topic];
        const rest = c.desc.split('\n').slice(1).map(l => '  ' + l);
        return [c.signature, `  ${firstLine(c.desc)}`, ...rest, `  группа: ${c.group}`].join('\n');
    }
    if (typeof topic === 'string' && hasOwn(GROUPS, topic)) {
        const lines = [`${topic} - ${GROUPS[topic]}`];
        for (const n of ORDER.filter(n => COMMANDS[n].group === topic)) {
            lines.push('', COMMANDS[n].signature);
            for (const l of COMMANDS[n].desc.split('\n')) lines.push('  ' + l);
        }
        return lines.join('\n');
    }
    fail(`нет команды или группы ${show(topic)}. Группы: ${Object.keys(GROUPS).join(', ')}. help() - список`);
}

// --- settings / set / unset --------------------------------------------------------------------

function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Memory.settings с гарантированными global/rooms. migrate() идемпотентна: на рабочем Memory -
// одно сравнение, на снесённом руками - восстановит структуру (как в начале тика в main.js).
function settingsMemory() {
    settings.migrate();
    const s = Memory.settings;
    if (!isPlainObject(s.global)) s.global = {};
    if (!isPlainObject(s.rooms)) s.rooms = {};
    return s;
}

// Откуда берётся значение: 'R' - override комнаты, 'G' - глобальный, '-' - default;
// '!' - есть сохранённый, но невалидный override (get() его игнорирует).
function settingSource(e, roomName) {
    const s = Memory.settings || {};
    const roomLayer = roomName && e.scope === 'room' && isPlainObject(s.rooms) ? s.rooms[roomName] : null;
    const rv = isPlainObject(roomLayer) ? roomLayer[e.key] : undefined;
    const gv = isPlainObject(s.global) && !e.roomOnly ? s.global[e.key] : undefined;
    const has = v => v !== undefined && v !== null;
    const rOk = has(rv) && settings.validate(e.key, rv, roomName) === null;
    const gOk = has(gv) && settings.validate(e.key, gv, null) === null;
    const src = rOk ? 'R' : (gOk ? 'G' : '-');
    const bad = (has(rv) && !rOk) || (has(gv) && !gOk);
    return src + (bad ? '!' : '');
}

function scopeText(e) {
    const range = e.min !== undefined || e.max !== undefined
        ? `, ${e.min !== undefined ? e.min : '-inf'}..${e.max !== undefined ? e.max : 'inf'}` : '';
    const scope = e.roomOnly ? 'room only' : e.scope;
    const values = e.values ? ' ' + e.values.join('|') : '';
    return `${scope}, ${e.type}${values}${e.valueType ? ' of ' + e.valueType : ''}${range}`;
}

function settingDetail(e, roomName) {
    const s = Memory.settings || {};
    const lines = [`${e.key} (${scopeText(e)}), группа ${e.group}`, `  ${e.desc}`, `  default: ${show(e.def, 200)}`];
    if (!e.roomOnly) {
        const gv = isPlainObject(s.global) ? s.global[e.key] : undefined;
        lines.push(`  global:  ${gv === undefined || gv === null ? '-' : show(gv, 200)}`);
    }
    if (e.scope === 'room') {
        const overrides = [];
        const rooms = isPlainObject(s.rooms) ? s.rooms : {};
        for (const name in rooms) {
            const v = isPlainObject(rooms[name]) ? rooms[name][e.key] : undefined;
            if (v === undefined || v === null) continue;
            const err = settings.validate(e.key, v, name);
            overrides.push(`${name}=${show(v, 60)}${err ? ` (! игнорируется: ${err})` : ''}`);
        }
        lines.push(`  комнаты: ${overrides.length ? overrides.join(', ') : '-'}`);
    }
    if (roomName) lines.push(`  итог для ${roomName}: ${show(settings.get(roomName, e.key), 200)} [${settingSource(e, roomName)}]`);
    const target = e.scope === 'global' ? 'null' : (e.roomOnly ? `'${roomName || 'W1N1'}'` : `'${roomName || 'W1N1'}' | null`);
    lines.push(`  set(${target}, '${e.key}', значение) / unset(${target}, '${e.key}')`);
    return lines.join('\n');
}

function settingsCmd(a, b) {
    let roomName = null;
    let filter = null;
    const isFilter = v => typeof v === 'string' && (hasOwn(settings.GROUPS, v) || hasOwn(settings.REGISTRY, v));
    if (a !== undefined && a !== null) {
        if (isFilter(a)) filter = a;
        else roomName = roomNameOf(a);
    }
    if (b !== undefined && b !== null) {
        if (filter || !isFilter(b)) fail(`${show(b)} - не группа и не ключ. Группы: ${Object.keys(settings.GROUPS).join(', ')}`);
        filter = b;
    }
    if (filter && settings.REGISTRY[filter]) return settingDetail(settings.REGISTRY[filter], roomName);

    const lines = [
        `Настройки ${roomName ? 'для ' + roomName : '(global; settings(room) - для комнаты)'}. ` +
        `src: R - override комнаты, G - глобальный, - default, ! - невалидный override игнорируется. ` +
        `settings('ключ') - подробно.`,
    ];
    for (const group in settings.GROUPS) {
        if (filter && filter !== group) continue;
        const rows = [];
        for (const e of settings.ENTRIES) {
            if (e.group !== group) continue;
            // Без комнаты roomOnly-ключ показываем как default: глобального слоя у него нет.
            const value = settings.get(roomName, e.key);
            const desc = e.desc.length > 70 ? e.desc.slice(0, 67) + '...' : e.desc;
            rows.push([e.key, e.roomOnly ? 'room!' : e.scope, show(value, 24), show(e.def, 16), settingSource(e, roomName), desc]);
        }
        if (!rows.length) continue;
        lines.push(`[${group}] ${settings.GROUPS[group]}`);
        lines.push(table(rows));
    }
    return lines.join('\n');
}

// Ключ + scope-проверки, общие для set/unset. Возвращает запись реестра.
function settingEntry(key, roomName, value) {
    if (typeof key !== 'string') fail(`ключ - строка, получено ${show(key)}`);
    const e = settings.REGISTRY[key];
    if (!e) {
        const similar = settings.ENTRIES.filter(x => x.key.includes(key) || key.includes(x.key)).map(x => x.key).slice(0, 5);
        fail(`неизвестный ключ '${key}'.${similar.length ? ' Похожие: ' + similar.join(', ') + '.' : ''} settings() - список`);
    }
    const err = settings.validate(key, value, roomName);
    if (err) fail(err);
    return e;
}

function roomArgName(arg) {
    return arg === null || arg === undefined ? null : roomNameOf(arg);
}

function settingNotes(e, roomName) {
    const notes = [];
    if (roomName) {
        const room = Game.rooms[roomName];
        if (!room) notes.push(`предупреждение: ${roomName} сейчас не видна`);
        else if (!room.controller || !room.controller.my) notes.push(`предупреждение: ${roomName} - не своя комната`);
    } else if (e.scope === 'room') {
        const rooms = (Memory.settings && Memory.settings.rooms) || {};
        // Только валидные: невалидный room override get() пропускает, и там действует global.
        const own = Object.keys(rooms).filter(n => isPlainObject(rooms[n]) && rooms[n][e.key] !== undefined && rooms[n][e.key] !== null
                                              && settings.validate(e.key, rooms[n][e.key], n) === null);
        if (own.length) notes.push(`в комнатах со своим override глобальное значение не действует: ${own.join(', ')}`);
    }
    if (e.key === 'profiler_enabled') notes.push('применится после global reset (push кода)');
    return notes.map(n => '  ' + n);
}

function setCmd(roomArg, key, value) {
    const roomName = roomArgName(roomArg);
    if (value === undefined) fail(`не указано значение: set(${roomName ? `'${roomName}'` : 'null'}, '${key}', значение)`);
    if (value === null) fail(`null не задаёт значение - для снятия override: unset(${roomName ? `'${roomName}'` : 'null'}, '${key}')`);
    const e = settingEntry(key, roomName, value);
    const s = settingsMemory();
    let layer = s.global;
    if (roomName) {
        if (!isPlainObject(s.rooms[roomName])) s.rooms[roomName] = {};
        layer = s.rooms[roomName];
    }
    const before = settings.get(roomName, key);
    // Копия: массив/объект из консоли не должен оставаться общим с вызывающим кодом.
    layer[key] = JSON.parse(JSON.stringify(value));
    const where = roomName ? `rooms.${roomName}` : 'global';
    return [`${where}.${key} = ${show(value, 200)} (было ${show(before, 60)}, default ${show(e.def, 60)})`,
            ...settingNotes(e, roomName)].join('\n');
}

function unsetCmd(roomArg, key) {
    const roomName = roomArgName(roomArg);
    const e = settingEntry(key, roomName, null);
    const s = settingsMemory();
    const layer = roomName ? s.rooms[roomName] : s.global;
    const where = roomName ? `rooms.${roomName}` : 'global';
    if (!isPlainObject(layer) || layer[key] === undefined) {
        return `${where}.${key}: override не задан, действует ${show(settings.get(roomName, key), 60)}`;
    }
    const old = layer[key];
    delete layer[key];
    if (roomName && Object.keys(layer).length === 0) delete s.rooms[roomName];
    return [`${where}.${key} снят (был ${show(old, 60)}), теперь ${show(settings.get(roomName, key), 60)}`,
            ...settingNotes(e, roomName)].join('\n');
}

// --- status ----------------------------------------------------------------------------------

function labLine(ls) {
    if (!ls) return 'нет данных';
    const flags = [];
    if (ls.stuck) flags.push(`stuck ${ls.stuck}`);
    if (ls.dirty) flags.push(`dirty ${ls.dirty}`);
    if (ls.cooling) flags.push(`cooling ${ls.cooling}`);
    if (ls.sourceLow) flags.push('мало входных');
    if (ls.forceEvac) flags.push('FORCE-EVAC');
    return `${ls.output || '-'}: runnable ${ls.runnable}/${ls.total}${flags.length ? ', ' + flags.join(', ') : ''} (${age(ls.at)})`;
}

// Нужды цепочки и модулей (utils.freshSpawnNeeds - протухшие отброшены).
function spawnNeedLine(mem) {
    const needs = utils.freshSpawnNeeds(mem);
    return needs.length ? needs.map(sn => `ждёт ${sn.role} ${sn.needed}e (${age(sn.at)})`).join('; ') : 'не ждёт энергии';
}

function statusFromMemory(name) {
    const mem = (Memory.rooms && Memory.rooms[name]) || {};
    const overrides = Memory.settings && Memory.settings.rooms && Memory.settings.rooms[name];
    const lines = [`${name}: комната не видна, данные из Memory.rooms (могут быть устаревшими)`];
    lines.push(table([
        ['Оборона:', mem.defending ? `ОБОРОНА, врагов ${mem.enemy_creeps || 0}` : `мир, врагов ${mem.enemy_creeps || 0}`],
        ['Спавн:', spawnNeedLine(mem)],
        ['Лабы:', labLine(mem.lab_status)],
        ['Настройки:', isPlainObject(overrides) ? `${Object.keys(overrides).length} override (settings('${name}'))` : 'без override'],
    ]));
    return lines.join('\n');
}

// Считаем как spawn роли: в числителе только живущие дольше порога замены (miner/upgrader
// фильтруют ticksToLive > minerReplacementTtl тела текущего конфига), иначе "2/2" при уже
// ищущем замену спавне. Спавнящиеся и уходящие - отдельно.
function countLine(room, role, configurations, need) {
    const creeps = utils.creepsByRole(room, role);
    let ttl = 0;
    if (configurations) ttl = utils.minerReplacementTtl(utils.getAvailableCreepConfiguration(configurations, room).parts.length);
    const spawning = creeps.filter(c => c.spawning).length;
    const active = creeps.filter(c => !c.spawning && (!configurations || c.ticksToLive > ttl)).length;
    const leaving = creeps.length - spawning - active;
    const extra = [];
    if (spawning) extra.push(`+${spawning} спавнится`);
    if (leaving) extra.push(`+${leaving} уходит`);
    return `${role} ${active}/${need}${extra.length ? ' (' + extra.join(', ') + ')' : ''}`;
}

// Энергия складов без room.getFactory(): тот при отсутствии factory каждый вызов делает
// FIND_MY_STRUCTURES (отрицательный результат не кешируется), а при наличии пишет
// room.memory.factoryId. Информационная команда - только per-tick кеш getMyStructuresByType.
function storedEnergy(room) {
    const factory = (utils.getMyStructuresByType(room)[STRUCTURE_FACTORY] || [])[0];
    let energy = 0, total = 0;
    for (const s of [room.storage, room.terminal, factory]) {
        if (!s) continue;
        const e = s.store.getUsedCapacity(RESOURCE_ENERGY);
        energy += e;
        total += e + s.store.getUsedCapacity(RESOURCE_BATTERY) * 10;
    }
    return {energy, total};
}

// Та же классификация, что resourceBalance.classifyEnergy (без терминала - neutral), но на
// storedEnergy() вместо getTotalEnergy() - см. выше.
function wealthClass(room, total) {
    if (!room.terminal) return 'neutral';
    if (total > settings.get(null, 'rb_rich_stored_energy')) return 'rich';
    if (total < settings.get(null, 'rb_poor_stored_energy')) return 'poor';
    return 'neutral';
}

function statusCmd(roomArg) {
    const name = roomNameOf(roomArg);
    const room = Game.rooms[name];
    if (!room) return statusFromMemory(name);

    const c = room.controller;
    if (!c || !c.my) {
        const owner = !c ? 'без контроллера'
            : c.owner ? `владелец ${c.owner.username}`
            : c.reservation ? `резерв ${c.reservation.username} ${c.reservation.ticksToEnd}т`
            : 'ничья';
        return `${name}: не своя комната (${owner}), враждебных крипов ${room.find(FIND_HOSTILE_CREEPS).length}`;
    }

    const mem = room.memory;
    const rcl = c.level < 8 && c.progressTotal
        ? `RCL ${c.level} ${(c.progress / c.progressTotal * 100).toFixed(1)}% (${fmtNum(c.progress)}/${fmtNum(c.progressTotal)})`
        : `RCL ${c.level}`;

    const stored = storedEnergy(room);
    const total = stored.total;
    const minerPause = settings.get(room, 'miner_pause_total_energy');
    const reserve = settings.get(room, 'terminal_energy_reserve');

    const sources = utils.getSources(room).length;
    const minersNeed = room.energyCapacityAvailable < 550 && sources > 1 ? 2 * sources : sources;
    const needsChargers = utils.needsChargers(room);
    const chargersNeed = needsChargers ? utils.getAvailableCreepConfiguration(roleCharger.configurations, room).max_count : 0;
    const upgradersNeed = needsChargers ? utils.getAvailableCreepConfiguration(roleUpgrader.configurations, room).max_count : 1;

    let safeMode;
    if (c.safeMode) safeMode = `активен ${c.safeMode}т`;
    else safeMode = `доступно ${c.safeModeAvailable}${c.safeModeCooldown ? `, cooldown ${c.safeModeCooldown}т` : ''}`;
    if (settings.get(room, 'disable_safe_mode')) safeMode += ', авто выключено';

    let mining;
    if (total > minerPause) mining = `ПАУЗА: энергия ${fmtNum(total)} > ${fmtNum(minerPause)}`;
    else if (room.isUnderAttack) mining = 'майнеры не спавнятся: атака без safe mode';
    else mining = `работает (пауза при > ${fmtNum(minerPause)})`;

    let terminal = 'нет';
    if (room.terminal) {
        const te = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        terminal = `энергия ${fmtNum(te)} / резерв ${fmtNum(reserve)}${te < reserve ? ' (ниже резерва)' : ''}`;
    }

    const lines = [`${name}  ${rcl}  downgrade ${c.ticksToDowngrade}т`];
    lines.push(table([
        ['Энергия:', `спавн ${room.energyAvailable}/${utils.getEffectiveEnergyCapacity(room)}, склады ${fmtNum(stored.energy)}, ` +
                     `всего ${fmtNum(total)} (с батарейками), класс ${wealthClass(room, total)}`],
        ['Терминал:', terminal],
        ['Оборона:', `${room.isDefending ? 'ОБОРОНА' : 'мир'}, врагов ${mem.enemy_creeps || 0}, safe mode ${safeMode}`],
        ['Крипы:', [countLine(room, 'miner', roleMiner.configurations, minersNeed),
                    countLine(room, 'charger', null, chargersNeed),
                    countLine(room, 'upgrader', roleUpgrader.configurations, upgradersNeed)].join(', ')],
        ['Спавн:', spawnNeedLine(mem)],
        ['Майнинг:', mining],
        ['Лабы:', labLine(mem.lab_status)],
    ]));
    return lines.join('\n');
}

// --- powerBanks ------------------------------------------------------------------------------

function powerBanksCmd() {
    const banks = Memory.power_banks || {};
    const ids = Object.keys(banks);
    const active = ids.filter(id => banks[id].status === 'attacking' || banks[id].status === 'looting').length;
    const head = `Power banks: ${ids.length}, активных ${active}/${settings.get(null, 'power_bank_max_active')}` +
                 `${settings.get(null, 'power_bank_disabled') ? ', КООРДИНАТОР ВЫКЛЮЧЕН (power_bank_disabled)' : ''}`;
    if (!ids.length) return head;
    const rows = [['room', 'pos', 'power', 'HP', 'decay', 'status', 'home', 'squad', 'carriers', 'id']];
    for (const id of ids) {
        const b = banks[id];
        rows.push([
            b.roomName, `${b.x}:${b.y}`, String(b.amount), fmtNum(b.hits || 0),
            `${Math.max(0, (b.decayAt || 0) - Game.time)}т`,
            b.status + (b.contested ? ' (contested)' : ''),
            b.home_room || '-',
            String((b.squad || []).filter(n => Game.creeps[n]).length),
            String((b.carriers || []).filter(n => Game.creeps[n]).length),
            id,
        ]);
    }
    return head + '\n' + table(rows);
}

// --- creeps ----------------------------------------------------------------------------------

// Ручные задачи крипа в порядке main.js: boost -> unboost -> goto -> recycle. Возвращает
// активные из списка names (boost - и через очередь).
function pendingTasks(creep, names) {
    const m = creep.memory;
    const has = {
        boost: !!(m.boost || (m.boost_queue && m.boost_queue.length)),
        unboost: !!m.unboost,
        goto: !!m.goto,
        recycle: !!m.recycling,
    };
    return names.filter(n => has[n]);
}

function gotoCmd(creepArg, pos) {
    const creep = creepOf(creepArg);
    if (pos === undefined) {
        return creep.memory.goto ? `${creep.name} идёт в ${creep.memory.goto}` : `${creep.name}: goto не задан`;
    }
    if (pos === null || pos === 'off') {
        const had = creep.memory.goto;
        delete creep.memory.goto;
        delete creep.memory.goto_state;
        return had ? `${creep.name}: goto ${had} снят` : `${creep.name}: goto не был задан`;
    }
    const p = parsePos(pos, creep.room.name);
    // Явная комната: 'x:y' в checkGoTo означает "в текущей комнате крипа" на каждом тике -
    // после пересечения границы цель уехала бы.
    creep.memory.goto = `${p.x}:${p.y}:${p.roomName}`;
    // Новая команда - новый отсчёт таймаута и ERR_NO_PATH (иначе повтор на ту же клетку
    // унаследовал бы старый goto_state).
    delete creep.memory.goto_state;
    const wall = isWall(p.roomName, p.x, p.y) ? ' Внимание: клетка - стена, команда снимется по таймауту.' : '';
    // main.js: boost -> unboost -> goto -> recycle. Активный boost/unboost идёт раньше goto.
    const busy = pendingTasks(creep, ['boost', 'unboost']);
    const wait = busy.length ? ` Внимание: сначала выполнится ${busy.join(', ')} (идёт раньше goto).` : '';
    return `${creep.name} -> ${creep.memory.goto}. Роль на паузе до прибытия; ` +
           `снимается через 300т или после 10x ERR_NO_PATH.${wall}${wait}`;
}

function recycleCmd(creepArg, on) {
    const creep = creepOf(creepArg);
    if (on === false) {
        if (!creep.memory.recycling) return `${creep.name}: переработка не была назначена`;
        delete creep.memory.recycling;
        delete creep.memory.spawn_id;
        return `${creep.name}: переработка отменена`;
    }
    if (on !== undefined && on !== true) fail(`второй аргумент - true/false, получено ${show(on)}`);
    const mem = creep.memory;
    // boost и goto в main.js идут раньше recycle: goto держал бы крипа до 300т, boost_force -
    // до смерти. Переработке они не нужны - снимаем. unboost оставляем: он возвращает минералы
    // и конечен (снимается сам при пропавшей лабе).
    const cleared = pendingTasks(creep, ['boost', 'goto']);
    delete mem.boost;
    delete mem.boost_queue;
    delete mem.boost_force;
    delete mem.goto;
    delete mem.goto_state;
    // Новое назначение - новый выбор спавна: checkRecycling берёт закешированный spawn_id,
    // а он мог остаться от прошлой (отменённой) переработки в другой комнате.
    delete mem.spawn_id;
    mem.recycling = true;
    const notes = [];
    if (cleared.length) notes.push(`сняты задачи: ${cleared.join(', ')}`);
    if (mem.unboost) notes.push('сначала выполнится unboost');
    return `${creep.name} пойдёт на переработку к ближайшему активному спавну${notes.length ? ' (' + notes.join('; ') + ')' : ''}. ` +
           `Отмена: recycle('${creep.name}', false)`;
}

function boostCmd(creepArg, resource) {
    const creep = creepOf(creepArg);
    const mem = creep.memory;
    if (resource === undefined) {
        const queue = (mem.boost_queue || []).join(', ');
        return `${creep.name}: boost ${mem.boost || '-'}${queue ? `, очередь ${queue}` : ''}${mem.boost_force ? ' (force)' : ''}`;
    }
    if (resource === null || resource === 'off') {
        delete mem.boost;
        delete mem.boost_queue;
        // boost_force без boost не нужен, а оставшись, сделал бы следующий boost() "ждать лабу вечно".
        delete mem.boost_force;
        return `${creep.name}: boost-задачи сняты`;
    }
    if (typeof resource !== 'string') fail(`минерал - строка, например 'XGHO2'`);
    const partType = _.findKey(BOOSTS, b => b[resource]);
    if (!partType) fail(`${resource} - не буст-минерал`);
    if (!creep.body.some(p => p.type === partType && !p.boost)) fail(`у ${creep.name} нет небустнутых частей ${partType}`);
    const labs = utils.getMyStructuresByType(creep.room)[STRUCTURE_LAB] || [];
    if (!labs.length) fail(`в ${creep.room.name} нет своих лаб - бустит лаба в текущей комнате крипа`);

    if (mem.boost === resource || (mem.boost_queue || []).includes(resource)) return `${creep.name}: ${resource} уже в задаче`;
    if (mem.boost) {
        mem.boost_queue = (mem.boost_queue || []).concat([resource]);
    } else {
        mem.boost = resource;
    }
    const need = LAB_BOOST_MINERAL * creep.body.filter(p => p.type === partType).length;
    const room = creep.room;
    const have = (room.storage ? room.storage.store.getUsedCapacity(resource) : 0)
               + (room.terminal ? room.terminal.store.getUsedCapacity(resource) : 0);
    const warn = have < need ? ` Внимание: в ${room.name} ${resource} ${have} из ${need} нужных.` : '';
    return `${creep.name}: ${resource} -> ${partType} (${need} минерала). ` +
           `${mem.boost === resource ? 'Бустится со следующего тика.' : 'Поставлен в очередь.'}${warn}`;
}

// --- logistics -------------------------------------------------------------------------------

function optAmount(value, name, min) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !isFinite(value) || value < min) fail(`${name}: число >= ${min}, получено ${show(value)}`);
    return value;
}

// 'storage' | 'terminal' | 'factory' | id -> id своей структуры комнаты (как room.transfer).
// factory - из per-tick кеша, без room.getFactory() (запись в memory).
function storeId(room, ref, what) {
    if (typeof ref !== 'string' || !ref) fail(`${what} - 'storage' | 'terminal' | 'factory' | id, получено ${show(ref)}`);
    let obj;
    if (ref === 'storage') obj = room.storage;
    else if (ref === 'terminal') obj = room.terminal;
    else if (ref === 'factory') obj = (utils.getMyStructuresByType(room)[STRUCTURE_FACTORY] || [])[0];
    else obj = Game.getObjectById(ref);
    if (!obj || !obj.store) fail(`${what}: ${ref} не найден в ${room.name}`);
    // Только структуры (крип/руина/tombstone: withdraw/transfer исполнителя на них не сработает,
    // задача зависнет) и не чужие (container/link без владельца - можно).
    if (!obj.structureType || obj.my === false) fail(`${what}: ${ref} - не своя структура`);
    if (obj.pos && obj.pos.roomName !== room.name) fail(`${what}: ${ref} в другой комнате (${obj.pos.roomName})`);
    return obj.id;
}

function transferCmd(roomArg, resource, from, to, maxInTarget, minInSource) {
    const room = myRoom(roomArg);
    if (!RESOURCES_ALL.includes(resource)) fail(`неизвестный ресурс ${show(resource)}`);
    const fromId = storeId(room, from, 'from');
    const toId = storeId(room, to, 'to');
    // Задача "из себя в себя" не закрывается никогда: чарджер вечно вынимает и кладёт обратно.
    if (fromId === toId) fail(`from и to - одна структура (${fromId})`);
    // Исполнитель (tasks/resource.js transferResource) проверяет `max && target > max`:
    // 0 там значит "без лимита" - не принимаем, чтобы 0 не читался как "ничего не везти".
    const max = optAmount(maxInTarget, 'max', 1);
    const min = optAmount(minInSource, 'min', 0);
    const {lines} = captureLog(() => room.transfer(resource, fromId, toId, max, min));
    return lines.join('\n') || 'transfer: нет ответа';
}

function sendEnergyCmd(fromArg, toArg, amount) {
    const room = myRoom(fromArg);
    const target = roomNameOf(toArg);
    if (target === room.name) fail('комнаты отправителя и получателя совпадают');
    if (!room.terminal) fail(`в ${room.name} нет терминала`);
    // Room.sendEnergy ограничивает сумму свободным местом терминала-получателя - нужна видимость.
    if (!Game.rooms[target] || !Game.rooms[target].terminal) fail(`${target}: комната не видна или в ней нет терминала`);
    if (amount !== undefined && (typeof amount !== 'number' || !(amount > 0))) fail(`amount - число > 0, получено ${show(amount)}`);
    const {result, lines} = captureLog(() => room.sendEnergy(target, amount === undefined ? Number.MAX_SAFE_INTEGER : amount));
    const status = typeof result === 'number' ? result.toStringStatus() : show(result);
    const hint = result === ERR_TIRED ? ' (терминал на cooldown или уже отправлял в этом тике)' : '';
    return [...lines, `sendEnergy ${room.name} -> ${target}: ${status}${hint}`].join('\n');
}

// Роли с ручным API спавна (force обходит лимит/условия роли). Остальные роли спавнятся только
// своей логикой (цепочка spawnCreeps, expansion, powerBank) - через консоль их не форсируем.
const SPAWNABLE_ROLES = {
    charger:          (room, force) => roleCharger.spawn(room, force),
    rampart_defender: (room, force) => roleRampartDefender.spawn(room, force),
};
const ROLE_ALIASES = {rampartDefender: 'rampart_defender'};

function spawnRoleCmd(roomArg, role, force) {
    const room = myRoom(roomArg);
    const key = ROLE_ALIASES[role] || role;
    const spawnFn = typeof key === 'string' ? SPAWNABLE_ROLES[key] : undefined;
    if (!spawnFn) fail(`роль ${show(role)} не поддерживается. Можно: ${Object.keys(SPAWNABLE_ROLES).join(', ')}`);
    if (force !== undefined && typeof force !== 'boolean') fail(`force - true/false, получено ${show(force)}`);
    const {result, lines} = captureLog(() => spawnFn(room, !!force));
    if (lines.length) return lines.join('\n');
    return result === false
        ? `${room.name}: ${key} - спавн начат или ждёт энергию`
        : `${room.name}: ${key} не спавнится - главный спавн ${room.name} занят/неактивен, ` +
          `либо роль не нужна${force ? '' : ' (force=true обходит лимит и условия роли)'}`;
}

// --- planning --------------------------------------------------------------------------------

// Центр базы 13x13 должен целиком помещаться в комнату (как кандидаты findBestAnchor).
const BASE_HALF = 6;
// Каждое превью - проход терраина и схемы каждый тик визуализации: держим не больше трёх.
const PREVIEW_MAX = 3;
function checkBaseCenter(p) {
    if (p.x < BASE_HALF || p.x > 49 - BASE_HALF || p.y < BASE_HALF || p.y > 49 - BASE_HALF) {
        fail(`центр базы ${p.x}:${p.y}: x и y в ${BASE_HALF}..${49 - BASE_HALF} (база 13x13)`);
    }
}

// Имя аккаунта - владелец любой своей комнаты (без хардкода).
function myUsername() {
    for (const name in Game.rooms) {
        const c = Game.rooms[name].controller;
        if (c && c.my && c.owner) return c.owner.username;
    }
    return null;
}

function expandCmd(pos, force) {
    const flag = Game.flags['Expand'];
    const exp = Memory.expansion || {};
    if (force !== undefined && typeof force !== 'boolean') fail(`force - true/false, получено ${show(force)}`);
    const state = `expansion: ${exp.status || '-'}${exp.roomName ? ', комната ' + exp.roomName : ''}`;
    if (pos === undefined) {
        return `${flag ? `флаг Expand: ${flag.pos.x}:${flag.pos.y}:${flag.pos.roomName}` : 'флага Expand нет'}; ${state}`;
    }
    if (pos === null || pos === 'off') {
        if (!flag) return `флага Expand нет; ${state}`;
        flag.remove();
        return `флаг Expand удалён: со следующего тика expansion остановится (status -> idle)`;
    }
    const p = parsePos(pos);
    checkBaseCenter(p);
    if (isWall(p.roomName, p.x + 2, p.y)) fail(`спавн встанет на ${p.x + 2}:${p.y} - там стена. anchor('${p.roomName}') - подобрать центр`);
    const room = Game.rooms[p.roomName];
    const me = myUsername();
    const notes = [];
    if (room) {
        const c = room.controller;
        if (!c) fail(`в ${p.roomName} нет контроллера`);
        if (c.owner && !c.my) fail(`${p.roomName} занята игроком ${c.owner.username}`);
        // claimer.js зовёт claimController и код не проверяет: на чужом резерве (сначала
        // attackController) он стоял бы у контроллера до смерти, expansion висит в CLAIMING.
        if (c.reservation && c.reservation.username !== me) fail(`${p.roomName} зарезервирована игроком ${c.reservation.username}`);
    } else {
        notes.push(`${p.roomName} не видна - владельца/резерв проверить нельзя`);
    }
    // Свободный GCL: claimController без него - ERR_GCL_NOT_ENOUGH, тоже молча. Своя комната
    // (стадия building) GCL не требует.
    if (!(room && room.controller && room.controller.my)) {
        const owned = Object.keys(Game.rooms).filter(n => Game.rooms[n].controller && Game.rooms[n].controller.my).length;
        if (Game.gcl && owned >= Game.gcl.level) fail(`нет свободного GCL: комнат ${owned}, GCL ${Game.gcl.level}`);
    }
    if (flag && exp.status && exp.status !== 'idle' && flag.pos.roomName !== p.roomName && force !== true) {
        fail(`идёт expansion в ${flag.pos.roomName} (${exp.status}); смена комнаты бросит клеймеров/строителей. ` +
             `всё равно сменить (force): expand('${p.x}:${p.y}:${p.roomName}', true)`);
    }
    const target = new RoomPosition(p.x, p.y, p.roomName);
    const result = flag ? flag.setPosition(target) : target.createFlag('Expand');
    if (typeof result === 'number' && result !== OK) fail(`не удалось ${flag ? 'передвинуть' : 'поставить'} флаг: ${result.toStringStatus()}`);
    return `флаг Expand ${flag ? 'передвинут' : 'поставлен'} в ${p.x}:${p.y}:${p.roomName} (спавн в ${p.x + 2}:${p.y}), ` +
           `применится со следующего тика; ${state}${notes.length ? '. Внимание: ' + notes.join('; ') : ''}`;
}

const ANCHOR_MIN_BUCKET = 2000;
function anchorCmd(roomArg, n) {
    const name = roomNameOf(roomArg);
    const count = optInt(n, 'n', 1, 20, 5);
    // findBestAnchor всегда перебирает 38x38 центров x 169 клеток = ~244k terrain.get независимо
    // от n - десятки CPU за раз. На просевшем bucket не запускаем: таймаут тика try/catch не ловит.
    if (Game.cpu.bucket < ANCHOR_MIN_BUCKET) fail(`bucket ${Game.cpu.bucket} < ${ANCHOR_MIN_BUCKET}: anchor тяжёлый (~244k проверок терраина), повтори позже`);
    const cpuBefore = Game.cpu.getUsed();
    // findBestAnchor сам печатает топ - забираем вывод и форматируем таблицей. Терраин доступен без видимости.
    const {result} = captureLog(() => moduleRoomSurvey.findBestAnchor(name, count));
    const cpu = Game.cpu.getUsed() - cpuBefore;
    const top = result || [];
    if (!top.length) return `${name}: кандидатов нет`;
    const rows = [['#', 'центр', 'спавн', 'конфликты схемы', 'стены', 'края', 'всего в 13x13']];
    top.forEach((c, i) => rows.push([String(i + 1), `${c.x}:${c.y}`, `${c.x + 2}:${c.y}`,
        String(c.schemeConflicts), String(c.walls), String(c.edges), String(c.totalConflicts)]));
    const best = top[0];
    return [`${name}: топ-${top.length} центров базы (меньше конфликтов схемы - лучше), CPU ${cpu.toFixed(1)}`, table(rows),
            `preview('${name}', ${best.x}, ${best.y}) - показать на карте; expand('${best.x}:${best.y}:${name}') - экспансия`].join('\n');
}

function previewList() {
    const p = Memory.base_previews;
    return Array.isArray(p) ? p : (p ? [p] : []);
}

function previewCmd(roomArg, x, y, label) {
    if (roomArg === undefined) {
        const list = previewList();
        if (!list.length) return 'превью баз нет';
        return 'превью баз:\n' + list.map(p => `  ${p.roomName} ${p.x}:${p.y}${p.name ? ' ' + p.name : ''}`).join('\n');
    }
    if (roomArg === 'off' || roomArg === null) {
        const n = previewList().length;
        delete Memory.base_previews;
        return `превью удалены (${n})`;
    }
    const name = roomNameOf(roomArg);
    if (x === undefined) {
        const list = previewList().filter(p => p.roomName === name);
        return list.length ? list.map(p => `${p.roomName} ${p.x}:${p.y}${p.name ? ' ' + p.name : ''}`).join('\n') : `${name}: превью нет`;
    }
    if (x === 'off' || x === null) {
        const rest = previewList().filter(p => p.roomName !== name);
        const removed = previewList().length - rest.length;
        if (rest.length) Memory.base_previews = rest;
        else delete Memory.base_previews;
        return `${name}: превью удалены (${removed})`;
    }
    const p = parsePos({x, y, roomName: name});
    checkBaseCenter(p);
    if (label !== undefined && typeof label !== 'string') fail('name - строка');
    const list = previewList().filter(q => !(q.roomName === name && q.x === p.x && q.y === p.y));
    const entry = {roomName: name, x: p.x, y: p.y};
    if (label) entry.name = label;
    list.push(entry);
    const dropped = list.splice(0, Math.max(0, list.length - PREVIEW_MAX));
    Memory.base_previews = list;
    const droppedText = dropped.length ? ` Убраны старые (лимит ${PREVIEW_MAX}): ${dropped.map(q => `${q.roomName} ${q.x}:${q.y}`).join(', ')}.` : '';
    return `превью ${name} ${p.x}:${p.y} добавлено (всего ${list.length}).${droppedText} Рисуется при bucket >= viz_min_bucket. ` +
           `Убрать: preview('${name}', 'off')`;
}

function labPlanCmd(product) {
    if (typeof product !== 'string' || !RESOURCES_ALL.includes(product)) fail(`ожидается ресурс, например 'XUH2O', получено ${show(product)}`);
    const {lines} = captureLog(() => moduleLab.planPipeline(product));
    return lines.join('\n') || 'labPlan: нет вывода';
}

// --- debug -----------------------------------------------------------------------------------

function vizCmd(mode) {
    const bucket = `viz_min_bucket ${settings.get(null, 'viz_min_bucket')}, bucket ${Game.cpu.bucket}`;
    if (mode === undefined) return `визуализация: ${settings.get(null, 'viz_mode')} (${bucket})`;
    const err = settings.validate('viz_mode', mode, null);
    if (err || mode === null) fail(err || "ожидается 'off' | 'min' | 'full'");
    settingsMemory().global.viz_mode = mode;
    return `визуализация: ${mode}${mode === 'off' ? '' : ' (до #20 min и full рисуют одинаково)'}; ${bucket}`;
}

function profileCmd(ticks) {
    if (!Game.profiler) {
        return settings.get(null, 'profiler_enabled')
            ? 'profiler_enabled=true, но профайлер ещё не включён: нужен global reset (push кода)'
            : "профайлер выключен: set(null, 'profiler_enabled', true), push кода, затем profile(100)";
    }
    if (ticks === 'reset') {
        Game.profiler.reset();
        return 'профилирование остановлено, данные сброшены';
    }
    const n = optInt(ticks, 'ticks', 1, 10000, 100);
    Game.profiler.profile(n);
    return `профилирование ${n} тиков, отчёт придёт в консоль на тике ~${Game.time + n + 1}. Остановить: profile('reset')`;
}

// --- Регистрация -----------------------------------------------------------------------------
// Раз на загрузку модуля = раз на global reset (require кеширует модуль внутри одного global).

cmd('help', "help([тема])",
    'Список команд; help(\'имя\') - справка по команде, help(\'группа\') - по группе',
    helpCmd, 'info');
cmd('status', 'status(room)',
    'Сводка по комнате: RCL, энергия, оборона, крипы, спавн, майнинг, лабы\n' +
    'Невидимая комната - то, что есть в Memory.rooms.\n' +
    "Пример: status('W9S39')",
    statusCmd, 'info');
cmd('powerBanks', 'powerBanks()',
    'Таблица power bank\'ов (Memory.power_banks): статус, HP, decay, home, сквад',
    powerBanksCmd, 'info');

cmd('settings', 'settings([room], [группа|ключ])',
    'Таблица настроек: значение, default, откуда (R/G/-)\n' +
    "settings() - глобальные значения; settings('W9S39') - итог для комнаты;\n" +
    "settings('economy') / settings('W9S39', 'economy') - одна группа;\n" +
    "settings('miner_pause_total_energy') - подробно о ключе и всех его override.",
    settingsCmd, 'config');
cmd('set', 'set(room|null, ключ, значение)',
    'Задать override настройки (null = глобально)\n' +
    'Значение проверяется по реестру (тип, min/max, scope). Глобальная настройка - только с null;\n' +
    'room-настройка с null действует во всех комнатах без своего override.\n' +
    "Пример: set('W9S39', 'miner_pause_total_energy', 1500000); set(null, 'power_bank_max_active', 2)",
    setCmd, 'config');
cmd('unset', 'unset(room|null, ключ)',
    'Снять override настройки (вернуться к глобальному значению/default)\n' +
    "Пример: unset('W9S39', 'miner_pause_total_energy')",
    unsetCmd, 'config');

cmd('goto', "goto(creep, 'x:y:room')",
    'Отправить крипа на клетку; роль на паузе до прибытия\n' +
    "Позиция: 'x:y:room', 'x:y' (текущая комната крипа) или RoomPosition.\n" +
    "goto(creep) - текущая цель; goto(creep, 'off') - снять. Снимается сама через 300т или 10x ERR_NO_PATH.\n" +
    'Порядок ручных задач в main.js: boost -> unboost -> goto -> recycle.',
    gotoCmd, 'creeps');
cmd('recycle', 'recycle(creep, [false])',
    'Отправить крипа на переработку в ближайший спавн; false - отменить\n' +
    'Снимает boost/goto (в main.js они идут раньше переработки и держали бы крипа); unboost выполнится первым.',
    recycleCmd, 'creeps');
cmd('boost', 'boost(creep, [минерал])',
    'Забустить крипа в лабе его текущей комнаты\n' +
    'Если буст уже идёт - минерал встаёт в очередь. boost(creep) - текущие задачи;\n' +
    "boost(creep, 'off') - снять (вместе с boost_force).\n" +
    "Пример: boost('Upgrader_W9S39_123', 'XGH2O')",
    boostCmd, 'creeps');

cmd('transfer', 'transfer(room, res, from, to, [max], [min])',
    'Задача свободному чарджеру: перевезти ресурс внутри комнаты\n' +
    "from/to: 'storage' | 'terminal' | 'factory' | id структуры (разные).\n" +
    'max (>= 1): задача закрывается, когда в цели станет больше max; последний рейс может\n' +
    'перелить до объёма трюма. min: сколько оставить в источнике.\n' +
    "Пример: transfer('W9S39', 'XGHO2', 'terminal', 'storage')",
    transferCmd, 'logistics');
cmd('sendEnergy', 'sendEnergy(from, to, [amount])',
    'Отправить энергию терминалом (без amount - сколько влезет), комиссия вычитается из суммы\n' +
    'Обе комнаты должны быть видны и с терминалами (сумма ограничивается местом у получателя).\n' +
    "Пример: sendEnergy('W9S39', 'W8S36', 50000)",
    sendEnergyCmd, 'logistics');
cmd('spawnRole', 'spawnRole(room, role, [force])',
    `Заспавнить роль вне очереди: ${Object.keys(SPAWNABLE_ROLES).join(', ')}\n` +
    'Без force - обычная логика роли (лимит, условия); force=true - сверх лимита / без атаки.\n' +
    'Спавнит только главный спавн комнаты (имя = имя комнаты).\n' +
    "Пример: spawnRole('W9S39', 'rampart_defender', true)",
    spawnRoleCmd, 'logistics');

cmd('expand', "expand(['x:y:room' | 'off'], [force])",
    'Флаг Expand: поставить/передвинуть/снять; без аргументов - статус expansion\n' +
    'x:y - центр будущей базы 13x13 (спавн встанет в x+2:y). Смену комнаты во время\n' +
    'активной expansion нужно подтвердить force=true. Отказ: чужой владелец/резерв, нет свободного GCL.\n' +
    'Подобрать центр: anchor(room).',
    expandCmd, 'planning');
cmd('anchor', 'anchor(room, [n=5])',
    'Лучшие центры базы 13x13 в комнате по терраину (видимость не нужна)\n' +
    `Тяжёлая: ~244k проверок терраина (десятки CPU); не запускается при bucket < ${ANCHOR_MIN_BUCKET}.`,
    anchorCmd, 'planning');
cmd('preview', 'preview([room], [x], [y], [name])',
    'Превью базы на карте (Memory.base_previews)\n' +
    "preview() - все; preview('W1N1') - в комнате; preview('W1N1', 25, 20) - добавить;\n" +
    "preview('W1N1', 'off') - убрать в комнате;\n" +
    `preview('off') - убрать все. Не больше ${PREVIEW_MAX} превью (каждое - нагрузка на визуализацию):\n` +
    'новое сверх лимита вытесняет самое старое.',
    previewCmd, 'planning');
cmd('labPlan', 'labPlan(продукт)',
    'Цепочка реакций до продукта: что уже производится, чего нет и где это ставить\n' +
    "Пример: labPlan('XUH2O')",
    labPlanCmd, 'planning');

cmd('viz', "viz(['off'|'min'|'full'])",
    'Режим визуализации (настройка viz_mode); без аргумента - текущий\n' +
    "off - не рисовать ничего; min и full до переделки панели (#20) рисуют одинаково.\n" +
    'Отдельно действует viz_min_bucket: при bucket ниже порога визуализация пропускается.',
    vizCmd, 'debug');
cmd('profile', 'profile([ticks=100])',
    'Запустить screeps-profiler на N тиков (нужна настройка profiler_enabled)\n' +
    "profile('reset') - остановить и сбросить.",
    profileCmd, 'debug');

exports.cmd = cmd;
exports.COMMANDS = COMMANDS;
exports.GROUPS = GROUPS;
