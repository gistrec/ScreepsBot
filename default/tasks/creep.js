const taskRoom = require('./room');

/**
 * Проверяем ttl бота.
 * При необходимости отправляем на базу хилится
 */
exports.checkTTL = function(creep) {
    if (creep.memory.renewing) {
        // Ищем ближайший спаун
        const spawn = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_SPAWN
        });
        if (!spawn) {
            creep.memory.renewing = false;
            return ERR_NOT_FOUND;
        }
        if (spawn.store[RESOURCE_ENERGY] < 30) {
            creep.memory.renewing = false;
            return ERR_NOT_FOUND;
        }
        if (spawn.spawning) {
            creep.memory.renewing = false;
            return ERR_NOT_FOUND;
        }

        // const addTiks = floor(600 / creep.body.length);
        // const energy = ceil(creep_cost / 2.5 / creep.body.length)

        if (creep.ticksToLive > CREEP_LIFE_TIME - 100) {
            delete creep.memory.renewing;
            taskRoom.finishCreepRenewing(creep.room);

            if (creep.memory.role == 'upgrader' && creep.memory.link_id) {
                creep.memory.boost = "GH2O"
            }

            return ERR_NOT_FOUND;
        }

        const status = spawn.renewCreep(creep);
        if (status == ERR_NOT_IN_RANGE) {
            creep.moveTo(spawn, {
                // costCallback: (roomName, costMatrix) => {
                //    costMatrix.set(11, 45, 0);
                //    costMatrix.set(12, 44, 0);
                //},
                visualizePathStyle: {
                    stroke: '#00FF00'
                },
                maxRooms: 1
            });
        }
        if (status == ERR_BUSY) {
            if (!creep.pos.inRangeTo(spawn, 2)) {
                creep.moveTo(spawn, {
                    // costCallback: (roomName, costMatrix) => {
                    //    costMatrix.set(11, 45, 0);
                    //    costMatrix.set(12, 44, 0);
                    //},
                    visualizePathStyle: {
                        stroke: '#00FF00'
                    },
                    maxRooms: 1
                });
            }
        }
        // transfer только когда есть смысл: рядом со спавном, есть энергия, в спавне есть
        // место. Иначе бесполезно тратили intent-slot каждый тик renew'а на гарантированные
        // ERR_NOT_IN_RANGE/ERR_NOT_ENOUGH_RESOURCES/ERR_FULL.
        if (creep.pos.isNearTo(spawn)
            && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            creep.transfer(spawn, RESOURCE_ENERGY);
        }
        return OK;

    }
}

exports.checkRecycling = function(creep) {
    // Нужно ли ехать на переработку
    if (creep.memory.recycling) {
        creep.say(`🏃Recycle`);

        const spawn_id = (() => {
            // Пытаемся получить данные из памяти
            const found = creep.memory.spawn_id;
            if (found) return found;

            // Пытаемся найти ближайщий спаун в текущей комнате. Неактивный (после downgrade RCL)
            // не берём: recycleCreep на нём - ERR_RCL_NOT_ENOUGH.
            const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS, {filter: (s) => s.isActive()});
            if (spawn) {
                creep.memory.spawn_id = spawn.id;
                return spawn.id;
            }

            // Креп вне owned-room (powerBank-сквад, scout/claimer и т.п.) - идём в свою
            // home/spawn-room. Раньше тут стоял хардкод Game.spawns["Main"], спавна с таким
            // именем не существует - падало с TypeError на .id.
            const homeRoomName = creep.memory.home_room || creep.memory.spawn_room;
            if (homeRoomName) {
                const home = Game.rooms[homeRoomName];
                const homeSpawn = home && home.find(FIND_MY_SPAWNS, {filter: (s) => s.isActive()})[0];
                if (homeSpawn) {
                    creep.memory.spawn_id = homeSpawn.id;
                    return homeSpawn.id;
                }
            }

            // Последний fallback - любой свой спавн. Если совсем нет - креп умрёт от TTL.
            const anySpawn = Object.values(Game.spawns).find((s) => s.isActive());
            if (anySpawn) {
                console.log(`[Recycling] No home spawn for ${creep.name} ${creep.pos.x}:${creep.pos.y}:${creep.pos.roomName}, fallback to ${anySpawn.name}`);
                creep.memory.spawn_id = anySpawn.id;
                return anySpawn.id;
            }
            console.log(`[Recycling] No spawns available for ${creep.name} ${creep.pos.x}:${creep.pos.y}:${creep.pos.roomName}`);
            return null;
        })();
        if (!spawn_id) return;
        const spawn = Game.getObjectById(spawn_id);
        if (!spawn || !spawn.isActive()) {
            // Спавн по сохранённому id снесён (атака, перестройка) или неактивен (downgrade RCL).
            // Раньше spawn_id не перевыбирался: "Error Spawn" до смерти от TTL, а к неактивному
            // крип шёл через полкарты, чтобы там получить ERR_RCL_NOT_ENOUGH. Сбрасываем до
            // движения, следующий тик ищет заново.
            console.log(`[Recycling] Spawn ${spawn_id} for ${creep.name} is ${spawn ? 'inactive' : 'gone'}, re-resolving`);
            delete creep.memory.spawn_id;
            creep.say("Error Spawn");
            return OK;
        }

        // Двигаемся к спауну
        if (creep.room.name != spawn.room.name) {
            creep.moveTo(spawn);
            return OK;
        }
        const status = spawn.recycleCreep(creep);
        if (status == ERR_NOT_IN_RANGE) {
            creep.moveTo(spawn);
            return OK;
        }
        if (status != OK) {
            // Спавн стал неактивным между проверкой и вызовом и т.п. Раньше задача снималась без
            // переработки, роль ставила её снова - крип стоял у спавна до смерти. Перевыбираем
            // спавн (поиск выше берёт только активные), задачу держим.
            console.log(`[Recycling] ${creep.name} recycleCreep at ${spawn.name} failed: ${status} ${status.toStringStatus()}, re-resolving spawn`);
            delete creep.memory.spawn_id;
            return OK;
        }
        delete creep.memory.recycling;
        return OK;
    }
    return ERR_NOT_FOUND;
}

