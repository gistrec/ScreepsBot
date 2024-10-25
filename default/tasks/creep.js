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
        creep.transfer(spawn, RESOURCE_ENERGY);
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

            // Пытаемся найти ближайщий спаун
            const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
            if (spawn) {
                creep.memory.spawn_id = spawn.id;
                return spawn.id;
            }

            // Едем к дефолтному спауну
            console.log(`[Recycling] Can't find spawn for ${creep.name} ${creep.pos.x}:${creep.pos.y}:${creep.pos.roomName}`);
            creep.memory.spawn_id = Game.spawns["Main"].id;
            return creep.memory.spawn_id;
        })();
        const spawn = Game.getObjectById(spawn_id);
        if (!spawn) {
            creep.say("Error Spawn");
            return;
        }

        // Двигаемся к спауну
        if (creep.room.name != spawn.room.name || spawn.recycleCreep(creep) == ERR_NOT_IN_RANGE) {
            creep.moveTo(spawn);
            return OK;
        }
        delete creep.memory.recycling;
        return OK;
    }
    return ERR_NOT_FOUND;
}

exports.checkGoTo = function(creep) {
    if (creep.memory.goto) {
        creep.heal(creep);

        const position = creep.memory.goto.split(':');
        const room_name = (position.length == 3) ? position[2] : creep.room.name;
        if (creep.pos.x != position.x() || creep.pos.y != position.y() || creep.room.name != room_name) {
            creep.moveTo(new RoomPosition(position.x(), position.y(), room_name));
            creep.say(`Go to pos`);
        }else {
            delete creep.memory.goto;
        }
        return OK;
    }
    return ERR_NOT_FOUND;
}