const utils = require('../utils');

exports.checkStatus = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || !controller.my) {
        return true;
    }

    // Учитываем всех опасных вражеских крипов, включая Invader - иначе при их атаках не включается defending mode.
    const enemyCreeps = room.find(FIND_HOSTILE_CREEPS, {filter: creep => _.find(creep.body, bodyPart => [ATTACK, RANGED_ATTACK, CLAIM, WORK].includes(bodyPart.type))});
    room.memory.enemy_creeps = enemyCreeps.length;

    // Под defending checkStatus вызывается каждый тик - используем общий per-tick кеш структур
    // вместо 3 отдельных room.find(FIND_MY_STRUCTURES, ...). Кеш шарится с fireTower и rampartDefender.
    const myByType = utils.getMyStructuresByType(room);

    // Есть ли поврежденные барьеры.
    const allRamparts = myByType[STRUCTURE_RAMPART] || [];
    const rampartDamaged      = allRamparts.filter(r => r.hits < r.hitsMax * 0.8);
    const rampartSuperDamaged = allRamparts.filter(r => r.hits < r.hitsMax * 0.05);

    // Per-rampart дельта между тиками. Идея: decay батчится по 300 HP на rampart раз в
    // RAMPART_DECAY_TIME (100t), поэтому максимальный drop одного рампарта за тик от decay
    // = 300. Любой single drop > 1000 = реальный урон от атакера/dismantler'а, независимо
    // от того есть ли в комнате враги (могли отойти за кадр, могут бить с другой клетки).
    //
    // Раньше использовали суммарный delta всех ramparts > 5000 - это false-fired на
    // синхронных decay'ах: 72 рампарта × 300 = 21.6k drop без какой-либо атаки.
    if (!room.memory.rampart_hits_by_id) room.memory.rampart_hits_by_id = {};
    const lastHits = room.memory.rampart_hits_by_id;
    let maxRampartDrop = 0;
    const nextHits = {};
    for (const r of allRamparts) {
        const prev = lastHits[r.id];
        if (prev !== undefined) {
            const drop = prev - r.hits;
            if (drop > maxRampartDrop) maxRampartDrop = drop;
        }
        nextHits[r.id] = r.hits;
    }
    room.memory.rampart_hits_by_id = nextHits;
    const rampartUnderAttack = maxRampartDrop > 1000 && enemyCreeps.length > 0;
    // Migration: чистим старое суммарное поле от прежней версии эвристики.
    if (room.memory.last_rampart_hits !== undefined) delete room.memory.last_rampart_hits;

    // Есть ли поврежденные спавны/башни/терминал/storage/factory.
    const criticalTypes = [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_TERMINAL, STRUCTURE_STORAGE, STRUCTURE_FACTORY];
    const spawnDamaged = criticalTypes
        .flatMap(t => myByType[t] || [])
        .filter(s => s.hits != s.hitsMax);
    // Включаем SafeMode, если барьер или спаун повреждены.
    // Проверка на наличие врагов добавлена чтобы барьер нечайно сам не регрессировал + при апгрейде контроллера.
    if ((rampartSuperDamaged.length || spawnDamaged.length || rampartUnderAttack) && enemyCreeps.length && controller.safeModeAvailable && !controller.upgradeBlocked) {
        const text = `Safe mode was enabled for room ${room.name}\n` +
                     `Is rampart damaged: ${rampartDamaged.length ? 'true' : 'false'}\n` +
                     `Is spawn damaged: ${spawnDamaged.length ? 'true' : 'false'}\n` +
                     `${enemyCreeps.length} enemy creeps`;
        console.log(text);
        Game.notify(text);

        if (!room.memory.disable_safe_mode) {
            room.controller.activateSafeMode();
        }
    }

    // Активная угроза - что-то прямо сейчас. Повреждённые барьеры/спавны сюда НЕ входят:
    // в стабильной комнате они почти всегда ниже 100% (свежие рампарты, недоремонт после
    // прошлой атаки) и при старой логике комната зависала в defending навечно.
    const threatActive = enemyCreeps.length > 0 || rampartUnderAttack;

    if (threatActive) {
        room.memory.last_attack_at = Game.time;
    }

    // Hold-down: держим defending ещё DEFEND_HOLD_TICKS после последней угрозы, чтобы
    // не флапать когда враг на тик скрылся из видимости (за рампартом, в exit-tile и т.п.).
    const DEFEND_HOLD_TICKS = 50;
    const inHoldDown = room.memory.last_attack_at !== undefined
                    && (Game.time - room.memory.last_attack_at) <= DEFEND_HOLD_TICKS;

    const shouldDefend = threatActive || inHoldDown || controller.safeMode;

    if (shouldDefend) {
        if (room.memory.defending) {
            return;
        }
        const text = `Defending mode was enabled for room ${room.name}\n` +
                     `${enemyCreeps.length} enemy creeps, max rampart drop: ${maxRampartDrop}`;
        console.log(text);
        Game.notify(text);
        room.memory.defending = true;
    } else {
        room.memory.defending = false;
    }
}

exports.fireTower = function(room) {
    const myStructuresByType = utils.getMyStructuresByType(room);
    const towers = myStructuresByType[STRUCTURE_TOWER] || [];
    if (towers.length == 0) return;

    // Под атакой даём больший запас HP барьерам - 15k уже почти разрушен.
    const repairThreshold = room.hasHostiles ? 100000 : 15000;

    // Считаем целевые списки один раз на комнату, потом каждая башня выбирает ближайшего
    // через findClosestByRange(array). Раньше каждая башня делала по 4 find() - до 24 сканов
    // на 6 башен; теперь 4 на всю комнату.
    const woundedCreeps = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.hits != c.hitsMax && !c.memory.recycling
    });
    const hostileCreeps = !room.controller.safeMode ? room.find(FIND_HOSTILE_CREEPS) : [];

    const structuresByType = utils.getStructuresByType(room);
    const ramparts = structuresByType[STRUCTURE_RAMPART] || [];
    const walls    = structuresByType[STRUCTURE_WALL]    || [];
    const damagedBarriers = ramparts.concat(walls).filter(s => s.hits < repairThreshold);

    const damagedRoadsContainers = !room.hasHostiles
        ? (structuresByType[STRUCTURE_ROAD] || []).concat(structuresByType[STRUCTURE_CONTAINER] || [])
            .filter(s => s.hitsMax - s.hits > 800)
        : [];

    for (const tower of towers) {
        // Heal только в радиусе 20 - дальше эффективность падает до 25%, не стоит расхода энергии.
        const inRangeWounded = woundedCreeps.filter(c => tower.pos.inRangeTo(c, 20));
        const wounded = tower.pos.findClosestByRange(inRangeWounded);
        if (wounded) {
            tower.heal(wounded);
            continue;
        }

        if (!room.controller.safeMode && hostileCreeps.length > 0) {
            const reachable = hostileCreeps.filter(s => s.owner.username == "Invader" || s.pos.inRangeTo(tower, 13));
            const enemy = tower.pos.findClosestByRange(reachable);
            if (enemy) {
                tower.attack(enemy);
                continue;
            }
        }

        const rampart = tower.pos.findClosestByRange(damagedBarriers);
        if (rampart) {
            tower.repair(rampart);
            continue;
        }

        if (!room.hasHostiles && damagedRoadsContainers.length > 0) {
            const damaged = tower.pos.findClosestByRange(damagedRoadsContainers);
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
    });
}