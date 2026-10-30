const lab = require('modules/lab');
const buildModule = require('modules/build');
const resourceBalance = require('modules/resourceBalance');
const utils = require('utils');
const settings = require('settings');
const taskDefend = require('tasks/defend');
const taskStructure = require('tasks/structure');
const taskResource = require('tasks/resource');

// Однобуквенные коды структур из modules/build.js (см. const B/R/S/E/T/L/M/C/F/N/O/P/H).
// Используем для overlay-превью базы по флагу.
const STRUCTURE_PREVIEW_LABEL = {
    [STRUCTURE_SPAWN]:       {ch: 'B', color: '#ffaa00'},
    [STRUCTURE_ROAD]:        {ch: '·', color: '#888888'},
    [STRUCTURE_STORAGE]:     {ch: 'S', color: '#44aaff'},
    [STRUCTURE_EXTENSION]:   {ch: 'E', color: '#ffcc44'},
    [STRUCTURE_TOWER]:       {ch: 'T', color: '#ff4444'},
    [STRUCTURE_LINK]:        {ch: 'L', color: '#aaaaff'},
    [STRUCTURE_TERMINAL]:    {ch: 'M', color: '#44aaff'},
    [STRUCTURE_LAB]:         {ch: 'C', color: '#ff44ff'},
    [STRUCTURE_FACTORY]:     {ch: 'F', color: '#cccccc'},
    [STRUCTURE_NUKER]:       {ch: 'N', color: '#ff4444'},
    [STRUCTURE_OBSERVER]:    {ch: 'O', color: '#aaaaff'},
    [STRUCTURE_POWER_SPAWN]: {ch: 'P', color: '#ff44ff'},
    [STRUCTURE_RAMPART]:     {ch: 'H', color: '#88ff88'},
};

// Энерго-статистика по комнате: EWMA скорости накопления getTotalEnergy() (с battery×10)
// за 3 окна. Аналог load-average в top: разные tau показывают краткосрочный/среднесрочный/
// долгосрочный режим. Сэмплируем раз в 50 тиков чтобы getTotalEnergy() не молотился каждый
// тик (он делает find(FIND_STRUCTURES) пробег по storage/terminal/factory).
const ENERGY_SAMPLE_STEP = 50;
const ENERGY_WINDOWS = [
    {tau:   300, label: '300t',  warmup:  6},   // ~15 мин - спайки
    {tau:  3000, label: '3kt',   warmup: 60},   // ~2.5ч - режим
    {tau: 30000, label: '30kt',  warmup: 600},  // ~25ч - тренд
];

// Запас энергии комнаты (storage+terminal+factory, батарейки x10) - та же сумма, что
// room.getTotalEnergy(), но один раз за тик (per-tick room.cache) и без room.getFactory():
// тот при отсутствии factory каждый вызов делает FIND_MY_STRUCTURES. Factory - из общего
// кеша getMyStructuresByType (его и так строят defend/fireTower). Раньше рендер звал
// getTotalEnergy дважды за тик (панель + карта) и ещё раз через resourceBalance.classifyEnergy.
function totalEnergy(room) {
    return room.cache('vizTotalEnergy', r => {
        const factory = (utils.getMyStructuresByType(r)[STRUCTURE_FACTORY] || [])[0];
        let count = 0;
        for (const s of [r.storage, r.terminal, factory]) {
            if (!s) continue;
            count += s.store.getUsedCapacity(RESOURCE_ENERGY);
            count += s.store.getUsedCapacity(RESOURCE_BATTERY) * 10;
        }
        return count;
    });
}

function updateEnergyEMA(room) {
    if (Game.time % ENERGY_SAMPLE_STEP !== 0) return;
    let stats = room.memory.energy_stats;
    const current = totalEnergy(room);
    if (!stats) {
        room.memory.energy_stats = {prev: current, prevTick: Game.time, ema: [0, 0, 0], samples: 0};
        return;
    }
    const dt = Game.time - stats.prevTick;
    if (dt <= 0) return;
    const rate = (current - stats.prev) / dt;

    if (stats.samples === 0) {
        for (let i = 0; i < ENERGY_WINDOWS.length; i++) stats.ema[i] = rate;
    } else {
        for (let i = 0; i < ENERGY_WINDOWS.length; i++) {
            const alpha = 1 - Math.exp(-dt / ENERGY_WINDOWS[i].tau);
            stats.ema[i] = alpha * rate + (1 - alpha) * stats.ema[i];
        }
    }
    stats.prev = current;
    stats.prevTick = Game.time;
    stats.samples += 1;
}

// Скорость апгрейда контроллера (E/t около контроллера): EWMA прироста controller.progress.
// Живёт в room.memory.upgrade_stats и сэмплируется вместе с energy-статистикой - переживает
// global reset. Раньше был module-level statuses со средним "с момента reset'а": обнулялся
// после каждого деплоя и заводился даже для чужих видимых комнат.
const UPGRADE_RATE_TAU = 1500;   // ~1ч15м

function updateUpgradeRate(room) {
    const controller = room.controller;
    // RCL 8: progress/progressTotal undefined - мерить нечего.
    if (!controller.progressTotal) {
        delete room.memory.upgrade_stats;
        return;
    }
    const stats = room.memory.upgrade_stats;
    // Нет базы или сменился уровень (на level-up progress прыгает к 0, дельта была бы
    // отрицательной) - только новая база, накопленный rate сохраняем.
    if (!stats || stats.level !== controller.level) {
        room.memory.upgrade_stats = {
            prev: controller.progress, prevTick: Game.time, level: controller.level,
            rate: stats ? stats.rate : 0, samples: stats ? stats.samples : 0,
        };
        return;
    }
    const dt = Game.time - stats.prevTick;
    if (dt <= 0) return;
    const rate = (controller.progress - stats.prev) / dt;
    if (stats.samples === 0) {
        stats.rate = rate;
    } else {
        const alpha = 1 - Math.exp(-dt / UPGRADE_RATE_TAU);
        stats.rate = alpha * rate + (1 - alpha) * stats.rate;
    }
    stats.prev = controller.progress;
    stats.prevTick = Game.time;
    stats.samples += 1;
}

// Сэмплы статистики своих комнат (energy EWMA, скорость апгрейда) отдельно от рендера:
// process зовёт это ДО gate'ов viz_mode/bucket/username. Раньше сэмпл жил внутри visualiseRoom
// и при выключенной визуализации статистика замирала, а первый сэмпл после включения
// размазывал весь пропуск в одну дельту. Раз в ENERGY_SAMPLE_STEP тиков, остальные - return.
function sampleRoomStats() {
    if (Game.time % ENERGY_SAMPLE_STEP !== 0) return;
    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;
        updateEnergyEMA(room);
        updateUpgradeRate(room);
    } catch (err) { err.log() }
}

// 1.5M, 12M, 340k. Ниже 10M - один знак после точки: раньше 1.5M округлялось до "2M", и
// порог (miner_pause 2M, nuker 1.5M) нельзя было сравнить с запасом на глаз.
function formatEnergyCompact(v) {
    if (v >= 10_000_000) return Math.round(v / 1_000_000) + 'M';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1_000)     return Math.round(v / 1_000) + 'k';
    return String(Math.round(v));
}

function formatRate(v) {
    const sign = v >= 0 ? '+' : '';
    return sign + Math.round(v);
}

// Тики компактно: 950 -> "950", 12345 -> "12.3k".
function formatTicks(t) {
    if (t >= 1000) return (t / 1000).toFixed(1) + 'k';
    return String(Math.max(0, Math.round(t)));
}

// CPU EWMA - аналог top'овского load average. Game.cpu.getUsed() для текущего тика
// дёшев (~0.001 CPU), поэтому сэмплируем КАЖДЫЙ тик в отличие от energy. measureCpu()
// вызывается из main.js в самом конце loop(), чтобы зацепить полный тик включая
// per-creep run-петлю (она идёт ПОСЛЕ visualization.process).
const CPU_WINDOWS = [
    {tau:   300, label: '300t',  warmup:   10},  // ~15 мин - спайки
    {tau:  3000, label: '3kt',   warmup:  100},  // ~2.5ч - режим
    {tau: 30000, label: '30kt',  warmup: 1000},  // ~25ч - тренд
];

// Флаг живёт ровно один global. На первом тике после reset Screeps грузит весь код
// (десятки CPU на require, до 500 CPU в этом тике разрешено) - этот спайк не имеет
// отношения к steady-state нагрузке. Пропускаем сэмпл, иначе он якорит EMA на сотни
// тиков. Reset происходит после деплоя, server-restart'а или эвикции VM.
let cpuSkipNextSample = true;

