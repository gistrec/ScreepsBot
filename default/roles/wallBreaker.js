const profiler = require('../screeps-profiler');
const utils = require('../utils');


// Разовая задача "снести структуру в чужой/нейтральной комнате". Запускается через
// Memory.wall_break = {target_id, target_room, home_room, boost?}.
//
// Тело: 25 WORK + 25 MOVE = 2500 ⚡. На plain'е fatigue 25×2 = 50 в тик, MOVE даёт 25×2 = 50,
// идёт без задержек. Без буста: 25 * DISMANTLE_POWER(50) = 1250 dmg/тик, за 1500 TTL = 1.875M.
// С ZH ×2: 2500 dmg/тик, 1500 TTL = 3.75M - 2M стенка валится с запасом.
//
// После уничтожения цели - Memory.wall_break удаляется, крип suicide'ит.

const BODY = [].concat(
    Array(25).fill(WORK),
    Array(25).fill(MOVE),
);
const BODY_COST = utils.bodyCost(BODY);  // 2500


const roleWallBreaker = {
    spawn: function() {
        const task = Memory.wall_break;
        if (!task || !task.target_id || !task.target_room || !task.home_room) return true;

        // Один за раз. Если живой wall_breaker есть - ничего не делаем.
        const existing = utils.allCreepsByRole('wall_breaker');
        if (existing.length > 0) return true;

        const home = Game.rooms[task.home_room];
        if (!home || !home.controller || !home.controller.my) {
            console.log(`[wall_breaker] home_room ${task.home_room} not owned/visible`);
            return true;
        }

        const spawn = utils.findFreeSpawn(home, {primaryOnly: false});
        if (!spawn) return false;

        if (home.energyAvailable < BODY_COST) {
            console.log(`[${home.name}][wall_breaker] Need ${BODY_COST} energy, have ${home.energyAvailable}`);
            return false;
        }

        const name = 'WallBreaker' + Game.time;
        const memory = {
            role: 'wall_breaker',
            target_id: task.target_id,
            target_room: task.target_room,
            home_room: task.home_room,
        };
        if (task.boost) memory.boost = task.boost;

        const r = spawn.spawnCreep(BODY, name, {memory});
        if (r === OK) {
            console.log(`[${home.name}][wall_breaker] Spawning ${name} → ${task.target_room}${task.boost ? ' (boost ' + task.boost + ')' : ''}`);
        } else {
            console.log(`[${home.name}][wall_breaker] spawnCreep failed: ${r} ${r.toStringStatus()}`);
        }
        return false;
    },

    run: function(creep) {
        if (creep.fatigue !== 0) return;

        // TTL мал и у цели ещё много hits - возвращаемся домой recycle'нуться (через taskCreep).
        // Простой вариант: если TTL < 50 и цель ещё жива - просто self-suicide на месте.
        if (creep.ticksToLive !== undefined && creep.ticksToLive < 50) {
            creep.suicide();
            return;
        }

        // Идём в target_room. Видимость цели появится только когда мы окажемся в её комнате -
        // Game.getObjectById возвращает undefined для невидимых комнат, поэтому проверять
        // "цель жива" имеет смысл только после прибытия.
        if (creep.room.name !== creep.memory.target_room) {
            creep.moveTo(new RoomPosition(25, 25, creep.memory.target_room), {
                reusePath: 20,
                visualizePathStyle: {stroke: '#ff8800', lineStyle: 'dashed'},
            });
            return;
        }

        // В target_room - цель должна быть видна. Если её нет - значит снесли.
        const target = Game.getObjectById(creep.memory.target_id);
        if (!target) {
            console.log(`[${creep.room.name}][wall_breaker] ${creep.name} target gone, task complete`);
            delete Memory.wall_break;
            creep.suicide();
            return;
        }

        // Дотягиваемся до цели и долбим.
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, {reusePath: 5, range: 1});
            return;
        }
        creep.dismantle(target);
    }
};


module.exports = roleWallBreaker;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.wallBreaker.spawn");
module.exports.run   = profiler.registerFN(module.exports.run,   "role.wallBreaker.run");
