exports.checkStatus = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || !controller.my) {
        return true;
    }

    // Учитываем только опасных вражеских крипов
    // Т.к. при LevelUp'е комнаты Rampart'ы тригерят DefendingMode
    // Думаю, нужно как-то обработать этот момент.
    const enemyCreeps = room.find(FIND_HOSTILE_CREEPS, {filter: creep => _.find(creep.body, bodyPart => [ATTACK, RANGED_ATTACK, CLAIM, WORK].includes(bodyPart.type)) && creep.owner.username != "Invader"});
    room.memory.enemy_creeps = enemyCreeps.length;

    // Есть ли поврежденные барьеры.
    const rampartDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => STRUCTURE_RAMPART == struct.structureType
                            && (struct.hits < struct.hitsMax * 0.8)
    })
    const rampartSuperDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => STRUCTURE_RAMPART == struct.structureType
                            && (struct.hits < struct.hitsMax * 0.05)
    })
    // Есть ли поврежденные спавны.
    const spawnDamaged = room.find(FIND_MY_STRUCTURES, {
        filter: (struct) => [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_TERMINAL, STRUCTURE_STORAGE, STRUCTURE_FACTORY].includes(struct.structureType)
                            && struct.hits != struct.hitsMax
    });
    // Включаем SafeMode, если барьер или спаун повреждены.
    // Проверка на наличие врагов добавлена чтобы барьер нечайно сам не регрессировал + при апгрейде контроллера.
    if ((rampartSuperDamaged.length || spawnDamaged.length) && enemyCreeps.length && controller.safeModeAvailable && !controller.upgradeBlocked) {
        const text = `Safe mode was enabled for room ${room.name}\n` +
                     `Is rampart damaged: ${rampartDamaged.length ? 'true' : 'false'}\n` +
                     `Is spawn damaged: ${spawnDamaged.length ? 'true' : 'false'}\n` +
                     `${enemyCreeps.length} enemy creeps`;
        console.log(text);
        Game.notify(text);

        // Миграция со старого хардкода: W11S39 ранее был исключён из автоактивации safeMode.
        // Сохраняем поведение, но через memory-флаг - чтобы было видно и можно было выключить.
        if (room.name == "W11S39" && room.memory.disable_safe_mode === undefined) {
            room.memory.disable_safe_mode = true;
        }

        if (!room.memory.disable_safe_mode) {
            room.controller.activateSafeMode();
        }
    }

    // Если существует хотя бы одна угроза, то активируем защитный режим
    // В этом режиме создаются Defender'ы
    if (rampartDamaged.length || spawnDamaged.length || enemyCreeps.length || controller.safeMode) {
        if (room.memory.defending) {
            return;
        }

        const text = `Defending mode was enabled for for room ${room.name}\n` +
                     `Is rampart damaged: ${rampartDamaged.length ? 'true' : 'false'}\n` +
                     `Is spawn damaged: ${spawnDamaged.length ? 'true' : 'false'}\n` +
                     `${enemyCreeps.length} enemy creeps`;
        console.log(text);
        Game.notify(text);
        room.memory.defending = true;
    }else {
        room.memory.defending = false;
    }
}

exports.fireTower = function(room) {
    const towers = room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_TOWER});
    for (const tower of towers) {
        const creep = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.hits != c.hitsMax && !c.memory.recycling
        });
        if (creep) {
            tower.heal(creep);
            continue;
        }


        if (!room.controller.safeMode) {
            // Временная мера
            let enemy = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                filter: (s) => (s.owner.username == "Invader") || s.pos.inRangeTo(tower, 13)
            });
            if (enemy){
                // if (Game.time % 20 <= 5) {
                    tower.attack(enemy);
                    continue;
                // }
            }
        }

        let rampart = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (s) => (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL)
                        && (s.hits < 15000 /* || (s.room.name == "W9S39" && s.hits != s.hitsMax && Math.random() > 0.9) */)
        });
        if (rampart) {
            tower.repair(rampart);
            continue;
        }

        // Восстанавливаем структуры
        if (!room.memory.enemy_creeps) {
            let damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: (s) => (s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER)
                            && s.hitsMax - s.hits > 800 // При починке энергия не должна теряться
            });

            if (damaged) {
                tower.repair(damaged);
                continue;
            }
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