exports.measureCpu = function() {
    if (cpuSkipNextSample) {
        cpuSkipNextSample = false;
        return;
    }
    const value = Game.cpu.getUsed();
    let stats = Memory.cpu_stats;
    // v=2: миграция со старого формата без skip-first-tick - там EMA уже отравлена
    // спайком первого тика. Сбрасываем чтобы перенакопить с корректных сэмплов.
    if (!stats || stats.v !== 2) {
        Memory.cpu_stats = {ema: [value, value, value], samples: 1, v: 2};
        return;
    }
    for (let i = 0; i < CPU_WINDOWS.length; i++) {
        const alpha = 1 - Math.exp(-1 / CPU_WINDOWS[i].tau);
        stats.ema[i] = alpha * value + (1 - alpha) * stats.ema[i];
    }
    stats.samples += 1;
}

function formatCpu(v) {
    return String(Math.round(v));
}

function formatBucket(v) {
    if (v >= 1000) return Math.round(v / 1000) + 'k';
    return String(Math.round(v));
}

// World-координаты для имени комнаты вида W11S39 / E5N3. Комнаты на сетке 50×50.
// W-комнаты идут в отрицательную сторону: W0 = [-50..-1], W1 = [-100..-51] и т.д.
// N-комнаты аналогично для y.
function roomNameToWorldOrigin(roomName) {
    const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!m) return null;
    const rx = m[1] === 'W' ? -parseInt(m[2]) - 1 : parseInt(m[2]);
    const ry = m[3] === 'N' ? -parseInt(m[4]) - 1 : parseInt(m[4]);
    return {x: rx * 50, y: ry * 50};
}

function worldToRoomPos(wx, wy) {
    const rx = Math.floor(wx / 50);
    const ry = Math.floor(wy / 50);
    const tx = Math.round(wx - rx * 50);
    const ty = Math.round(wy - ry * 50);
    const xName = (rx >= 0 ? 'E' + rx : 'W' + (-rx - 1));
    const yName = (ry >= 0 ? 'S' + ry : 'N' + (-ry - 1));
    return new RoomPosition(
        Math.max(0, Math.min(49, tx)),
        Math.max(0, Math.min(49, ty)),
        xName + yName,
    );
}

// Рисует стрелку from → to на Game.map.visual: основная линия opts + несколько маленьких
// закрашенных треугольников-наконечников ВДОЛЬ линии (один на ~50 world-units, ≈ комната).
// Треугольники filled и слегка ярче основной линии, чтобы направление было видно сразу.
// perpOffset (world units) - смещение всей стрелки перпендикулярно потоку "влево". Нужно
// при встречных потоках (A→B и B→A): прокидываем +offset с обеих сторон - встречные
// стрелки оказываются по разные стороны центральной линии и не накладываются.
function drawMapArrow(from, to, opts, perpOffset = 0) {
    const fo  = roomNameToWorldOrigin(from.roomName);
    const tor = roomNameToWorldOrigin(to.roomName);
    if (!fo || !tor) {
        Game.map.visual.line(from, to, opts);
        return;
    }
    const fwx = fo.x + from.x, fwy = fo.y + from.y;
    const twx = tor.x + to.x,  twy = tor.y + to.y;
    const vx = twx - fwx, vy = twy - fwy;
    const L  = Math.sqrt(vx * vx + vy * vy);
    if (L < 10) {
        Game.map.visual.line(from, to, opts);
        return;
    }
    const ux = vx / L, uy = vy / L;

    // Perpendicular "left" of flow direction: (-uy, ux).
    const ofx = fwx - perpOffset * uy;
    const ofy = fwy + perpOffset * ux;
    const otx = twx - perpOffset * uy;
    const oty = twy + perpOffset * ux;
    const lineFrom = (perpOffset === 0) ? from : worldToRoomPos(ofx, ofy);
    const lineTo   = (perpOffset === 0) ? to   : worldToRoomPos(otx, oty);
    Game.map.visual.line(lineFrom, lineTo, opts);

    const TRI_LEN = 5;     // длина треугольника вдоль линии
    const TRI_W   = 2;     // полу-ширина у основания (2.5:1 - умеренно острый)
    const SPACING = 50;    // один треугольник на ~комнату
    const count = Math.max(2, Math.min(8, Math.floor(L / SPACING)));

    const color = opts.color || '#ffffff';
    const triOpts = {
        fill: color,
        stroke: color,
        strokeWidth: 0.3,
        opacity: Math.min(1, (opts.opacity || 0.5) + 0.4),
    };

    for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const cx = ofx + (otx - ofx) * t;
        const cy = ofy + (oty - ofy) * t;
        const tipX  = cx + (TRI_LEN / 2) * ux;
        const tipY  = cy + (TRI_LEN / 2) * uy;
        const baseX = cx - (TRI_LEN / 2) * ux;
        const baseY = cy - (TRI_LEN / 2) * uy;
        const points = [
            worldToRoomPos(tipX, tipY),
            worldToRoomPos(baseX - TRI_W * uy, baseY + TRI_W * ux),
            worldToRoomPos(baseX + TRI_W * uy, baseY - TRI_W * ux),
        ];
        Game.map.visual.poly(points, triOpts);
    }
}

// Кеш экспортированных RoomVisual для тяжёлых статичных частей (башни, стенки).
// Обновляется раз в HEAVY_VISUAL_TTL тиков, между обновлениями просто импортируется.
// Плюс сводка по барьерам (сколько ниже цели ремонта, минимум) для строки Defense панели -
// считается в том же проходе, чтобы не гонять repairTargetHits по всем рампартам каждый тик.
const HEAVY_VISUAL_TTL = 10;
const heavyVisualCache = {};

// Записи комнат, которые не рендерились дольше TTL (потеряли комнату, viz выключали), - вон:
// иначе кеш копит строки до следующего global reset. Живые записи моложе TTL не трогаем
// (запись старше TTL visualiseRoom всё равно пересоберёт).
function pruneHeavyVisualCache() {
    if (Game.time % 100 !== 0) return;
    for (const name in heavyVisualCache) {
        if (Game.time - heavyVisualCache[name].at >= HEAVY_VISUAL_TTL) delete heavyVisualCache[name];
    }
}

// Ключ кеша: режим + боевое состояние. Сменился режим (viz) или комната вошла/вышла из осады -
// пересобираем сразу, не ждём TTL (в осаде цель ремонта = hitsMax, подписи нужны сразу).
function heavyKey(room, mode) {
    return mode + (room.isDefending || room.hasHostiles ? ':war' : ':peace');
}

