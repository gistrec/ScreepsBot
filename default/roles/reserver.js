const profiler = require('../screeps-profiler');


// Reserver - удалённый резервер контроллеров. Едет в target_room, кастует
// reserveController, продлевая reservation. На зарезервированной комнате source
// даёт полные 3000 энергии за регенерацию (vs 1500 на нейтральной).
//
// Конфиг: Memory.remote_rooms[home_room] = ["W10S38", "W11S38", ...].
// На каждый target_room спавнится один reserver.
//
// Body: 2 CLAIM + 2 MOVE = 1300 energy. CLAIM добавляет 1 тик к reservation.ticksToEnd
// при каждом успешном reserveController() (cap = 5000). С 2 CLAIM мы добавляем по 2/тик.
// TTL CLAIM-крипа = 600 (CREEP_CLAIM_LIFE_TIME) - не хватает чтобы дотянуть от 0 до 5000,
// но в режиме "поддержки" (входящий ~4000) одного крипа достаточно надолго.

const BODY = [CLAIM, CLAIM, MOVE, MOVE];
const BODY_COST = 1300;


const roleReserver = {
    spawn: function(room) {
        const targets = (Memory.remote_rooms && Memory.remote_rooms[room.name]) || [];
        if (targets.length === 0) return true;

        const spawn = room.find(FIND_MY_SPAWNS, {filter: (s) => s.name == room.name && !s.spawning && s.isActive()}).shift();
        if (!spawn) return true;

        for (const target_room of targets) {
            const existing = _.find(Game.creeps, c =>
                c.memory.role == 'reserver' && c.memory.target_room == target_room
            );
            if (existing) continue;

            if (room.energyAvailable < BODY_COST) {
                console.log(`[${room.name}] Need reserver for ${target_room}, but not enough energy [${room.energyAvailable}/${BODY_COST}]`);
                return false;
            }

            const name = `Reserver_${target_room}_${Game.time}`;
            const result = spawn.spawnCreep(BODY, name, {
                memory: {role: 'reserver', home_room: room.name, target_room}
            });
            if (result === OK) {
                console.log(`[${room.name}] Spawning reserver ${name} for ${target_room}`);
                return false;
            }
        }
        return true;
    },

    run: function(creep) {
        if (creep.fatigue != 0) return;

        const target = creep.memory.target_room;
        if (!target) {
            creep.suicide();
            return;
        }

        // Travel to target room.
        if (creep.room.name != target) {
            const exitDir = creep.room.findExitTo(target);
            if (exitDir < 0) {
                console.log(`[${creep.name}] No path to ${target} (err ${exitDir})`);
                return;
            }
            const exitPos = creep.pos.findClosestByRange(exitDir);
            if (exitPos) creep.moveTo(exitPos, {reusePath: 20});
            return;
        }

        const controller = creep.room.controller;
        if (!controller) {
            creep.suicide();
            return;
        }

        // Чужая клейменая или зарезервированная другим игроком - сначала ломаем.
        // attackController снимает 1 тик resv/претензии, но имеет cooldown 1000 тиков
        // (CONTROLLER_ATTACK_BLOCKED_UPGRADE) - в практике дотянуть до сноса дольше TTL,
        // но это лучше, чем стоять без дела.
        const myUsername = creep.owner.username;
        const isHostile = controller.owner && controller.owner.username !== myUsername
                       || (controller.reservation && controller.reservation.username !== myUsername);
        if (isHostile) {
            const status = creep.attackController(controller);
            if (status === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, {reusePath: 10});
            } else if (status === ERR_TIRED) {
                creep.say(`⏳atk`);
            } else if (status !== OK) {
                creep.say(`⚠️atk${status}`);
            } else {
                creep.say(`💥`);
            }
            return;
        }

        const status = creep.reserveController(controller);
        if (status === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, {reusePath: 10});
        } else if (status !== OK) {
            creep.say(`⚠️${status}`);
        }
    }
};

module.exports = roleReserver;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.reserver.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.reserver.run");
