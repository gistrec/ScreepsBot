let statuses = {}

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
        let radius = 5;
        let damage = 600;

        while (radius <= 20) {
            v.circle(tower.pos, {
                radius: radius,
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

    // Live-данные обновляются каждый тик.
    room.visual
        .text(`〽️ E/t: ${((room.controller.progress - statuses[room.name].progress) / (Game.time - statuses[room.name].start)).toFixed(1)}`, pos.x + 1, pos.y, {align: 'left'})
        .text(`⚡ Energy ${room.energyAvailable}/${room.energyCapacityAvailable}`, pos.x + 1, pos.y + 1, {align: 'left'})
        .text(`🏰 Upgrade ${(room.controller.progress / room.controller.progressTotal * 100).toFixed(2)}%`, pos.x + 1, pos.y + 2, {align: 'left'})
    if (room.memory.defending) {
        room.visual.text("⚔️ Defending mode: On", pos.x + 1, pos.y + 3, {color: 'red', align: 'left'})
    } else {
        room.visual.text("⚔️ Defending mode: Off", pos.x + 1, pos.y + 3, {color: 'green', align: 'left'})
    }

    // Строка про лабы. Обновляется в lab.runReaction раз в 10 тиков, поэтому слегка лагает -
    // достаточно, чтобы понимать почему лабы стоят.
    const ls = room.memory.lab_status;
    if (ls && ls.output && ls.total > 0) {
        let text, color;
        if (ls.dirty > 0) {
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

    const expand = Game.flags["Expand"]
    if (expand) {
        room.visual.rect(expand.pos.x - 6, expand.pos.y - 6, 12, 12, {fill: 'transparent', stroke: 'green', lineStyle: 'dotted', opacity: 0.7});
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
        .text(`🏰${room.controller.level} lvl - ${(room.controller.progress / room.controller.progressTotal * 100).toFixed(1)}%`, new RoomPosition(0, 10, room.name), {align: 'left', fontSize: 6})
    if (room.memory.defending) {
        Game.map.visual.text("⚔️ On", new RoomPosition(0, 47, room.name), {color: '#FF0000', align: 'left', fontSize: 6})
    } else {
        Game.map.visual.text("⚔️ Off", new RoomPosition(0, 47, room.name), {color: '#00FF00', align: 'left', fontSize: 6})
    }
}

exports.process = function() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];

        visualiseRoom(room);
        visualiseMap(room);
    }
}
