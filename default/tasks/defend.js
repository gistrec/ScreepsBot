const utils = require('../utils');
const settings = require('../settings');
const log = require('../log');

// Максимальный drop hits одной структуры с прошлой проверки. Снимок hits per-id живёт в
// room.memory[memKey]; починка (drop < 0) игнорируется. Структура, исчезнувшая из списка
// (разрушена между проверками), считается упавшей на все свои прошлые hits - иначе башню,
// снесённую за один тик, триггер бы не заметил. Для рампартов нужен порог выше decay'я
// (см. checkStatus; рампарт, истлевший до нуля, в снимке имел <= 300), у спавнов/башен/
// терминала/storage/factory decay'я нет - любой drop там = урон.
function maxHitsDrop(room, memKey, structures) {
    const lastHits = room.memory[memKey] || {};
    const nextHits = {};
    let maxDrop = 0;
    for (const s of structures) {
        const prev = lastHits[s.id];
        if (prev !== undefined && prev - s.hits > maxDrop) maxDrop = prev - s.hits;
        nextHits[s.id] = s.hits;
    }
    for (const id in lastHits) {
        if (!(id in nextHits) && lastHits[id] > maxDrop) maxDrop = lastHits[id];
    }
    room.memory[memKey] = nextHits;
    return maxDrop;
}

// Тик последнего вызова activateSafeMode. В движке интент один на игрока за тик: второй вызов
// из другой комнаты удаляет первый, но оба возвращают OK (engine structures.js,
// lastActivateSafeMode) - без лока две комнаты отправили бы два письма "enabled", а safe mode
// получила бы только последняя. Module-level: живёт между тиками до global reset.
let safeModeActivatedAt = -1;

// Hold-down: defending держится ещё столько тиков после последней угрозы (см. checkStatus).
// Экспорт - для панели визуализации (остаток hold-down).
const DEFEND_HOLD_TICKS = exports.DEFEND_HOLD_TICKS = 50;

// Почему safe mode сейчас нельзя включить (null - можно). Повторяет проверки движка
// (activateSafeMode -> ERR_NOT_ENOUGH_RESOURCES / ERR_TIRED / ERR_BUSY) плюс per-room override
// disable_safe_mode. Без этого под defending (checkStatus каждый тик) триггер срабатывал каждый
// тик весь safe mode и весь cooldown - с console.log + Game.notify (= письмо) на каждом тике.
// Причина-строка (а не bool) - для панели визуализации: она показывает, чем заблокирован
// safe mode, по тем же проверкам. Порядок прежний: обход Game.rooms - последним.
function safeModeBlockReason(room) {
    const controller = room.controller;
    if (settings.get(room, 'disable_safe_mode')) return 'auto off';
    if (safeModeActivatedAt == Game.time) return 'activating';
    if (controller.safeMode) return 'active';
    if (controller.safeModeCooldown) return 'cooldown';
    if (!controller.safeModeAvailable) return 'no charges';
    if (controller.upgradeBlocked) return 'upgrade blocked';
    if (controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[controller.level] / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD) return 'downgrade';
    // Safe mode может быть активен только в одной комнате на шард.
    if (_.some(Game.rooms, r => r.controller && r.controller.my && r.controller.safeMode)) return 'active elsewhere';
    return null;
}
exports.safeModeBlockReason = safeModeBlockReason;

function canActivateSafeMode(room) {
    return safeModeBlockReason(room) === null;
}

