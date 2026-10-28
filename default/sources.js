const utils = require('./utils');

// Как часто майнер перепроверяет отсутствующий/протухший container_id и link_id (см. exports.get).
const RESCAN_INTERVAL = 50;

/**
 * Автоматически назначаем боту источник, который он будет копать.
 * @param {Creep} creep - Бот
 */
exports.get = function(creep, force = false) {
    if (force) {
        delete creep.memory.source_id;
        delete creep.memory.container_id;
        delete creep.memory.link_id;
    }

    let source = creep.memory.source_id ? Game.getObjectById(creep.memory.source_id) : null;

    // Если source ещё не назначен (или ссылка протухла) - выбираем.
    if (!source) {
        const roomSources = utils.getSources(creep.room);
        if (roomSources.length == 0) {
            return;
        }

        const replacementTtl = utils.minerReplacementTtl(creep.body.length);
        const otherRoomMiners = (() => {
            // Для Harvester нужно смотреть по всем крипам
            if (creep.memory.role == 'harvester') {
                return Object.keys(Game.creeps).map(creepName => Game.creeps[creepName]).filter(c => c.memory.role == "harvester" && c.id != creep.id)
            } else {
                return creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => ["miner", "remote_upgrader"].includes(c.memory.role) && c.id != creep.id && c.ticksToLive > replacementTtl
                });
            }
        })();

        source = roomSources.map((source) => {
            const minersCount = otherRoomMiners.filter((miner) => miner.memory.source_id == source.id).length;
            return {
                source: source,
                minersCount: minersCount,
            }
        }).sort((lhv, rhv) => {
            return lhv.minersCount - rhv.minersCount;
        }).shift()["source"];

        console.log(`[${creep.room.name}] Miner ${creep.name} will mine source ${source.id}`);
        creep.memory.source_id = source.id;
    }

    // Discovery контейнера и линка. Раньше делалась ровно один раз: null (ничего рядом) или
    // протухший id (контейнер снесён и отстроен заново) жили до смерти крипа - майнер со
    // storage и без линка стоял "💤Full" весь TTL, drop-miner сыпал на пол рядом с новым
    // контейнером. Теперь майнер перепроверяет, если id нет или объекта по нему больше нет,
    // но не чаще раза в RESCAN_INTERVAL тиков. Структуры берём из per-tick кеша (один find
    // на комнату за тик, общий с чарджером/build), а не room.find на каждого крипа.
    // harvester/remote_upgrader эти id не читают - им только первичный поиск, как раньше.
    const rescan = creep.memory.role == 'miner' && Game.time % RESCAN_INTERVAL == 0;

    if (creep.memory.container_id === undefined || (rescan && !Game.getObjectById(creep.memory.container_id))) {
        const container = (utils.getStructuresByType(creep.room)[STRUCTURE_CONTAINER] || [])
            .find(s => s.pos.isNearTo(source));
        const containerId = container ? container.id : null;
        if (containerId !== creep.memory.container_id) {
            creep.memory.container_id = containerId;
            // controller_id считается от позиции контейнера - пересчитываем под новый.
            delete creep.memory.controller_id;
            if (container) {
                console.log(`[${creep.room.name}] Miner ${creep.name} will use container at ${container.pos.x}:${container.pos.y}`);
            }
        }
    }
    const container = creep.memory.container_id ? Game.getObjectById(creep.memory.container_id) : null;

    // Линк ищем в range 2 от source, но заливать его майнер может только с контейнера
    // (transfer - range 1), поэтому при известном контейнере предпочитаем adjacent к нему
    // (build.js так и ставит). Линк, до которого с контейнера не дотянуться, считаем
    // протухшим и перепроверяем - вдруг правильный уже построен.
    const link = creep.memory.link_id ? Game.getObjectById(creep.memory.link_id) : null;
    const linkUnreachable = container && link && !link.pos.isNearTo(container);
    if (creep.memory.link_id === undefined || (rescan && (!link || linkUnreachable))) {
        const links = (utils.getStructuresByType(creep.room)[STRUCTURE_LINK] || [])
            .filter(s => s.pos.inRangeTo(source, 2));
        const best = (container && links.find(l => l.pos.isNearTo(container))) || links[0] || null;
        const linkId = best ? best.id : null;
        if (linkId !== creep.memory.link_id) {
            creep.memory.link_id = linkId;
            if (best) {
                console.log(`[${creep.room.name}] Miner ${creep.name} will use link at ${best.pos.x}:${best.pos.y}`);
            }
        }
    }

    // Контроллер, до которого можно дотянуться upgradeController'ом не двигаясь от контейнера.
    // upgradeController требует range 3. Майнер стоит ON контейнере → проверяем дистанцию
    // от контейнера, не от источника. Идея: пока source в cooldown или контейнер забит,
    // майнер не сидит без дела, а апгрейдит контроллер своими WORK-частями.
    if (creep.memory.controller_id === undefined) {
        const controller = creep.room.controller;
        if (controller && controller.my && container && container.pos.inRangeTo(controller, 3)) {
            creep.memory.controller_id = controller.id;
            console.log(`[${creep.room.name}] Miner ${creep.name} can upgrade controller (container range ${container.pos.getRangeTo(controller)} from controller)`);
        } else {
            creep.memory.controller_id = null;
        }
    }

    return source;
}