function buildHeavyRoomVisuals(room, mode) {
    const v = new RoomVisual(room.name);
    // Только per-tick кеши структур (их же строят defend.checkStatus/fireTower) - без своих find.
    const myByType  = utils.getMyStructuresByType(room);
    const allByType = utils.getStructuresByType(room);

    // Зоны своих башен - справочная информация, только в full.
    if (mode === 'full') {
        for (const tower of myByType[STRUCTURE_TOWER] || []) {
            // Зона полного урона (дистанция <= 5) - квадрат 11x11 клеток, tile-aligned (-0.5).
            v.rect(tower.pos.x - 5.5, tower.pos.y - 5.5, 11, 11, { fill: 'transparent', stroke: 'red',   lineStyle: 'dotted', opacity: 0.2 })
             .text('600', tower.pos.x - 5, tower.pos.y + 5, { color: 'red', font: 0.5, opacity: 0.3 })
             .text('600', tower.pos.x + 5, tower.pos.y - 5, { color: 'red', font: 0.5, opacity: 0.3 });
        }
    }

    // Вражеские башни - тревога, рисуем в обоих режимах. FIND_STRUCTURES (кеш allByType)
    // включает и чужие структуры, отделяем по my.
    for (const tower of allByType[STRUCTURE_TOWER] || []) {
        if (tower.my) continue;
        // Урон tower'и считается по Chebyshev distance (`max(|dx|,|dy|)`), поэтому
        // зона «дистанция ≤ r» - квадрат 2r×2r, а не круг. Рисуем концентрические квадраты.
        let radius = 5;
        let damage = 600;

        while (radius <= 20) {
            v.rect(tower.pos.x - radius - 0.5, tower.pos.y - radius - 0.5, radius * 2 + 1, radius * 2 + 1, {
                fill: 'transparent',
                stroke: 'red',
                lineStyle: 'dotted',
            })
            .text(damage, tower.pos.x - radius, tower.pos.y, {color: 'red', font: 1})
            .text(damage, tower.pos.x + radius, tower.pos.y, {color: 'red', font: 1})
            .text(damage, tower.pos.x, tower.pos.y + radius, {color: 'red', font: 1})
            .text(damage, tower.pos.x, tower.pos.y - radius, {color: 'red', font: 1});

            damage -= 150;
            radius += 5;
        }
    }

    // Подписи % у рампартов/стен - только у тех, что ниже цели ремонта (tasks/structure
    // repairTargetHits: мирная цель по RCL / настройка rampart_target_hits; в осаде и на RCL 8 -
    // hitsMax, т.е. в осаде подписаны все недобитые до максимума). Процент - от этой цели.
    // Раньше подписывался каждый барьер в % от RAMPART_HITS_MAX - на RCL < 8 стена из сотни
    // одинаковых "1.0%" без сигнала.
    const barriers = (allByType[STRUCTURE_RAMPART] || []).concat(allByType[STRUCTURE_WALL] || []);
    // Сводка: minHits - абсолютный минимум (для осады); worst - барьер с минимальным hits/target
    // (цели у рампартов и стен могут различаться - сравнивать абсолютные hits нельзя).
    const summary = {count: barriers.length, below: 0, minHits: null, worstHits: 0, worstTarget: 0, worstRatio: null};
    const atWar = room.isDefending || room.hasHostiles;
    for (const b of barriers) {
        const target = taskStructure.repairTargetHits(b);
        if (summary.minHits === null || b.hits < summary.minHits) summary.minHits = b.hits;
        if (target > 0) {
            const ratio = b.hits / target;
            if (summary.worstRatio === null || ratio < summary.worstRatio) {
                summary.worstRatio = ratio;
                summary.worstHits = b.hits;
                summary.worstTarget = target;
            }
        }
        if (!(b.hits < target)) continue;
        summary.below++;
        const pct = b.hits / target * 100;
        // В мире (особенно RCL 8, где цель = hitsMax) почти все барьеры "ниже цели" - подписываем
        // только просевшие ниже половины цели. В осаде - все ниже цели.
        if (!atWar && pct >= 50) continue;
        v.text(pct.toFixed(pct < 10 ? 1 : 0) + '%', b.pos.x, b.pos.y + 0.15,
               {color: pct < 50 ? '#ff4444' : '#ffaa00', font: 0.3, opacity: 1});
    }

    return {string: v.export(), barriers: summary};
}

// Тяжёлый слой комнаты: из кеша (import) или пересборка. Возвращает сводку по барьерам.
// RoomVisual рисует сразу при вызове rect/text, поэтому в тик пересборки слой уже нарисован -
// import поверх рисовал его второй раз (раньше так и было: раз в 10 тиков двойная яркость).
function drawHeavyVisuals(room, mode) {
    const key = heavyKey(room, mode);
    const cached = heavyVisualCache[room.name];
    if (cached && cached.key === key && Game.time - cached.at < HEAVY_VISUAL_TTL) {
        room.visual.import(cached.string);
        return cached.barriers;
    }
    const built = buildHeavyRoomVisuals(room, mode);
    heavyVisualCache[room.name] = {string: built.string, barriers: built.barriers, key, at: Game.time};
    return built.barriers;
}

// lab_status пишет lab.runReaction раз в 10 тиков, но не на всех путях: при врагах в комнате
// (hasHostiles) и без лаб-кластера он выходит раньше updateLabStatus - статус замирает.
// Старше LAB_STATUS_STALE тиков показываем серым с возрастом, а не как живой.
const LAB_STATUS_STALE = 30;
const LAB_STALE_COLOR = '#888888';

function labStatusAge(ls) {
    return Game.time - (ls.at || 0);
}

// --- Панель комнаты ---------------------------------------------------------------------------
//
// Строки собираются секциями (Eco / Def / Prod / Spawn). Каждая секция отдаёт пункты
// {lvl, text, color?}:
//   OK    - норма: все OK-пункты секции сворачиваются в одну тусклую строку;
//   INFO  - заметное состояние без тревоги (лабы работают, сквад power bank'а в пути) - своя строка;
//   WARN  - жёлтым, ALARM - красным, каждая своей строкой.
// viz_mode 'min' - только заголовок и WARN/ALARM (с меткой секции), 'full' - всё.
const LVL_OK = 0, LVL_INFO = 1, LVL_WARN = 2, LVL_ALARM = 3;
const LVL_COLOR = ['#aaaaaa', '#88ccff', '#ffcc44', '#ff5555'];
const PANEL_FONT = 0.5;
const PANEL_LINE = 0.7;      // межстрочный шаг в клетках
const OK_OPACITY = 0.55;     // тусклая свёрнутая строка нормы

function item(lvl, text, color) {
    return {lvl, text, color};
}

// Lazy-индекс крипов по роли на тик: один проход по Game.creeps и только если панели он нужен
// (wall_break / expansion). Module-level, ключ - Game.time.
let roleIndexTick = -1;
let roleIndex = null;
function creepsOfRole(role) {
    if (roleIndexTick !== Game.time) {
        roleIndex = {};
        for (const name in Game.creeps) {
            const r = Game.creeps[name].memory.role;
            (roleIndex[r] || (roleIndex[r] = [])).push(Game.creeps[name]);
        }
        roleIndexTick = Game.time;
    }
    return roleIndex[role] || [];
}

// Economy: энергия спавна, запас (+ EWMA и класс для балансировки), storage, терминал,
// пауза майнинга, удалённые комнаты.
function economyItems(room, ctx) {
    const out = [];
    out.push(item(LVL_OK, `⚡ ${room.energyAvailable}/${room.energyCapacityAvailable}`));

    const total = ctx.total;
    const stats = room.memory.energy_stats;
    let rates = '';
    if (stats) {
        // Δ e/t за окна 300t/3kt/30kt (EWMA из sampleRoomStats), до прогрева окна - прочерк.
        rates = ' Δ' + ENERGY_WINDOWS.map((w, i) => stats.samples >= w.warmup ? formatRate(stats.ema[i]) : '—').join('/');
    }
    // Тот же класс, что у resourceBalance (rich/poor/neutral), на уже посчитанном total.
    const wealth = resourceBalance.classifyEnergy(room, total);
    if (wealth === 'poor') {
        out.push(item(LVL_WARN, `🔋 ${formatEnergyCompact(total)}${rates} poor (< ${formatEnergyCompact(settings.get(null, 'rb_poor_stored_energy'))})`));
    } else {
        out.push(item(LVL_OK, `🔋 ${formatEnergyCompact(total)}${rates}${wealth === 'rich' ? ' rich' : ''}`));
    }

    if (room.storage) {
        const cap = room.storage.store.getCapacity() || 1;
        const pct = Math.round(room.storage.store.getUsedCapacity() / cap * 100);
        const lvl = pct >= 98 ? LVL_ALARM : pct >= 90 ? LVL_WARN : LVL_OK;
        out.push(item(lvl, `📦 storage ${pct}%`));
    }

    if (room.terminal) {
        const te = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
        const reserve = settings.get(room, 'terminal_energy_reserve');
        const free = room.terminal.store.getFreeCapacity();
        if (free < 5000) {
            out.push(item(LVL_WARN, `💱 terminal full (${formatEnergyCompact(free)} free)`));
        } else if (reserve > 0 && te < reserve / 2) {
            // Чарджер доливает резерв из storage; ниже половины - storage пуст или чарджер не успевает.
            out.push(item(LVL_WARN, `💱 terminal E ${formatEnergyCompact(te)} < reserve ${formatEnergyCompact(reserve)}`));
        } else {
            out.push(item(LVL_OK, `💱 E ${formatEnergyCompact(te)}/${formatEnergyCompact(reserve)}`));
        }
    }

    // То же условие, что в roles/miner.js spawn: total > miner_pause_total_energy.
    const pause = settings.get(room, 'miner_pause_total_energy');
    if (total > pause) {
        out.push(item(LVL_WARN, `⛏ mining paused: ${formatEnergyCompact(total)} > ${formatEnergyCompact(pause)}`));
    }

    // Удалённые комнаты (reserver/harvester). Reservation видна только при видимости комнаты.
    const remotes = settings.get(room, 'remote_rooms');
    if (remotes && remotes.length) {
        const me = room.controller.owner && room.controller.owner.username;
        let worst = LVL_OK;
        const parts = [];
        for (const name of remotes) {
            const r = Game.rooms[name];
            const c = r && r.controller;
            if (!c) { parts.push(`${name} ?`); continue; }
            const res = c.reservation;
            if (c.owner) {
                worst = LVL_ALARM; parts.push(`${name} owned:${c.owner.username}`);
            } else if (!res) {
                worst = Math.max(worst, LVL_WARN); parts.push(`${name} unreserved`);
            } else if (res.username !== me) {
                worst = LVL_ALARM; parts.push(`${name} R:${res.username}`);
            } else {
                if (res.ticksToEnd < 1000) worst = Math.max(worst, LVL_WARN);
                parts.push(`${name} ${formatTicks(res.ticksToEnd)}`);
            }
        }
        out.push(item(worst, `🌾 ${parts.join(', ')}`));
    }
    return out;
}