exports.checkStatus = function(room) {
    const controller = room.controller;

    if (!controller || !controller.owner || !controller.my) {
        return true;
    }

    // Учитываем всех опасных вражеских крипов, включая Invader - иначе при их атаках не включается defending mode.
    // Кешируем сырой список один раз за тик, потом filter тут и в fireTower шарят его.
    const allHostiles = room.cache('hostileCreeps', r => r.find(FIND_HOSTILE_CREEPS));
    const enemyCreeps = allHostiles.filter(creep => creep.body.some(b => [ATTACK, RANGED_ATTACK, CLAIM, WORK].includes(b.type)));
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
    const maxRampartDrop = maxHitsDrop(room, 'rampart_hits_by_id', allRamparts);
    const rampartUnderAttack = maxRampartDrop > 1000 && enemyCreeps.length > 0;
    // Migration: чистим старое суммарное поле от прежней версии эвристики.
    if (room.memory.last_rampart_hits !== undefined) delete room.memory.last_rampart_hits;

    // Бьют ли прямо сейчас спавны/башни/терминал/storage/factory. Их никто не чинит (башни и
    // апгрейдеры берут только рампарты/стены/дороги/контейнеры), decay'я нет - поэтому старое
    // "hits != hitsMax" держалось вечно после одной царапины, и любой следующий враг с
    // ATTACK/WORK жёг safe mode. Смотрим drop с прошлой проверки: hits у них падают только от урона.
    const criticalTypes = [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_TERMINAL, STRUCTURE_STORAGE, STRUCTURE_FACTORY];
    const criticalStructs = criticalTypes.flatMap(t => myByType[t] || []);
    const maxCriticalDrop = maxHitsDrop(room, 'critical_hits_by_id', criticalStructs);
    const criticalUnderAttack = maxCriticalDrop > 0 && enemyCreeps.length > 0;
    // rampart_super_damaged как fail-safe срабатывал на статичных низких рампартах: один
    // случайный враг + давно недоремонтированные барьеры = впустую сожжённый safe mode.
    // Требуем чтобы (а) урон шёл прямо сейчас strictly выше decay'я (один из 72+ рампартов
    // батчево теряет 300 HP каждые RAMPART_DECAY_TIME, drop > 0 почти всегда истинно) и
    // (б) врагов было >=2 - один проходящий scout/Invader не должен триггерить.
    const rampartSuperDamagedTrigger = rampartSuperDamaged.length && maxRampartDrop > RAMPART_DECAY_AMOUNT && enemyCreeps.length >= 2;

    // Включаем SafeMode, если барьер или спаун повреждены.
    // Проверка на наличие врагов добавлена чтобы барьер нечайно сам не регрессировал + при апгрейде контроллера.
    // canActivateSafeMode - последним: там обход Game.rooms, нужен только когда триггер уже сработал.
    if ((rampartSuperDamagedTrigger || criticalUnderAttack || rampartUnderAttack) && enemyCreeps.length && canActivateSafeMode(room)) {
        const result = controller.activateSafeMode();
        if (result == OK) safeModeActivatedAt = Game.time;

        const reasons = [];
        if (rampartSuperDamagedTrigger) reasons.push(`rampart_super_damaged (${rampartSuperDamaged.length} <5% HP, drop=${maxRampartDrop}, enemies=${enemyCreeps.length})`);
        if (criticalUnderAttack)        reasons.push(`critical_struct_under_attack (drop=${maxCriticalDrop}: ${criticalStructs.filter(s => s.hits < s.hitsMax).map(s => s.structureType).join(',')})`);
        if (rampartUnderAttack)         reasons.push(`rampart_under_attack (drop=${maxRampartDrop})`);

        const lowestRampart = _.min(allRamparts, r => r.hits);
        const lowestHits = (lowestRampart && lowestRampart.hits !== Infinity) ? lowestRampart.hits : 'n/a';

        const text = `Safe mode ${result == OK ? 'was enabled' : `activation failed (${result.toStringStatus()})`} for room ${room.name}\n` +
                     `Trigger: ${reasons.join(', ')}\n` +
                     `Lowest rampart: ${lowestHits} HP, max drop this tick: ${maxRampartDrop}\n` +
                     `${enemyCreeps.length} enemy creeps`;
        log.warn(`defend:safe-mode:${room.name}`, text);
        // Письмо - только на успех. Со следующего тика controller.safeMode выставлен, и
        // canActivateSafeMode не пустит сюда повторно - одно письмо на активацию.
        if (result == OK) Game.notify(text);
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
    const inHoldDown = room.memory.last_attack_at !== undefined
                    && (Game.time - room.memory.last_attack_at) <= DEFEND_HOLD_TICKS;

    // Сам по себе safeMode defending не держит: пока враги стоят в комнате, threatActive и так
    // true (стройка стоит, checkStatus каждый тик - и в момент окончания safe mode лага нет);
    // ушли/убиты - через hold-down комната возвращается к стройке/ремонту/апгрейду. Раньше
    // controller.safeMode держал defending все 20000 тиков, и разрушенное нельзя было отстроить
    // именно в то окно, ради которого safe mode включали.
    const shouldDefend = threatActive || inHoldDown;

    if (shouldDefend) {
        if (room.memory.defending) {
            return;
        }
        const text = `Defending mode was enabled for room ${room.name}\n` +
                     `${enemyCreeps.length} enemy creeps, max rampart drop: ${maxRampartDrop}`;
        log.warn(`defend:on:${room.name}`, text);
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
    // Под safe mode тоже стреляем: движок блокирует только интенты чужих крипов, наши башни
    // работают как обычно, а враг не может лечиться - лучшего момента добить его нет.
    // Раньше список обнулялся под safeMode ("временная мера" из первой версии).
    const hostileCreeps = room.cache('hostileCreeps', r => r.find(FIND_HOSTILE_CREEPS));

    const structuresByType = utils.getStructuresByType(room);
    const ramparts = structuresByType[STRUCTURE_RAMPART] || [];
    const walls    = structuresByType[STRUCTURE_WALL]    || [];
    const damagedBarriers = ramparts.concat(walls).filter(s => s.hits < repairThreshold);

    const damagedRoadsContainers = !room.hasHostiles
        ? (structuresByType[STRUCTURE_ROAD] || []).concat(structuresByType[STRUCTURE_CONTAINER] || [])
            .filter(s => s.hitsMax - s.hits > 800)
        : [];

    // При врагах в комнате лечит не больше одной башни, остальные стреляют. Раньше любой
    // поцарапанный свой крип (даже в 20 клетках от боя) переключал ВСЕ башни на heal, и ни
    // одна не атаковала. Без врагов - как и было: каждая башня лечит ближайшего раненого.
    let healUsed = false;

    for (const tower of towers) {
        // Heal только в радиусе 20 - дальше эффективность падает до 25%, не стоит расхода энергии.
        const inRangeWounded = woundedCreeps.filter(c => tower.pos.inRangeTo(c, 20));
        const wounded = tower.pos.findClosestByRange(inRangeWounded);
        // healUsed - только при OK: пустая/неактивная башня (ERR_NOT_ENOUGH_ENERGY / ERR_RCL_NOT_ENOUGH)
        // не должна запрещать лечение остальным.
        if (wounded && !(hostileCreeps.length > 0 && healUsed) && tower.heal(wounded) == OK) {
            healUsed = true;
            continue;
        }

        if (hostileCreeps.length > 0) {
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

    // Если нет защитника, но есть крипы. Math.random()*N даёт [0,N), Math.floor → [0,N-1].
    // Прежний `* (creeps.length - 1)` исключал последнего чарджера: при 2 чарджерах второй
    // никогда не становился defender'ом.
    if (creeps.length && !defenders.length) {
        const index = Math.floor(Math.random() * creeps.length);
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