const start = {
    "W9S37": {
        start: Game.time,
        progress: Game.rooms["W9S37"].controller.progress,
        visual: "32:40"
    }
}

exports.room = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || controller.owner.username != "gistrec") {
        return;
    }

    // TODO: Не брать инфу из Memory - хранить в файлах.
    // const pos  = start[room.name].visual.split(':');
    const pos = controller.pos;

    room.visual
        .text(`〽️ E/t: ${((room.controller.progress - start[room.name].progress) / (Game.time - start[room.name].start)).toFixed(1)}`, pos.x + 1, pos.y, {align: 'left'})
        .text(`⚡ Energy ${room.energyAvailable}/${room.energyCapacityAvailable}`, pos.x + 1, pos.y + 1, {align: 'left'})
        .text(`🏰 Upgrade ${(room.controller.progress / room.controller.progressTotal * 100).toFixed(2)}%`, pos.x + 1, pos.y + 2, {align: 'left'})
    if (room.memory.defending) {
        room.visual.text("⚔️ Defending mode: On", pos.x + 1, pos.y + 3, {color: 'red', align: 'left'})
    } else {
        room.visual.text("⚔️ Defending mode: Off", pos.x + 1, pos.y + 3, {color: 'green', align: 'left'})
    }

    const my_towers = room.find(FIND_MY_STRUCTURES,  {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of my_towers) {
        room.visual.circle(tower.pos, {
            radius: 15,
            fill: 'transparent',
            stroke: 'green',
            lineStyle: 'dotted'
        })
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
        const attack = enemy.body.filter(part => part.type == ATTACK).reduce((damage, part) => damage + ATTACK_POWER * (part.boost ? BOOSTS[ATTACK][part.boost][ATTACK] : 1), 0);
        const heal = enemy.body.filter(part => part.type == HEAL).reduce((damage, part) => damage + HEAL_POWER * (part.boost ? BOOSTS[HEAL][part.boost][HEAL] : 1), 0);
        room.visual.text(attack, enemy.pos.x, enemy.pos.y - 0.1, {color: 'red', font: 0.6, opacity: 1})
        room.visual.text(heal, enemy.pos.x, enemy.pos.y + 0.5, {color: 'green', font: 0.8, opacity: 1})
    }
}

exports.map = function(room) {
    if (!room.controller || !room.controller.owner || room.controller.owner.username != "gistrec") {
        return;
    }

    Game.map.visual
        .text(`⚡${room.energyAvailable}/${room.energyCapacityAvailable}`, new RoomPosition(0, 4, room.name), {align: 'left', fontSize: 6})
        .text(`🏰${room.controller.level} lvl - ${(room.controller.progress / room.controller.progressTotal * 100).toFixed(1)}%`, new RoomPosition(0, 10, room.name), {align: 'left', fontSize: 6})
}