// Defense: режим обороны / враги / hold-down, safe mode, downgrade контроллера, барьеры.
function defenseItems(room, ctx) {
    const out = [];
    const mem = room.memory;
    const c = room.controller;
    const enemies = mem.enemy_creeps || 0;

    if (room.isDefending) {
        // Врагов уже нет - держит hold-down defend.checkStatus (DEFEND_HOLD_TICKS после последней угрозы).
        const sinceAttack = mem.last_attack_at !== undefined ? Game.time - mem.last_attack_at : null;
        const holdLeft = sinceAttack !== null ? taskDefend.DEFEND_HOLD_TICKS - sinceAttack : 0;
        const text = enemies > 0
            ? `⚔ DEFENDING: ${enemies} enemies`
            : `⚔ DEFENDING: hold-down ${Math.max(0, holdLeft)}t`;
        out.push(item(LVL_ALARM, text));
    } else if (enemies > 0) {
        out.push(item(LVL_ALARM, `⚔ ${enemies} enemies`));
    } else {
        const ago = mem.last_attack_at !== undefined ? ` (attack ${formatTicks(Game.time - mem.last_attack_at)}t ago)` : '';
        out.push(item(LVL_OK, `⚔ peace${ago}`));
    }

    // Safe mode: активен - выделяем; иначе запас/cooldown и причина блокировки по тем же
    // проверкам, что у авто-активации (defend.safeModeBlockReason: настройка, cooldown, заряды,
    // upgradeBlocked, downgrade, safe mode в другой комнате). В бою заблокированный - предупреждение.
    if (c.safeMode) {
        out.push(item(LVL_WARN, `🛡 SAFE MODE ${formatTicks(c.safeMode)}t left`));
    } else {
        const reason = taskDefend.safeModeBlockReason(room);
        const parts = [`🛡 SM ×${c.safeModeAvailable || 0}`];
        if (c.safeModeCooldown) parts.push(`cd ${formatTicks(c.safeModeCooldown)}t`);
        if (reason && reason !== 'cooldown' && reason !== 'no charges') parts.push(reason);
        out.push(item(room.isDefending && reason ? LVL_WARN : LVL_OK, parts.join(' ')));
    }

    // Downgrade: tasks/room ставит need_maintain_controller в мире ниже 95% (штатная подкормка -
    // не показываем), а ниже 80% - и в осаде; 80% и есть порог WARN "подкормка не успевает".
    // Ниже 50% - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD движок не даст safe mode (defend.js).
    const max = CONTROLLER_DOWNGRADE[c.level];
    if (max && c.ticksToDowngrade !== undefined) {
        const smLimit = max / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD;
        if (c.ticksToDowngrade < smLimit) {
            out.push(item(LVL_ALARM, `⏬ downgrade ${formatTicks(c.ticksToDowngrade)}t: safe mode blocked`));
        } else if (c.ticksToDowngrade < max * 0.8) {
            out.push(item(LVL_WARN, `⏬ downgrade ${formatTicks(c.ticksToDowngrade)}/${formatTicks(max)}t`));
        }
    }

    // Барьеры - сводка из тяжёлого слоя (пересчёт раз в HEAVY_VISUAL_TTL).
    const b = ctx.barriers;
    if (b && b.count > 0) {
        if (room.isDefending || room.hasHostiles) {
            out.push(item(LVL_INFO, `🧱 min ${formatEnergyCompact(b.minHits)}`));
        } else if (b.below === 0) {
            out.push(item(LVL_OK, `🧱 ${b.count} at target`));
        } else {
            // Ниже половины цели startRepairClosestStructs уже берёт барьер в ремонт - это
            // не просто "растёт к цели", а дыра. Худший - по hits/target, не по абсолютным hits.
            const lvl = b.worstRatio !== null && b.worstRatio < 0.5 ? LVL_WARN : LVL_OK;
            out.push(item(lvl, `🧱 ${b.below}/${b.count} below target, worst ${formatEnergyCompact(b.worstHits)}/${formatEnergyCompact(b.worstTarget)}`));
        }
    }
    return out;
}

// Строка лаб (тексты и цвета как раньше, плюс уровень для свёртки/min).
function labItem(room) {
    const ls = room.memory.lab_status;
    if (!ls || !ls.output || !(ls.total > 0)) return null;
    let text, color, lvl;
    if (ls.forceEvac) {
        text = `🧪 ${ls.output}: stuck too long, evacuating labs`; color = '#ff66ff'; lvl = LVL_ALARM;
    } else if (ls.dirty > 0) {
        text = `🧪 ${ls.output}: ${ls.dirty}/${ls.total} dirty (wrong mineral)`; color = 'orange'; lvl = LVL_WARN;
    } else if (ls.stuck > 0) {
        text = `🧪 ${ls.output}: ${ls.stuck}/${ls.total} stuck (storage+terminal full)`; color = '#ff5555'; lvl = LVL_ALARM;
    } else if (ls.sourceLow) {
        text = `🧪 ${ls.output}: idle (no input mineral)`; color = 'yellow'; lvl = LVL_WARN;
    } else {
        text = `🧪 ${ls.output}: ${ls.runnable + ls.cooling}/${ls.total} active`; color = '#88ccff'; lvl = LVL_INFO;
    }
    const age = labStatusAge(ls);
    if (age > LAB_STATUS_STALE) {
        // Устаревший статус - не тревога: в бою лабы стоят штатно.
        text += ` (stale ${age}t${room.hasHostiles ? ', hostiles' : ''})`;
        color = LAB_STALE_COLOR; lvl = LVL_OK;
    }
    return item(lvl, text, color);
}

// Почему nuker не доливается - причина из tasks/resource.nukerFillBlockReason (тот же код, что
// у nukerFillSafe), здесь только текст. null - доливается.
function nukerFillBlock(room, total) {
    const reason = taskResource.nukerFillBlockReason(room, total);
    if (reason === 'energy') return `fill at ${formatEnergyCompact(settings.get(room, 'nuker_fill_min_total_energy'))}`;
    if (reason === 'peace') {
        return `peace ${formatTicks(Game.time - room.memory.last_attack_at)}/${formatTicks(settings.get(room, 'nuker_fill_peace_ticks'))}t`;
    }
    return reason;
}

// Production: лабы, power (power spawn, оператор), power bank сквады этой комнаты, nuker.
function productionItems(room, ctx) {
    const out = [];
    const myByType = utils.getMyStructuresByType(room);

    const lab = labItem(room);
    if (lab) out.push(lab);

    const ps = (myByType[STRUCTURE_POWER_SPAWN] || [])[0];
    const opEntry = Memory.operators && Memory.operators[room.name];
    if (ps || opEntry) {
        if (settings.get(room, 'power_disabled')) {
            out.push(item(LVL_OK, '⚛ power off'));
        } else if (ps) {
            const p = ps.store.getUsedCapacity(RESOURCE_POWER);
            const e = ps.store.getUsedCapacity(RESOURCE_ENERGY);
            const burning = p >= 1 && e >= POWER_SPAWN_ENERGY_RATIO;
            out.push(item(LVL_OK, `⚛ PS ${p}P ${formatEnergyCompact(e)}E${burning ? '' : ' idle'}`));
        }
        if (opEntry) {
            const pc = Game.powerCreeps[opEntry.name];
            if (!pc) out.push(item(LVL_WARN, `⚛ operator ${opEntry.name} missing`));
            else if (pc.ticksToLive) out.push(item(LVL_OK, `op L${pc.level} ${formatTicks(pc.ticksToLive)}t`));
            else out.push(item(LVL_INFO, `⚛ operator ${pc.name} not spawned`));
        }
    }

    // Power bank'и, которые обслуживает эта комната (home_room).
    if (Memory.power_banks) {
        for (const id in Memory.power_banks) {
            const bank = Memory.power_banks[id];
            if (bank.home_room !== room.name) continue;
            if (bank.status !== 'attacking' && bank.status !== 'looting' && bank.status !== 'stealing') continue;
            out.push(item(LVL_INFO, `🏦 PB ${bank.roomName} ${bank.status} ${Math.round((bank.hits || 0) / 1000)}k`));
        }
    }

    const nuker = (myByType[STRUCTURE_NUKER] || [])[0];
    if (nuker) {
        const e = nuker.store.getUsedCapacity(RESOURCE_ENERGY);
        const g = nuker.store.getUsedCapacity(RESOURCE_GHODIUM);
        const eFull = nuker.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
        const gFull = nuker.store.getFreeCapacity(RESOURCE_GHODIUM) === 0;
        if (eFull && gFull && !nuker.cooldown) {
            out.push(item(LVL_OK, '☢ ready'));
        } else if (eFull && gFull) {
            out.push(item(LVL_OK, `☢ cd ${formatTicks(nuker.cooldown)}t`));
        } else {
            const block = nukerFillBlock(room, ctx.total);
            out.push(item(LVL_OK, `☢ E ${formatEnergyCompact(e)} G ${g}${block ? ' (' + block + ')' : ''}`));
        }
    }
    return out;
}

