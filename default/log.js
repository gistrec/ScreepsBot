// Консольный лог с уровнями и троттлингом. Единая точка вывода для всего бота вместо
// голых console.log.
//
//   log.error(key, msg, [ticks])  - неожиданный код ошибки движка, сломанная задача/конфиг
//   log.warn(key, msg, [ticks])   - нужно внимание человека (задача застряла, склады полны, ...)
//   log.info(key, msg, [ticks])   - рутинные события (заспавнил, отправил, назначил задачу)
//   log.debug(key, msg, [ticks])  - болтовня отдельных крипов, служебное
//   log.print(msg)                - всегда, без порога и троттлинга: отчёты, которые игрок
//                                   запросил сам (labPlan, anchor)
//
// Порог - настройка log_level (error|warn|info|debug, default warn); консоль: logLevel(уровень).
// Исключения (err.log() из prototypes/others.js) идут мимо модуля и печатаются всегда.
//
// Троттлинг: одно и то же key - не чаще раза в ticks тиков (по умолчанию THROTTLE[уровень]).
// Подавленные повторы считаются и дописываются к следующему выводу этого key:
// "... (+12 suppressed in 100t)". Ключ - категория события, а не крип: `fillTarget:W9S37:-7`,
// а не имя крипа, иначе троттлинг не работает и состояние растёт. key null/'' - без троттлинга.
// Сообщение сохраняет привычный префикс `[W9S37][Module]` - его формирует вызывающий код.
//
// Стоимость: модуль не участвует в loop - если никто не логирует, per-tick расход нулевой.
// Порог читается из settings один раз за тик при первом вызове. Состояние троттлинга - в heap
// (не Memory: без сериализации), Map key -> {t, n}; после global reset сбрасывается - в худшем
// случае одна лишняя строка. Размер ограничен MAX_KEYS: при переполнении удаляем записи старше
// PRUNE_AGE, а если и этого мало - сбрасываем всё (теряются только счётчики подавленных).
//
// Сообщение строится вызывающим кодом до вызова (шаблонная строка). Для дорогих сообщений
// (JSON.stringify и т.п.) на горячем пути - проверка log.enabled('debug') перед сборкой.
//
// console.log берётся в момент вызова, не кешируется: console.captureLog подменяет его на
// время команды, а log.unfiltered(fn) снимает порог и троттлинг, чтобы вывод хелпера
// (room.transfer, room.sendEnergy, spawn ролей) попал в ответ команды целиком.

const settings = require('settings');

const LEVELS = {error: 0, warn: 1, info: 2, debug: 3};
// Окно троттлинга по уровню (тиков). Ошибки давим меньше: их мало, и каждая важна.
const THROTTLE = [20, 100, 100, 10];
const MAX_KEYS = 300;
const PRUNE_AGE = 1000;

const state = new Map();
let levelAt = -1;
let levelCached = LEVELS.warn;
let bypass = 0;

function threshold() {
    if (levelAt !== Game.time) {
        levelAt = Game.time;
        const v = LEVELS[settings.get(null, 'log_level')];
        levelCached = v === undefined ? LEVELS.warn : v;
    }
    return levelCached;
}

function prune(now) {
    for (const [key, s] of state) {
        if (now - s.t >= PRUNE_AGE) state.delete(key);
    }
    if (state.size >= MAX_KEYS) state.clear();
}

function emit(lvl, key, msg, ticks) {
    if (bypass > 0) {
        console.log(msg);
        return true;
    }
    if (lvl > threshold()) return false;
    if (!key) {
        console.log(msg);
        return true;
    }
    const now = Game.time;
    const window = ticks === undefined ? THROTTLE[lvl] : ticks;
    let s = state.get(key);
    if (s === undefined) {
        if (state.size >= MAX_KEYS) prune(now);
        state.set(key, {t: now, n: 0});
        console.log(msg);
        return true;
    }
    if (now - s.t < window) {
        s.n++;
        return false;
    }
    const n = s.n;
    const dt = now - s.t;
    s.t = now;
    s.n = 0;
    console.log(n ? `${msg} (+${n} suppressed in ${dt}t)` : msg);
    return true;
}

// Возвращают true, если строка напечатана.
exports.error = function(key, msg, ticks) { return emit(0, key, msg, ticks); };
exports.warn  = function(key, msg, ticks) { return emit(1, key, msg, ticks); };
exports.info  = function(key, msg, ticks) { return emit(2, key, msg, ticks); };
exports.debug = function(key, msg, ticks) { return emit(3, key, msg, ticks); };

exports.print = function(msg) {
    console.log(msg);
};

// Пройдёт ли уровень порог (без учёта троттлинга) - чтобы не собирать дорогое сообщение зря.
exports.enabled = function(level) {
    return bypass > 0 || LEVELS[level] <= threshold();
};

// Выполнить fn без порога и троттлинга (вывод консольных команд). Состояние троттлинга не
// трогаем: строки команды не съедают окно фоновых сообщений и наоборот.
exports.unfiltered = function(fn) {
    bypass++;
    try {
        return fn();
    } finally {
        bypass--;
    }
};

// Для консоли: сколько ключей под троттлингом и сколько повторов сейчас подавлено.
exports.stats = function() {
    let suppressed = 0;
    for (const s of state.values()) suppressed += s.n;
    return {keys: state.size, suppressed};
};

exports.LEVELS = LEVELS;
exports.THROTTLE = THROTTLE;
exports.MAX_KEYS = MAX_KEYS;
