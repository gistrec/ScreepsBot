const lab = require('modules/lab');
const buildModule = require('modules/build');
const utils = require('utils');

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

let statuses = {}

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

function updateEnergyEMA(room) {
    if (Game.time % ENERGY_SAMPLE_STEP !== 0) return;
    let stats = room.memory.energy_stats;
    const current = room.getTotalEnergy();
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

function formatEnergyCompact(v) {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'k';
    return String(v);
}

function formatRate(v) {
    const sign = v >= 0 ? '+' : '';
    return sign + (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
}

// Кеш экспортированных RoomVisual для тяжёлых статичных частей (башни, стенки).
// Обновляется раз в HEAVY_VISUAL_TTL тиков, между обновлениями просто импортируется.
const HEAVY_VISUAL_TTL = 10;
const heavyVisualCache = {};

function buildHeavyRoomVisuals(room) {
    const v = new RoomVisual(room.name);

    const my_towers = room.find(FIND_MY_STRUCTURES,  {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of my_towers) {
        v.rect(tower.pos.x - 5, tower.pos.y - 5,  10, 10, { fill: 'transparent', stroke: 'red',   lineStyle: 'dotted', opacity: 0.2 })
         .text('600', tower.pos.x - 5, tower.pos.y + 5, { color: 'red', font: 0.5, opacity: 0.3 })
         .text('600', tower.pos.x + 5, tower.pos.y - 5, { color: 'red', font: 0.5, opacity: 0.3 });
    }

    const enemy_towers = room.find(FIND_HOSTILE_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of enemy_towers) {
        // Урон tower'и считается по Chebyshev distance (`max(|dx|,|dy|)`), поэтому
        // зона «дистанция ≤ r» - квадрат 2r×2r, а не круг. Раньше тут были v.circle -
        // на углах квадрата они врали: точки (±r, ±r) попадали "за границей" круга, но
        // по факту получали полный урон зоны r. Рисуем концентрические квадраты.
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

    const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL});
    const hitsMax = RAMPART_HITS_MAX[room.controller.level];
    for (const wall of walls) {
        v.text((wall.hits / hitsMax * 100).toFixed(1) + "%", wall.pos.x, wall.pos.y + 0.15, {color: 'red', font: 0.3, opacity: 1});
    }

    return v.export();
}

visualiseRoom = function(room) {
    if (!statuses.hasOwnProperty(room.name) && room.controller) {
        statuses[room.name] = {
            start: Game.time,
            progress: room.controller.progress,
        }
    }

    const controller = room.controller;

    if (!controller || !controller.owner || controller.owner.username != "gistrec") {
        return;
    }

    const pos = controller.pos;

    // Тяжёлые статичные визуалы (башни, стенки) - пересчитываем раз в 10 тиков.
    const cached = heavyVisualCache[room.name];
    if (!cached || Game.time - cached.at >= HEAVY_VISUAL_TTL) {
        heavyVisualCache[room.name] = {
            string: buildHeavyRoomVisuals(room),
            at: Game.time,
        };
    }
    room.visual.import(heavyVisualCache[room.name].string);

    // На RCL 8 controller.progress и progressTotal undefined - даём дефолты, чтобы не было NaN.
    const isMaxLevel = !room.controller.progressTotal;
    const elapsedTicks = Game.time - statuses[room.name].start;
    const progressDelta = (room.controller.progress || 0) - (statuses[room.name].progress || 0);
    const energyPerTick = elapsedTicks > 0 ? (progressDelta / elapsedTicks).toFixed(1) : "0";
    const upgradeText = isMaxLevel
        ? "MAX (8)"
        : `${(room.controller.progress / room.controller.progressTotal * 100).toFixed(2)}%`;

    // Live-данные обновляются каждый тик.
    room.visual
        .text(`〽️ E/t: ${energyPerTick}`, pos.x + 1, pos.y, {align: 'left'})
        .text(`⚡ Energy ${room.energyAvailable}/${room.energyCapacityAvailable}`, pos.x + 1, pos.y + 1, {align: 'left'})
        .text(`🏰 Upgrade ${upgradeText}`, pos.x + 1, pos.y + 2, {align: 'left'})
    if (room.isDefending) {
        room.visual.text("⚔️ Defending mode: On", pos.x + 1, pos.y + 3, {color: 'red', align: 'left'})
    } else {
        room.visual.text("⚔️ Defending mode: Off", pos.x + 1, pos.y + 3, {color: 'green', align: 'left'})
    }

    // Строка про лабы. Обновляется в lab.runReaction раз в 10 тиков, поэтому слегка лагает -
    // достаточно, чтобы понимать почему лабы стоят.
    const ls = room.memory.lab_status;
    if (ls && ls.output && ls.total > 0) {
        let text, color;
        if (ls.forceEvac) {
            text  = `🧪 ${ls.output}: stuck too long, evacuating labs`;
            color = '#ff66ff';
        } else if (ls.dirty > 0) {
            text  = `🧪 ${ls.output}: ${ls.dirty}/${ls.total} dirty (wrong mineral)`;
            color = 'orange';
        } else if (ls.stuck > 0) {
            text  = `🧪 ${ls.output}: ${ls.stuck}/${ls.total} stuck (storage+terminal full)`;
            color = '#ff5555';
        } else if (ls.sourceLow) {
            text  = `🧪 ${ls.output}: idle (no input mineral)`;
            color = 'yellow';
        } else {
            text  = `🧪 ${ls.output}: ${ls.runnable + ls.cooling}/${ls.total} active`;
            color = '#88ccff';
        }
        room.visual.text(text, pos.x + 1, pos.y + 4, {align: 'left', color});
    }

    // Spawn need: какой role и сколько энергии не хватает. Заполняется ролями в spawn(),
    // очищается в main.js спавн-цикле. Если нет блока - ничего не показываем.
    const need = room.memory.spawn_need;
    if (need && need.role) {
        const have = room.energyAvailable;
        const enough = have >= need.needed;
        room.visual.text(
            `⏳ Spawn ${need.role}: ${have}/${need.needed}e` + (enough ? ' (queued)' : ''),
            pos.x + 1, pos.y + 5,
            {align: 'left', color: enough ? '#88ff88' : '#ffaa00'}
        );
    }

    // Энерго-статистика: total stockpile + 3 окна EWMA скорости (e/tick).
    updateEnergyEMA(room);
    const stats = room.memory.energy_stats;
    const totalE = room.getTotalEnergy();
    const parts = [`🏦 ${formatEnergyCompact(totalE)}`];
    if (stats) {
        for (let i = 0; i < ENERGY_WINDOWS.length; i++) {
            const w = ENERGY_WINDOWS[i];
            parts.push(stats.samples >= w.warmup ? `${w.label}:${formatRate(stats.ema[i])}` : `${w.label}:—`);
        }
    }
    room.visual.text(parts.join('  '), pos.x + 1, pos.y + 6, {align: 'left'});

    const expand = Game.flags["Expand"]
    if (expand) {
        // 13x13 tile-aligned (-0.5 offset, size=13) - то же, что у base preview.
        // Раньше было 12x12 без offset - off-by-half-tile и не покрывало правую/нижнюю клетку.
        room.visual.rect(expand.pos.x - 6.5, expand.pos.y - 6.5, 13, 13, {fill: 'transparent', stroke: 'green', lineStyle: 'dotted', opacity: 0.7});
    }

    // Нюки - редкие, но timeToLand тикает каждый тик. Дёшево.
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

    // Враги двигаются - кешировать нельзя. Один проход по body вместо четырёх filter+reduce.
    const enemies = room.find(FIND_HOSTILE_CREEPS);
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

visualiseMap = function(room) {
    if (!room.controller || !room.controller.owner || room.controller.owner.username != "gistrec") {
        return;
    }

    Game.map.visual
        .text(`⚡${room.energyAvailable}/${room.energyCapacityAvailable}`, new RoomPosition(0, 4, room.name), {align: 'left', fontSize: 6})
        .text(`🏰${room.controller.level} lvl - ${room.controller.progressTotal ? (room.controller.progress / room.controller.progressTotal * 100).toFixed(1) + "%" : "MAX"}`, new RoomPosition(0, 10, room.name), {align: 'left', fontSize: 6})

    const ls = room.memory.lab_status;
    if (ls && ls.output && ls.total > 0) {
        let labText, labColor;
        if (ls.forceEvac)      { labText = `🧪 ${ls.output}: evac`;       labColor = '#ff66ff'; }
        else if (ls.dirty > 0) { labText = `🧪 ${ls.output}: dirty`;      labColor = '#ffaa00'; }
        else if (ls.stuck > 0) { labText = `🧪 ${ls.output}: stuck`;      labColor = '#ff5555'; }
        else if (ls.sourceLow) { labText = `🧪 ${ls.output}: idle`;       labColor = '#ffff00'; }
        else                   { labText = `🧪 ${ls.output}: processing`; labColor = '#88ccff'; }
        Game.map.visual.text(labText, new RoomPosition(0, 16, room.name), {color: labColor, align: 'left', fontSize: 6});
    }

    if (room.isDefending) {
        Game.map.visual.text("⚔️ On", new RoomPosition(0, 47, room.name), {color: '#FF0000', align: 'left', fontSize: 6})
    } else {
        Game.map.visual.text("⚔️ Off", new RoomPosition(0, 47, room.name), {color: '#00FF00', align: 'left', fontSize: 6})
    }

    // Компактный nuker-индикатор справа на той же строке. Зелёный - готов к выстрелу
    // (E=100, G=100, cd=0), красный - не готов (что-то не залито или cooldown).
    const nuker = (utils.getMyStructuresByType(room)[STRUCTURE_NUKER] || [])[0];
    if (nuker) {
        const eFull = nuker.store.getFreeCapacity(RESOURCE_ENERGY)  === 0;
        const gFull = nuker.store.getFreeCapacity(RESOURCE_GHODIUM) === 0;
        const ready = eFull && gFull && (nuker.cooldown || 0) === 0;
        const color = ready ? '#00FF00' : '#FF0000';
        Game.map.visual.text("☢", new RoomPosition(49, 46, room.name), {color, align: 'right', fontSize: 10});
    }
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
            Game.map.visual.line(from, to, {color: '#88ccff', width: 0.6, opacity: 0.5, lineStyle: 'dashed'});
            Game.map.visual.text(mineral, new RoomPosition(8, 28 + i * 6, consumerName), {color: '#88ccff', fontSize: 5, align: 'left'});
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
// surveyed-комнат - чтобы не загромождать собственные базы и highway.
function visualiseRoomSurveyOverlay(room) {
    const s = Memory.roomSurvey && Memory.roomSurvey[room.name];
    if (!s || s.owned || s.isHighway) return;

    const [cx, cy] = s.center;
    let color;
    if (s.claimable === 'yes')          color = '#44ff88';
    else if (s.claimable === 'unknown') color = '#ffcc44';
    else                                color = '#ff6666';
    room.visual.rect(cx - 6, cy - 6, 13, 13, {fill: 'transparent', stroke: color, lineStyle: 'dashed', opacity: 0.6})
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

        // Config-блок: значения порогов из Memory + сравнение с фактическими параметрами банка.
        // ✓/✗ + цвет показывают, прошёл бы банк allocate-фильтр в tryAllocateSquad.
        const minAmount    = Memory.power_bank_min_amount         || 2000;
        const minDecayBuf  = Memory.power_bank_min_decay_buffer   || 3000;
        const maxDist      = Memory.power_bank_max_distance       || 4;
        const stealMaxDist = Memory.power_bank_steal_max_distance || 3;
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

exports.process = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];

        visualiseRoom(room);
        visualiseMap(room);
        visualiseRoomSurveyOverlay(room);
    }
    visualiseLabFlows();
    visualisePowerBankFlows();
    visualisePowerBankRoomStats();
    visualiseRoomSurveyMap();
    visualizeBasePreview();
}
