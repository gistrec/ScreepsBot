const utils = require('../utils');

// PowerCreep operator. Стоит у power_spawn, генерирует ops каждые 50 тиков (PWR_GENERATE_OPS).
// При накоплении достаточного количества - дропает в storage/terminal.
// Роль - для всех задеплоенных PC аккаунта (main.js вызывает run на каждом из Game.powerCreeps);
// Memory.operators нужен только для spawn/upgrade в modules/power.js.

const OPS_TRANSFER_THRESHOLD = 100;
// Ниже этого TTL продлеваем жизнь у power_spawn (renew бесплатен, TTL снова POWER_CREEP_LIFE_TIME).
// Смерть PC - это spawnCooldownTime +8 часов реального времени (engine _diePowerCreep), до неё не доводим.
const RENEW_TTL = 1000;

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

        const moveOpts = {visualizePathStyle: {stroke: '#ff66ff'}, maxRooms: 1};

        // Renew первым: TTL низкий - идём к power_spawn и продлеваем, что бы ни было дальше.
        if (pc.ticksToLive < RENEW_TTL) {
            if (pc.pos.isNearTo(ps)) {
                const r = pc.renew(ps);
                if (r !== OK && Game.time % 100 === 0) {
                    console.log(`[${room.name}][operator] renew err ${r} ${r.toStringStatus()}`);
                }
            } else {
                pc.moveTo(ps, moveOpts);
            }
            return;
        }

        // usePower в комнате без включённого power -> ERR_INVALID_ARGS. Один раз подходим к
        // контроллеру и включаем (enableRoom); флаг isPowerEnabled у контроллера постоянный.
        const controller = room.controller;
        if (controller && controller.my && !controller.isPowerEnabled) {
            if (pc.pos.isNearTo(controller)) {
                pc.enableRoom(controller);
            } else {
                pc.moveTo(controller, moveOpts);
            }
            return;
        }

        // Генерируем ops если cooldown готов. GENERATE_OPS без цели и дальности - работает и по дороге.
        // В полный трюм не генерируем: движок выбрасывает излишек на землю (usePower.js GENERATE_OPS).
        const op = pc.powers[PWR_GENERATE_OPS];
        if (op && (op.cooldown || 0) === 0
         && pc.store.getFreeCapacity(RESOURCE_OPS) >= POWER_INFO[PWR_GENERATE_OPS].effect[op.level - 1]) {
            const r = pc.usePower(PWR_GENERATE_OPS);
            if (r !== OK && r !== ERR_TIRED) {
                console.log(`[${room.name}][operator] usePower(GENERATE_OPS) err ${r} ${r.toStringStatus()}`);
            }
        }

        // Offload ops в storage/terminal. Пока ops >= порога - едем к складу и не возвращаемся
        // к power_spawn; transfer без amount отдаёт всё, что влезает -> ops < порога -> обратно.
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
                return;
            }
        }

        // Стоим у power_spawn.
        if (!pc.pos.inRangeTo(ps, 1)) {
            pc.moveTo(ps, moveOpts);
        }
    }
};

module.exports = roleOperator;