// Пределы ручной команды goto: тиков с выдачи команды и подряд идущих ERR_NO_PATH. Команда
// снималась только по точному совпадению позиции: клетка под стеной/структурой или занятая
// чужим крипом (движок достраивает путь до самой клетки, шаг в неё не исполняется) - крип шёл
// к ней до смерти, роль не исполнялась. Один ERR_NO_PATH - не повод: для поиска пути крипы -
// препятствия (чужой крип в проходе), и reuse-ветка moveTo отдаёт его при исчерпанном кеше пути.
const GOTO_MAX_TICKS = 300;
const GOTO_MAX_NO_PATH = 10;

exports.checkGoTo = function(creep) {
    if (creep.memory.goto) {
        creep.heal(creep);

        const position = creep.memory.goto.split(':');
        const room_name = (position.length == 3) ? position[2] : creep.room.name;
        if (creep.pos.x != position.x() || creep.pos.y != position.y() || creep.room.name != room_name) {
            // Состояние команды: цель, тик выдачи, подряд ERR_NO_PATH. Новая команда поверх
            // старой - новый отсчёт.
            let state = creep.memory.goto_state;
            if (!state || state.target != creep.memory.goto) {
                state = creep.memory.goto_state = {target: creep.memory.goto, at: Game.time, no_path: 0};
            }
            const status = creep.moveTo(new RoomPosition(position.x(), position.y(), room_name));
            state.no_path = (status == ERR_NO_PATH) ? state.no_path + 1 : 0;
            const reason = (Game.time - state.at > GOTO_MAX_TICKS) ? 'timeout'
                         : (state.no_path >= GOTO_MAX_NO_PATH) ? `${GOTO_MAX_NO_PATH}x ERR_NO_PATH` : null;
            if (reason) {
                // Команду снимаем, крип возвращается к роли в этот же тик (ERR_NOT_FOUND).
                console.log(`[${creep.room.name}] ${creep.name} goto ${creep.memory.goto} aborted at ${creep.pos.x}:${creep.pos.y}: ${reason}`);
                delete creep.memory.goto;
                delete creep.memory.goto_state;
                return ERR_NOT_FOUND;
            }
            creep.say(`Go to pos`);
        }else {
            delete creep.memory.goto;
            delete creep.memory.goto_state;
        }
        return OK;
    }
    // goto сняли руками - состояние тоже: иначе повторная команда на ту же клетку унаследует
    // старые at/no_path и может тут же отмениться по таймауту.
    if (creep.memory.goto_state) delete creep.memory.goto_state;
    return ERR_NOT_FOUND;
}