// Есть ли свежая нужда спавна, на которую не хватает energyAvailable.
function spawnEnergyShort(room, needs) {
    for (const n of needs) if (room.energyAvailable < n.needed) return true;
    return false;
}

// Spawn: нужды цепочки и модулей (utils.freshSpawnNeeds), занятость спавнов, wall_break,
// экспансия (в одной "первой" комнате - статус глобальный).
function spawnItems(room, ctx) {
    const out = [];
    const spawns = utils.getMyStructuresByType(room)[STRUCTURE_SPAWN] || [];
    if (spawns.length === 0) {
        out.push(item(LVL_ALARM, '🥚 no spawn'));
    } else {
        const busy = spawns.filter(s => s.spawning).length;
        out.push(item(LVL_OK, `🥚 ${busy}/${spawns.length} busy`));
    }

    // Первой - нужда spawn-цепочки, за ней нужды модулей коротко (формат #19). Тревога - если
    // энергии не хватает ЛЮБОЙ из свежих нужд (не только первой: первая может быть уже queued).
    const needs = utils.freshSpawnNeeds(room.memory);
    if (needs.length > 0) {
        const need = needs[0];
        const have = room.energyAvailable;
        const enough = have >= need.needed;
        const short = spawnEnergyShort(room, needs);
        const more = needs.slice(1).map(n => `  +${n.role} ${n.needed}e`).join('');
        out.push(item(short ? LVL_WARN : LVL_INFO,
            `⏳ Spawn ${need.role}: ${have}/${need.needed}e` + (enough ? ' (queued)' : '') + more,
            short ? '#ffaa00' : '#88ff88'));
    }

    const wb = Memory.wall_break;
    if (wb && wb.home_room === room.name && wb.target_room) {
        const breakerOut = creepsOfRole('wall_breaker').length > 0;
        out.push(item(LVL_INFO, `🔨 wall_break → ${wb.target_room}${breakerOut ? ' (breaker out)' : ' (waiting)'}`));
    }

    if (ctx.primary) {
        const expand = Game.flags['Expand'];
        const status = Memory.expansion && Memory.expansion.status;
        if (expand || (status && status !== 'idle')) {
            const target = expand ? expand.pos.roomName : '?';
            // RU - только текущей цели (как remoteUpgrader.spawn): RU прошлой экспансии доживают TTL
            // в своей комнате. Claimer - все: claimer.spawn тоже считает их без фильтра (один на аккаунт).
            const ru = creepsOfRole('remote_upgrader').filter(cr => expand && cr.memory.target_room == expand.pos.roomName).length;
            const crew = `claimer ${creepsOfRole('claimer').length}, RU ${ru}`;
            out.push(item(expand ? LVL_INFO : LVL_WARN, `⛳ expand ${target}: ${status || '?'} (${crew})`));
        }
    }
    return out;
}

const PANEL_SECTIONS = [
    ['Eco',   economyItems],
    ['Def',   defenseItems],
    ['Prod',  productionItems],
    ['Spawn', spawnItems],
];

// Строки панели [{text, color, opacity}] - отдельно от рисования (так проще тестировать и
// раскладывать: высота известна до первого text()).
function buildPanelLines(room, ctx) {
    const full = ctx.mode === 'full';
    const c = room.controller;
    const lines = [];

    // Заголовок: комната, RCL/прогресс, E/t (EWMA upgrade_stats из sampleRoomStats).
    const isMaxLevel = !c.progressTotal;
    const us = room.memory.upgrade_stats;
    const eT = (!isMaxLevel && us && us.samples > 0) ? us.rate.toFixed(1) : '—';
    const rcl = isMaxLevel ? 'RCL 8' : `RCL ${c.level} ${(c.progress / c.progressTotal * 100).toFixed(2)}%`;
    const header = {text: full ? `🏰 ${room.name}  ${rcl}  〽️ E/t ${eT}` : `🏰 ${room.name}  ${rcl}`, color: '#ffffff', opacity: 0.9};
    lines.push(header);

    let alarms = 0;
    for (const [label, fn] of PANEL_SECTIONS) {
        let items;
        try {
            items = fn(room, ctx);
        } catch (err) {
            // Одна сломанная секция (нет данных, неожиданная Memory) не гасит панель.
            err.log();
            items = [item(LVL_WARN, `viz error: ${err.message}`)];
        }
        const ok = items.filter(i => i.lvl === LVL_OK);
        const rest = items.filter(i => i.lvl !== LVL_OK && (full || i.lvl >= LVL_WARN));
        for (const i of rest) if (i.lvl >= LVL_WARN) alarms++;
        if (!full) {
            for (const i of rest) lines.push({text: `${label}: ${i.text}`, color: i.color || LVL_COLOR[i.lvl], opacity: 1});
            continue;
        }
        let first = true;
        if (ok.length) {
            lines.push({text: `${label}: ${ok.map(i => i.text).join(' · ')}`, color: LVL_COLOR[LVL_OK], opacity: OK_OPACITY});
            first = false;
        }
        for (const i of rest) {
            lines.push({text: `${first ? label + ': ' : '    '}${i.text}`, color: i.color || LVL_COLOR[i.lvl], opacity: 1});
            first = false;
        }
    }
    if (!full && alarms === 0) header.text += '  ✓';
    return lines;
}

function visualiseRoom(room, ctx) {
    const controller = room.controller;
    if (!controller || !controller.my) return;

    // Тяжёлые статичные визуалы (башни, подписи барьеров) - пересчёт раз в 10 тиков.
    const barriers = drawHeavyVisuals(room, ctx.mode);

    const roomCtx = {mode: ctx.mode, primary: ctx.primary === room.name, total: totalEnergy(room), barriers};
    const lines = buildPanelLines(room, roomCtx);

    // Раскладка: справа от контроллера; у нижнего края - сдвигаем вверх, чтобы не вылезти за 49.
    const pos = controller.pos;
    const x = pos.x + 1;
    let y = pos.y;
    const height = (lines.length - 1) * PANEL_LINE;
    if (y + height > 49) y = Math.max(0.5, 49 - height);
    for (const l of lines) {
        room.visual.text(l.text, x, y, {align: 'left', color: l.color, opacity: l.opacity, font: PANEL_FONT});
        y += PANEL_LINE;
    }

    // Нюки - редкие, но timeToLand тикает каждый тик. Тревога - в обоих режимах.
    const nukes = room.find(FIND_NUKES);
    for (const nuke of nukes) {
        const npos = nuke.pos;
        const nukesAtSpot = nuke.room.lookForAt(LOOK_NUKES, nuke);

        room.visual.rect(npos.x - 2.5, npos.y - 2.5, 5, 5, {
            fill: '#FF0000',
            opacity: 0.2,
            stroke: 'red',
            lineStyle: 'dotted',
        })
        .text(nukesAtSpot.length, npos.x, npos.y + 0.3, {font: 0.5});

        for (let i = 0; i < nukesAtSpot.length; i++) {
            room.visual.text(nukesAtSpot[i].timeToLand, npos.x - 2.4, npos.y - 2 + i / 2, {font: 0.5, color: "yellow", align: "left"});
        }
    }

    // Per-tick кеш безопасен: позиции врагов внутри одного тика статичны. Шарится с defend.checkStatus.
    const enemies = room.cache('hostileCreeps', r => r.find(FIND_HOSTILE_CREEPS));
    for (const enemy of enemies) {
        let heal = 0, ranged_heal = 0, attack = 0, ranged_attack = 0;
        for (const part of enemy.body) {
            if (part.type == HEAL) {
                heal         += HEAL_POWER        * (part.boost ? BOOSTS[HEAL][part.boost][HEAL]            : 1);
                ranged_heal  += RANGED_HEAL_POWER * (part.boost ? BOOSTS[HEAL][part.boost]["rangedHeal"]    : 1);
            } else if (part.type == ATTACK) {
                attack       += ATTACK_POWER        * (part.boost ? BOOSTS[ATTACK][part.boost][ATTACK]      : 1);
            } else if (part.type == RANGED_ATTACK) {
                ranged_attack += RANGED_ATTACK_POWER * (part.boost ? BOOSTS[RANGED_ATTACK][part.boost]["rangedAttack"] : 1);
            }
        }
        room.visual.text(attack + "-" + ranged_attack, enemy.pos.x, enemy.pos.y - 0.1, {color: 'red', font: 0.4, opacity: 1})
        room.visual.text(heal + "-" + ranged_heal, enemy.pos.x, enemy.pos.y + 0.5, {color: 'green', font: 0.4, opacity: 1})
    }
}

