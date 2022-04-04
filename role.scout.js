const rooms = [
    "W8S37",
    "W7S37",
    "W7S38",
]

const roleScout = {
    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если не задан индекс комнаты, то устанавливаем
        if (!creep.memory.room_index) {
            creep.memory.room_index = 0;
        }

        if (creep.memory.room_index >= creep.memory.rooms.length) {
            let target = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
            if (target) {
                creep.moveTo(target);
                creep.attack(target);
                return;
            }
            target = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
                filter: (s) => s.structureType != STRUCTURE_CONTROLLER
            });
            if (target) {
                creep.moveTo(target);
                creep.attack(target)
                return;
            }
            return;
        }

        const roomName = creep.memory.rooms[creep.memory.room_index];

        // Если нужно, то едем в комнату
        if (creep.room.name != roomName) {
            creep.say(`🏃${roomName}`);
            creep.moveTo(new RoomPosition(1, 43, roomName), {
                costCallback: (roomName, costMatrix) => {
                    const neutrals = creep.room.find(FIND_HOSTILE_CREEPS, {
                        filter: (c) => c.owner.username === 'Source Keeper'
                    });
                    for (const neutral of neutrals) {
                        const pos = neutral.pos;
                        for (let x = pos.x - 6; x < pos.x + 6; x++) {
                            for (let y = pos.y - 6; y < pos.y + 6; y++) {
                                costMatrix.set(x, y, 255 );
                            }
                        }
                    }
                },
                reusePath: 15,
                //swampCost: 1,
                //plainCost: 1,
            });
            return;
        }

        // Переключаемся на другую комнату
        if (creep.memory.room_index < creep.memory.rooms.length) {
            creep.memory.room_index += 1;
            return;
        }


	}
};

module.exports = roleScout;