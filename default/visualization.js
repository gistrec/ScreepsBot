let statuses = {}

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

    room.visual
        .text(`〽️ E/t: ${((room.controller.progress - statuses[room.name].progress) / (Game.time - statuses[room.name].start)).toFixed(1)}`, pos.x + 1, pos.y, {align: 'left'})
        .text(`⚡ Energy ${room.energyAvailable}/${room.energyCapacityAvailable}`, pos.x + 1, pos.y + 1, {align: 'left'})
        .text(`🏰 Upgrade ${(room.controller.progress / room.controller.progressTotal * 100).toFixed(2)}%`, pos.x + 1, pos.y + 2, {align: 'left'})
    if (room.memory.defending) {
        room.visual.text("⚔️ Defending mode: On", pos.x + 1, pos.y + 3, {color: 'red', align: 'left'})
    } else {
        room.visual.text("⚔️ Defending mode: Off", pos.x + 1, pos.y + 3, {color: 'green', align: 'left'})
    }

    const expand = Game.flags["Expand"]
    if (expand) {
        room.visual.rect(expand.pos.x - 6, expand.pos.y - 6, 12, 12, {fill: 'transparent', stroke: 'green', lineStyle: 'dotted', opacity: 0.7});
    }

    const my_towers = room.find(FIND_MY_STRUCTURES,  {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of my_towers) {
        room.visual
            .rect(tower.pos.x - 5, tower.pos.y - 5,  10, 10, { fill: 'transparent', stroke: 'red',   lineStyle: 'dotted', opacity: 0.2 })
            .text('600', tower.pos.x - 5, tower.pos.y + 5, { color: 'red', font: 0.5, opacity: 0.3 })
            .text('600', tower.pos.x + 5, tower.pos.y - 5, { color: 'red', font: 0.5, opacity: 0.3 })
        // room.visual.rect(tower.pos.x - 15, tower.pos.y - 15, 30, 30, { fill: 'transparent', stroke: 'green', lineStyle: 'dotted' });

        /*let radius = 5;
        let damage = 600;
        while (radius <= 20) {
            room.visual
                .rect(new RoomPosition(tower.pos.x - radius,  tower.pos.y - radius,  tower.pos.roomName), 2 * radius, 2 * radius, { fill: 'transparent', stroke: 'red',   lineStyle: 'dotted' })
                .text(damage, tower.pos.x - radius, tower.pos.y + 0.25,          {color: 'red', font: 0.7})
                .text(damage, tower.pos.x + radius, tower.pos.y + 0.25,          {color: 'red', font: 0.7})
                .text(damage, tower.pos.x,          tower.pos.y + radius + 0.25, {color: 'red', font: 0.7})
                .text(damage, tower.pos.x,          tower.pos.y - radius + 0.25, {color: 'red', font: 0.7})

            damage -= 150;
            radius += 5;
        }*/
    }

    const enemy_towers = room.find(FIND_HOSTILE_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of enemy_towers) {
        let radius = 5;
        let damage = 600;

        while (radius <= 20) {
            room.visual.circle(tower.pos, {
                radius: radius,
                fill: 'transparent',
                stroke: 'red',
                lineStyle: 'dotted',
            })
            .text(damage, tower.pos.x - radius, tower.pos.y, {color: 'red', font: 1})
            .text(damage, tower.pos.x + radius, tower.pos.y, {color: 'red', font: 1})
            .text(damage, tower.pos.x, tower.pos.y + radius, {color: 'red', font: 1})
            .text(damage, tower.pos.x, tower.pos.y - radius, {color: 'red', font: 1})

            damage -= 150;
            radius += 5;
        }
    }

    const nukes = room.find(FIND_NUKES);
    for (const nuke of nukes) {
        const pos = nuke.pos
        const nukes = nuke.room.lookForAt(LOOK_NUKES, nuke);

        room.visual.rect(pos.x - 2.5, pos.y - 2.5, 5, 5, {
            fill: '#FF0000',
            opacity: 0.2,
            stroke: 'red',
            lineStyle: 'dotted',
        })
        .text(nukes.length, pos.x, pos.y + 0.3, {font: 0.5});

        for (let i = 0; i < nukes.length; i++) {
            room.visual.text(nukes[i].timeToLand, pos.x - 2.4, pos.y - 2 + i / 2, {font: 0.5, color: "yellow", align: "left"});
        }
    }

    const enemies = room.find(FIND_HOSTILE_CREEPS);
    for (const enemy of enemies) {
        const heal = enemy.body.filter(part => part.type == HEAL).reduce((damage, part) => damage + HEAL_POWER * (part.boost ? BOOSTS[HEAL][part.boost][HEAL] : 1), 0);
        const ranged_heal = enemy.body.filter(part => part.type == HEAL).reduce((damage, part) => damage + RANGED_HEAL_POWER * (part.boost ? BOOSTS[HEAL][part.boost]["rangedHeal"] : 1), 0);

        const attack = enemy.body.filter(part => part.type == ATTACK).reduce((damage, part) => damage + ATTACK_POWER * (part.boost ? BOOSTS[ATTACK][part.boost][ATTACK] : 1), 0);
        const ranged_attack = enemy.body.filter(part => part.type == RANGED_ATTACK).reduce((damage, part) => damage + RANGED_ATTACK_POWER * (part.boost ? BOOSTS[RANGED_ATTACK][part.boost]["rangedAttack"] : 1), 0);
        room.visual.text(attack + "-" + ranged_attack, enemy.pos.x, enemy.pos.y - 0.1, {color: 'red', font: 0.4, opacity: 1})
        room.visual.text(heal + "-" + ranged_heal, enemy.pos.x, enemy.pos.y + 0.5, {color: 'green', font: 0.4, opacity: 1})
    }

    const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL});
    const hitsMax = RAMPART_HITS_MAX[controller.level];
    for (const wall of walls) {
        room.visual.text((wall.hits / hitsMax * 100).toFixed(1) + "%", wall.pos.x, wall.pos.y + 0.15, {color: 'red', font: 0.3, opacity: 1})
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