// --- Карта ------------------------------------------------------------------------------------

// Строка иконок своей комнаты внизу клетки карты. Рисуются только иконки в "интересном"
// состоянии, слева направо без дыр; ⚡ (класс энергии) - всегда. Символы с U+FE0E
// (text-presentation), чтобы рендерер не подменял на цветной emoji и color применялся;
// у 🧪 текстового варианта нет - цвет даёт кружок-подложка.
const MAP_ICON_Y = 45;
const MAP_ICON_STEP = 7;
const MAP_ICON_FONT = 7;

function mapIcons(room, total) {
    const icons = [];
    const c = room.controller;
    const mem = room.memory;

    const wealth = resourceBalance.classifyEnergy(room, total);
    icons.push({ch: '⚡︎', color: wealth === 'rich' ? '#00FF00' : wealth === 'poor' ? '#FF4444' : '#AAAAAA'});

    if (room.isDefending || mem.enemy_creeps > 0) icons.push({ch: '⚔︎', color: '#FF4444'});
    if (c.safeMode) icons.push({ch: '🛡︎', color: '#FFCC44'});
    if (total > settings.get(room, 'miner_pause_total_energy')) icons.push({ch: '⛏︎', color: '#FFCC44'});

    const ls = mem.lab_status;
    if (ls && ls.output && ls.total > 0) {
        let color;
        if (labStatusAge(ls) > LAB_STATUS_STALE) color = LAB_STALE_COLOR;
        else if (ls.forceEvac)  color = '#ff66ff';
        else if (ls.dirty > 0)  color = '#ffaa00';
        else if (ls.stuck > 0)  color = '#ff5555';
        else if (ls.sourceLow)  color = '#ffff00';
        else                    color = '#88ccff';
        icons.push({ch: '🧪', color, disc: true});
    }

    const nuker = (utils.getMyStructuresByType(room)[STRUCTURE_NUKER] || [])[0];
    if (nuker) {
        const ready = nuker.store.getFreeCapacity(RESOURCE_ENERGY) === 0
                   && nuker.store.getFreeCapacity(RESOURCE_GHODIUM) === 0
                   && !nuker.cooldown;
        icons.push({ch: '☢︎', color: ready ? '#00FF00' : '#FF0000'});
    }

    // Спавн ждёт энергии: нехватка хотя бы по одной свежей нужде (а не только "queued").
    if (spawnEnergyShort(room, utils.freshSpawnNeeds(mem))) icons.push({ch: '⏳︎', color: '#FFAA00'});
    return icons;
}

function visualiseMap(room, ctx) {
    if (!room.controller || !room.controller.my) return;
    const total = totalEnergy(room);

    if (ctx.mode === 'full') {
        // RCL + энергия спавна одной строкой; запас + 3 окна EWMA - второй (Δ = net e/t).
        const c = room.controller;
        const rcl = c.progressTotal ? `${c.level}·${(c.progress / c.progressTotal * 100).toFixed(0)}%` : '8';
        Game.map.visual.text(`🏰${rcl} ⚡${formatEnergyCompact(room.energyAvailable)}/${formatEnergyCompact(room.energyCapacityAvailable)}`,
            new RoomPosition(0, 4, room.name), {align: 'left', fontSize: 6});
        const stats = room.memory.energy_stats;
        const energyParts = [`🔋${formatEnergyCompact(total)}`, 'Δ'];
        if (stats) {
            for (let i = 0; i < ENERGY_WINDOWS.length; i++) {
                energyParts.push(stats.samples >= ENERGY_WINDOWS[i].warmup ? formatRate(stats.ema[i]) : '—');
            }
        }
        Game.map.visual.text(energyParts.join(' '), new RoomPosition(0, 10, room.name), {align: 'left', fontSize: 6});

        // Выход лаб текстом над строкой иконок (цвет - у иконки 🧪).
        const ls = room.memory.lab_status;
        if (ls && ls.output && ls.total > 0) {
            Game.map.visual.text(ls.output, new RoomPosition(0, 38, room.name), {align: 'left', fontSize: 5, color: '#88ccff', opacity: 0.8});
        }
    }

    const icons = mapIcons(room, total);
    for (let i = 0; i < icons.length; i++) {
        const pos = new RoomPosition(2 + i * MAP_ICON_STEP, MAP_ICON_Y, room.name);
        if (icons[i].disc) Game.map.visual.circle(pos, {radius: 3, fill: icons[i].color, opacity: 0.35, stroke: 'transparent'});
        Game.map.visual.text(icons[i].ch, pos, {color: icons[i].color, align: 'center', fontSize: MAP_ICON_FONT});
    }
}

// Глобальные строки - один раз за тик, в "первой" своей комнате (минимальное имя).
// CPU: ⚙ <300t> <3kt> <30kt> b<bucket>, bucket красный когда < 3000 - бот проедает буфер.
// full: + GPL (свободные уровни) и слоты power bank'ов (как в powerBank.process).
function visualiseGlobalMap(roomName, ctx) {
    const cpuStats = Memory.cpu_stats;
    const cpuParts = ['⚙'];
    if (cpuStats) {
        for (let i = 0; i < CPU_WINDOWS.length; i++) {
            cpuParts.push(cpuStats.samples >= CPU_WINDOWS[i].warmup ? formatCpu(cpuStats.ema[i]) : '—');
        }
    } else {
        cpuParts.push('—', '—', '—');
    }
    cpuParts.push('b' + formatBucket(Game.cpu.bucket));
    const cpuColor = Game.cpu.bucket < 3000 ? '#ff6666' : '#ffffff';
    Game.map.visual.text(cpuParts.join(' '), new RoomPosition(0, 16, roomName), {align: 'left', fontSize: 6, color: cpuColor});

    if (ctx.mode !== 'full') return;
    const parts = [];
    let color = '#aaaaaa';
    if (Game.gpl && Game.gpl.level > 0) {
        // Занятые уровни как в modules/power usedPowerLevels: 1 за PC + его уровень.
        let used = 0;
        for (const name in Game.powerCreeps) used += 1 + Game.powerCreeps[name].level;
        parts.push(`GPL${Game.gpl.level} free ${Game.gpl.level - used}`);
    }
    if (settings.get(null, 'power_bank_disabled')) {
        parts.push('PB off');
        color = '#ffcc44';
    } else {
        let active = 0;
        for (const id in Memory.power_banks) {
            const s = Memory.power_banks[id].status;
            if (s === 'attacking' || s === 'looting') active++;
        }
        parts.push(`PB ${active}/${settings.get(null, 'power_bank_max_active')}`);
    }
    Game.map.visual.text(parts.join(' '), new RoomPosition(0, 22, roomName), {align: 'left', fontSize: 6, color});
}

// Флаг Expand: контур будущей базы 13x13 в комнате флага. RoomVisual по имени комнаты работает
// и без видимости (цель экспансии обычно не наша и не видна). Плюс статус экспансии - подписью
// над контуром и строкой на карте в клетке целевой комнаты.
function visualiseExpandFlag() {
    const expand = Game.flags['Expand'];
    if (!expand) return;
    const status = (Memory.expansion && Memory.expansion.status) || '?';
    // 13x13 tile-aligned (-0.5 offset, size=13) - то же, что у base preview.
    new RoomVisual(expand.pos.roomName)
        .rect(expand.pos.x - 6.5, expand.pos.y - 6.5, 13, 13,
            {fill: 'transparent', stroke: 'green', lineStyle: 'dotted', opacity: 0.7})
        .text(`Expand: ${status}`, expand.pos.x, expand.pos.y - 7, {color: 'green', font: 0.6, align: 'center'});
    Game.map.visual.text(`⛳ ${status}`, new RoomPosition(1, 40, expand.pos.roomName), {align: 'left', fontSize: 6, color: '#44ff88'});
}

