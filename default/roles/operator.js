const utils = require('../utils');

// PowerCreep operator. Стоит у power_spawn, генерирует ops каждые 50 тиков (PWR_GENERATE_OPS).
// При накоплении достаточного количества - дропает в storage/terminal.

const OPS_TRANSFER_THRESHOLD = 100;

const roleOperator = {
    run: function(pc) {
        if (pc.spawning) return;
        const room = pc.room;
        if (!room) return;

        const ps = (utils.getMyStructuresByType(room)[STRUCTURE_POWER_SPAWN] || [])[0];
        if (!ps) {
            pc.say('no PS');
            return;
        }

        // Стоим у power_spawn.
        if (!pc.pos.inRangeTo(ps, 1)) {
            pc.moveTo(ps, {visualizePathStyle: {stroke: '#ff66ff'}, maxRooms: 1});
            return;
        }

        // Генерируем ops если cooldown готов.
        const op = pc.powers[PWR_GENERATE_OPS];
        if (op && (op.cooldown || 0) === 0) {
            const r = pc.usePower(PWR_GENERATE_OPS);
            if (r !== OK && r !== ERR_TIRED) {
                console.log(`[${room.name}][operator] usePower(GENERATE_OPS) err ${r}`);
            }
        }

        // Offload ops в storage/terminal.
        const ops = pc.store.getUsedCapacity(RESOURCE_OPS);
        if (ops >= OPS_TRANSFER_THRESHOLD) {
            const target = (room.storage && room.storage.store.getFreeCapacity() > 0)
                ? room.storage
                : (room.terminal && room.terminal.store.getFreeCapacity() > 0 ? room.terminal : null);
            if (target) {
                if (pc.pos.inRangeTo(target, 1)) {
                    pc.transfer(target, RESOURCE_OPS);
                } else {
                    pc.moveTo(target);
                }
            }
        }
    }
};

module.exports = roleOperator;
