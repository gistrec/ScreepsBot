const rooms = [
    "W8S36",
]

const roleClaimer = {
    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Если не задан индекс комнаты, то устанавливаем
        if (!creep.memory.room_index) {
            creep.memory.room_index = 0;
        }
        const roomName = rooms[creep.memory.room_index];

        // Если нужно, то едем в комнату
        if (creep.room.name != roomName) {
            creep.say(`🏃${roomName}`);
            creep.moveTo(new RoomPosition(21, 27, "W8S36"), {
                reusePath: 10,
                // plainCost: 1,
                // swampCost: 1,
            });
            return;
        }else {
            /*if (creep.room.controller.sign && creep.room.controller.sign.text == "I have a plan for this room. Don't get in my way!") {
                // Переключаемся на другую комнату
                creep.memory.room_index += 1;
                if (creep.memory.room_index >= rooms.length) {
                    // Едем на переработку
                    creep.memory.recycling = true;
                }
                return;
            }*/
        }

        /*const controller = creep.room.controller;
        const needAttack = (controller.owner && controller.owner.username != "gistrec")
            || (controller.reservation && controller.reservation.username != "gistrec");
        const needReserve = (Game.gpl.level <= _.reduce(Game.rooms, (sum, room) => {
            if (!room.controller || room.controller.owner.username != "gistrec") return sum;
            return sum + 1;
        }));
            if (controller.owner )*/
        // const status = creep.reserveController(creep.room.controller);
        //const text = "I have a plan for this room. Don't get in my way!";
        //const status = creep.signController(creep.room.controller, text);
        const status = creep.attackController(creep.room.controller);
        if (status == ERR_NOT_IN_RANGE) {
            creep.say(`🏃Attack`);
            creep.moveTo(creep.room.controller, {
                //reusePath: 10,
                //plainCost: 1,
                //swampCost: 1,
            });
        }
	}
};

module.exports = roleClaimer;