// Рисует на карте потоки T1 минералов между лаб-комнатами по статической топологии
// из modules/lab.js (require/produce/mineral). Источник для каждого require выбирается
// так же, как в lab.transferResourcesBetweenRooms: сначала комната, где produce совпадает,
// иначе — где mineral совпадает (raw).
function visualiseLabFlows() {
    const labRooms = lab.rooms;
    if (!labRooms) return;

    const findProducer = (mineral, excludeName) => {
        for (const name in labRooms) {
            if (name == excludeName) continue;
            if (labRooms[name].produce == mineral) return name;
        }
        for (const name in labRooms) {
            if (name == excludeName) continue;
            if (labRooms[name].mineral == mineral) return name;
        }
        return null;
    };

    for (const consumerName in labRooms) {
        const requires = labRooms[consumerName].require || [];
        for (let i = 0; i < requires.length; i++) {
            const mineral = requires[i];
            const producerName = findProducer(mineral, consumerName);
            if (!producerName) continue;

            const from = new RoomPosition(25, 25, producerName);
            const to   = new RoomPosition(25, 25, consumerName);
            const ARROW_OFFSET = 3;   // смещение стрелки "влево" от потока в world units
            const LABEL_OFFSET = 6;   // лейбл за стрелкой (дальше от центра)
            drawMapArrow(from, to, {color: '#88ccff', width: 0.6, opacity: 0.5, lineStyle: 'dashed'}, ARROW_OFFSET);

            // Лейбл на середине стрелки, тоже "влево" от потока (за стрелкой). Встречные
            // стрелки (W9S39 ↔ W9S37) разъезжаются по разные стороны центральной линии -
            // и сами стрелки, и их лейблы не накладываются.
            const fo  = roomNameToWorldOrigin(producerName);
            const tor = roomNameToWorldOrigin(consumerName);
            if (fo && tor) {
                const vx = (tor.x + 25) - (fo.x + 25);
                const vy = (tor.y + 25) - (fo.y + 25);
                const L  = Math.sqrt(vx * vx + vy * vy);
                if (L > 0) {
                    const ux = vx / L, uy = vy / L;
                    const mx = fo.x + 25 + vx / 2 - LABEL_OFFSET * uy;
                    const my = fo.y + 25 + vy / 2 + LABEL_OFFSET * ux;
                    Game.map.visual.text(mineral, worldToRoomPos(mx, my), {color: '#88ccff', fontSize: 7, align: 'center'});
                }
            }
        }
    }
}

// Превью базы из Memory.base_previews. Формат:
//   Memory.base_previews = [{roomName, x, y, name?}, ...]
// (x, y) - центр будущей базы (та же конвенция, что у Game.flags['Expand']:
// claimer.js строит спавн в expand.pos.x + 2). База - квадрат 13x13 с центром
// в (x, y), спавн получится в (x+2, y).
function visualizeBasePreview() {
    const previews = Memory.base_previews;
    if (!previews) return;
    const list = Array.isArray(previews) ? previews : [previews];

    // Спавн в схеме сидит на (8, 6), центр 13x13 - на (6, 6). Спавн смещён
    // на +2 east от центра. Анкор-точка (preview.x, preview.y) = центр базы,
    // спавн строится в (preview.x + 2, preview.y) - так же, как в claimer.js.
    const HALF = 6;
    const SIZE = 13;

    for (const preview of list) {
        if (!preview || !preview.roomName || preview.x == null || preview.y == null) continue;

        const roomName = preview.roomName;
        const visual = new RoomVisual(roomName);

        const xMin = preview.x - HALF;
        const yMin = preview.y - HALF;
        const spawnX = preview.x + 2;
        const spawnY = preview.y;

        // Проверяем терраин (работает без видимости комнаты).
        const terrain = Game.map.getRoomTerrain(roomName);
        let conflicts = 0;
        // Все плохие клетки красим одинаково, чтобы было видно. Различаем причину
        // только в логике подсчёта conflicts (пользователю достаточно увидеть, где).
        const badCells = [];

        for (let dy = 0; dy < SIZE; dy++) {
            for (let dx = 0; dx < SIZE; dx++) {
                const wx = xMin + dx;
                const wy = yMin + dy;
                // Exit-зона 2 клетки: строки/столбцы 0,1 и 48,49 не позволяют ставить
                // структуры (createConstructionSite вернёт ERR_INVALID_TARGET).
                // wx < 0 / wx > 49 - footprint вылез за границу комнаты целиком, тоже считаем bad.
                if (wx < 2 || wx > 47 || wy < 2 || wy > 47) {
                    badCells.push([wx, wy]);
                    conflicts++;
                    continue;
                }
                if (terrain.get(wx, wy) & TERRAIN_MASK_WALL) {
                    badCells.push([wx, wy]);
                    conflicts++;
                }
            }
        }

        // Заливка плохих клеток. Off-room (wx<0 или wx>49) не рисуем -
        // их всё равно прижмёт к одному и тому же краю и получится яркая полоса.
        // Конфликт уже виден по красному контуру и счётчику в статусе.
        for (const [x, y] of badCells) {
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            visual.rect(x - 0.5, y - 0.5, 1, 1, {fill: '#ff0000', opacity: 0.35});
        }

        // Контур 13x13.
        const okColor = conflicts == 0 ? '#44ff88' : '#ff6666';
        visual.rect(xMin - 0.5, yMin - 0.5, SIZE, SIZE, {
            fill: 'transparent', stroke: okColor, lineStyle: 'dashed', opacity: 0.8,
        });

        // Overlay структур из schemes 1..8.
        const schemes = buildModule.schemes;
        // Уровень самый высокий, который выводим - все структуры собираются кумулятивно.
        for (let lvl = 1; lvl <= 8; lvl++) {
            const scheme = schemes[lvl];
            if (!scheme) continue;
            for (let sy = 0; sy < scheme.length; sy++) {
                for (let sx = 0; sx < scheme[sy].length; sx++) {
                    const s = scheme[sy][sx];
                    if (!s) continue;
                    const wx = xMin + sx;
                    const wy = yMin + sy;
                    if (wx < 0 || wx > 49 || wy < 0 || wy > 49) continue;
                    const label = STRUCTURE_PREVIEW_LABEL[s];
                    if (!label) continue;
                    visual.text(label.ch, wx, wy + 0.2, {color: label.color, font: 0.5, opacity: 0.9});
                }
            }
        }

        // Подпись над верхней гранью: имя превью (если задано) и статус.
        const tag = preview.name ? `${preview.name}: ` : '';
        const status = conflicts == 0
            ? `${tag}Base fits ✓ (center ${preview.x},${preview.y} → spawn ${spawnX},${spawnY})`
            : `${tag}Conflict ✗ (${conflicts} bad cells)`;
        visual.text(status, preview.x, yMin - 0.7, {color: okColor, font: 0.6, align: 'center'});

        // Подсветка клетки будущего спавна (оранжевый круг).
        visual.circle(spawnX, spawnY, {radius: 0.4, fill: '#ffaa00', opacity: 0.5});

        // Маркер центра базы = место для флага Expand. Маленькая точка, без подписи -
        // чтобы не отвлекало.
        visual.circle(preview.x, preview.y, {radius: 0.15, fill: '#00ddff', opacity: 0.6});
    }
}

// Маркер пригодности комнаты под claim. Берёт данные из Memory.roomSurvey
// (заполняется modules/roomSurvey). Свои комнаты пропускаем - у них свой стек
// индикаторов; highway не интересует. Иконка в правом-верхнем углу клетки карты,
// под ней - тип минерала (или "SK" для центральных 3x3 сектора).
function visualiseRoomSurveyMap() {
    if (!Memory.roomSurvey) return;

    for (const name in Memory.roomSurvey) {
        const s = Memory.roomSurvey[name];
        if (s.owned) continue;
        if (s.isHighway) continue;

        let color, icon;
        if (s.claimable === 'yes')          { color = '#44ff88'; icon = '✓'; }
        else if (s.claimable === 'unknown') { color = '#ffcc44'; icon = '?'; }
        else                                { color = '#ff6666'; icon = '✗'; }
        Game.map.visual.text(`${icon} r${s.clearRadius}`, new RoomPosition(49, 4, name), {color, align: 'right', fontSize: 5});

        const sub = s.isSK ? 'SK' : (s.mineral || '');
        if (sub) {
            Game.map.visual.text(sub, new RoomPosition(49, 10, name), {color: s.isSK ? '#888888' : '#aaccff', align: 'right', fontSize: 5});
        }
    }
}

