exports.checkStatus = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || controller.owner.username != "gistrec") {
        return true;
    }
    
    const enemy_creeps = room.find(FIND_HOSTILE_CREEPS);

    // Есть ли поврежденные барьеры.
    const rampartDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => STRUCTURE_RAMPART == struct.structureType
                            && (struct.hits < struct.hitsMax * 0.8)
    })
    const rampartSuperDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => STRUCTURE_RAMPART == struct.structureType
                            && (struct.hits < struct.hitsMax * 0.2)
    })
    // Есть ли поврежденные спавны.
    const spawnDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => struct.structureType == STRUCTURE_SPAWN
                            && struct.hits != struct.hitsMax
    });
    // Включаем SafeMode, если барьер или спаун повреждены.
    // Проверка на наличие врагов добавлена чтобы барьер нечайно сам не регрессировал + при апгрейде контроллера.
    if ((rampartSuperDamaged.length || spawnDamaged.length) && enemy_creeps.length && controller.safeModeAvailable) {
        const text = `Safe mode was enabled for room ${room.name}\n` +
                     `${normal_creeps.length} creeps, ${power_creeps.length} powerd`;
        console.log(text);
        Game.notify(text);
        room.controller.activateSafeMode();
    }

    // Если существует хотя бы одна угроза, то активируем защитный режим
    // В этом режиме создаются Defender'ы
    if (rampartDamaged.length || spawnDamaged.length || enemy_creeps.length || controller.safeMode) {
        if (room.memory.defending) {
            return;
        }

        const text = `Defending mode was enabled for for room ${room.name}\n` +
                     `Is rampart damaged: ${rampartDamaged.length ? 'true' : 'false'}\n` +
                     `Is spawn damaged: ${spawnDamaged.length ? 'true' : 'false'}\n` +
                     `${enemy_creeps.length} enemy creeps`;
        console.log(text);
        Game.notify(text);
        room.memory.defending = true;
    }else {
        room.memory.defending = false;
    }
}

exports.fireTower = function() {
    const towers = _.filter(Game.structures, s => s.structureType == STRUCTURE_TOWER);
    for (const tower of towers) {
        const enemy = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
            filter: (s) => s.pos.inRangeTo(tower, 7)
        });
        if (enemy) {
            tower.attack(enemy);
            continue;
        }

        const creep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.hits != c.hitsMax && !c.memory.recycling
        });
        if (creep) {
            tower.heal(creep);
            continue;
        }

        const rampart = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s) => (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL)
                        && s.hits < 15000 // При починке энергия не должна теряться
        });
        if (rampart) {
            tower.repair(rampart);
            continue;
        }

        const damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s) => (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
                        && s.hitsMax - s.hits > 800 // При починке энергия не должна теряться
                        && tower.pos.inRangeTo(s, 15)
        });
        if (damaged) {
            tower.repair(damaged);
            continue;
        }
    }
}

/**
 * У каждой комнаты должен быть 1 Charger, заряжающий пушку.
 * Функция проверяет есть ли он в комнате
 */
exports.updateDefender = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || controller.owner.username != "gistrec") {
        return
    }

    const creeps = room.find(FIND_MY_CREEPS, {
        filter: (creep) => creep.memory.role == 'charger'
    });
    const defenders = _.filter(creeps, (creep) => creep.memory.defender);

    // Если нет защитника, но есть крипы
    if (creeps.length && !defenders.length) {
        const index = Math.floor(Math.random() * (creeps.length - 1))
        creeps[index].memory.defender = true;
    }
    // Если больше одного защитника, убираем всех, кроме одного
    if (defenders.length > 1) {
        for (let index = 0; index < defenders.length - 1; index++) {
            defenders[index].memory.defender = false;
        }
    }
}

/**
 * Получаем ближайшую башню, в которой не хватает ресурсов.
 * @param {Object} creep     - бот
 * @param {Number} count     - количество ресурсов, не хватающих в башне
 */
exports.getClosestEmptyTower = function(creep, count) {
    return creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType == STRUCTURE_TOWER
                    && s.store.getFreeCapacity(RESOURCE_ENERGY) > count
                    && s.room.name == creep.room.name
    });
}