// Превью базы 13x13 в самой комнате (видно при зуме). Рисуем только для не-наших
// surveyed-комнат - чтобы не загромождать собственные базы и highway. Контур tile-aligned
// (-0.5, как у Expand и base preview): раньше cx - 6 сдвигал его на полклетки.
function visualiseRoomSurveyOverlay(room) {
    const s = Memory.roomSurvey && Memory.roomSurvey[room.name];
    if (!s || s.owned || s.isHighway) return;

    const [cx, cy] = s.center;
    let color;
    if (s.claimable === 'yes')          color = '#44ff88';
    else if (s.claimable === 'unknown') color = '#ffcc44';
    else                                color = '#ff6666';
    room.visual.rect(cx - 6.5, cy - 6.5, 13, 13, {fill: 'transparent', stroke: color, lineStyle: 'dashed', opacity: 0.6})
               .text(`r${s.clearRadius}`, cx, cy + 0.3, {color, font: 0.6});
}

// Map-визуализация power-bank'ов: рисует все банки в Memory с HP/DPS/tickToDeath +
// стрелки активных операций (home_room → комната банка).
// Цвет:
//   pending           - зелёный (свободен, можем послать сквад)
//   stealing          - оранжевый (контест, ждём смерти чтобы подобрать)
//   attacking         - красный (наш squad едет/бьёт)
//   looting           - жёлтый (carriers везут power)
function visualisePowerBankFlows() {
    if (!Memory.power_banks) return;

    for (const id in Memory.power_banks) {
        const bank = Memory.power_banks[id];

        const color = bank.status === 'attacking' ? '#ff4444'
                    : bank.status === 'looting'   ? '#ffaa00'
                    : bank.status === 'stealing'  ? '#ff8844'
                    : '#88ff88';

        const dps           = bank.dps || 0;
        const ticksToKill   = dps > 0 ? Math.ceil(bank.hits / dps) : null;
        const ticksToDecay  = Math.max(0, (bank.decayAt || 0) - Game.time);
        const hpK           = Math.round(bank.hits / 1000);

        // Стек слева-сверху комнаты банка - не перекрывает сам банк, читаемо на zoom-out.
        // x=1, y=2..; align='left' с базовой позицией = левый край каждой строки.
        const x = 1;
        let y = 4;
        const line = (text, opts) => {
            Game.map.visual.text(text, new RoomPosition(x, y, bank.roomName), Object.assign({color, align: 'left'}, opts));
            y += (opts && opts.fontSize ? opts.fontSize : 4) + 1;
        };
        line(`⚡ ${bank.amount}`,                                    {fontSize: 6});
        line(`HP   ${hpK}k`,                                         {fontSize: 4});
        line(`DPS  ${dps}`,                                          {fontSize: 4});
        line(ticksToKill !== null ? `kill  ~${ticksToKill}t` : `decay ${ticksToDecay}t`, {fontSize: 4});
        line(`${bank.status}${bank.contested ? ' ⚔' : ''}`,          {fontSize: 4});

        // Config-блок: пороги из settings (те же, что в tryAllocateSquad) + сравнение с банком.
        // ✓/✗ + цвет показывают, прошёл бы банк allocate-фильтр в tryAllocateSquad.
        const minAmount    = settings.get(null, 'power_bank_min_amount');
        const minDecayBuf  = settings.get(null, 'power_bank_min_decay_buffer');
        const maxDist      = settings.get(null, 'power_bank_max_distance');
        const stealMaxDist = settings.get(null, 'power_bank_steal_max_distance');
        const amountOk     = bank.amount >= minAmount;
        const decayOk      = ticksToDecay >= minDecayBuf;
        const failColor    = '#ff4444';
        y += 1; // визуальный разделитель
        line(`amt  ${bank.amount}/${minAmount} ${amountOk ? '✓' : '✗'}`,
             {fontSize: 4, color: amountOk ? color : failColor});
        line(`dcy  ${ticksToDecay}/${minDecayBuf} ${decayOk ? '✓' : '✗'}`,
             {fontSize: 4, color: decayOk ? color : failColor});
        line(`dist max ${maxDist} (steal ${stealMaxDist})`,
             {fontSize: 4});

        // Стрелка home_room → bank для активных операций.
        if (bank.home_room && (bank.status === 'attacking' || bank.status === 'stealing' || bank.status === 'looting')) {
            const from = new RoomPosition(25, 25, bank.home_room);
            const to   = new RoomPosition(bank.x, bank.y, bank.roomName);
            Game.map.visual.line(from, to, {color, width: 0.8, opacity: 0.7, lineStyle: 'dashed'});
        }
    }
}

// Room-визуализация power-bank'ов: детальная статистика прямо в комнате банка. Рендерится
// только в тики, когда комната видна (observer scan tick или наш крип в комнате).
function visualisePowerBankRoomStats() {
    if (!Memory.power_banks) return;
    for (const id in Memory.power_banks) {
        const bank = Memory.power_banks[id];
        const room = Game.rooms[bank.roomName];
        if (!room) continue;

        const dps          = bank.dps || 0;
        const hpPct        = Math.round((bank.hits / POWER_BANK_HITS) * 100);
        const ticksToKill  = dps > 0 ? Math.ceil(bank.hits / dps) : null;
        const ticksToDecay = Math.max(0, (bank.decayAt || 0) - Game.time);

        const x = bank.x, y = bank.y;
        const baseOpts = {align: 'center', stroke: '#000', strokeWidth: 0.1};
        room.visual.text(`${Math.round(bank.hits / 1000)}k HP (${hpPct}%)`, x, y - 1.5,
                         Object.assign({}, baseOpts, {color: '#ffffff', font: 0.5}));
        room.visual.text(`DPS ${dps}` + (ticksToKill !== null ? ` • kill ~${ticksToKill}t` : ` • decay ${ticksToDecay}t`),
                         x, y - 0.9, Object.assign({}, baseOpts, {color: '#ff8888', font: 0.4}));
        room.visual.text(`${bank.status}${bank.contested ? ' ⚔' : ''}`,
                         x, y + 1.5, Object.assign({}, baseOpts, {color: '#ffaa44', font: 0.4}));
    }
}

// При просадке буфера лучше не рендерить визуал чем уйти в principal-overrun.
// Visualization это 1-3 CPU/тик чистой косметики - при <3000 bucket'е критичнее
// дать обычной логике (defend/spawn) запас. Настройка viz_min_bucket (default 3000), 0 -
// отключить gate (например при отладке).
exports.process = function() {
    // Обслуживание - до gate'ов: статистика копится и кеш чистится, даже когда визуализация
    // выключена (viz_mode off, просадка bucket'а).
    sampleRoomStats();
    pruneHeavyVisualCache();

    // viz_mode: off - ничего; min - иконки карты, CPU-строка и панель комнаты только с тревогами
    // (плюс боевые оверлеи: нюки, враги, вражеские башни, подписи барьеров, флаги/превью);
    // full - всё.
    const mode = settings.get(null, 'viz_mode');
    if (mode === 'off') return;
    const minBucket = settings.get(null, 'viz_min_bucket');
    if (Game.cpu.bucket < minBucket) return;

    // Первая своя комната (минимальное имя - стабильно между тиками): в ней одна CPU-строка
    // карты и глобальные пункты панели (экспансия). Выбираем до цикла, чтобы панель знала.
    let primary = null;
    for (const roomName in Game.rooms) {
        const c = Game.rooms[roomName].controller;
        if (c && c.my && (primary === null || roomName < primary)) primary = roomName;
    }
    const ctx = {mode, primary};
    const full = mode === 'full';

    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        visualiseRoom(room, ctx);
        visualiseMap(room, ctx);
        if (full) visualiseRoomSurveyOverlay(room);
    } catch (err) { err.log() }
    if (primary) visualiseGlobalMap(primary, ctx);
    visualiseExpandFlag();
    visualizeBasePreview();
    if (!full) return;
    visualiseLabFlows();
    visualisePowerBankFlows();
    visualisePowerBankRoomStats();
    visualiseRoomSurveyMap();
}
