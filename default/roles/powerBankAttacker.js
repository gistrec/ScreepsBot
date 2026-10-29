const settings = require('../settings');

// Travel в комнату банка через безопасный маршрут: Game.map.findRoute со
// штрафом Infinity на чужие owned-комнаты (видимые сейчас + засёрвейенные)
// плюс ручная настройка travel_avoid_rooms. Кешируем next-exit на creep.memory._route
// до перехода в следующую комнату - findRoute стоит ~0.1 CPU, реcompute только
// при пересечении границы.
function travelToBankRoom(creep, bankPos) {
    if (creep.room.name === bankPos.roomName) {
        creep.moveTo(bankPos, {
            reusePath: 10,
            visualizePathStyle: {stroke: '#ff4444', lineStyle: 'dashed'},
        });
        return;
    }
    const cached = creep.memory._route;
    if (!cached || cached.in !== creep.room.name || cached.to !== bankPos.roomName) {
        const route = Game.map.findRoute(creep.room.name, bankPos.roomName, {
            routeCallback: roomName => {
                if (roomName === bankPos.roomName) return 1;
                if (roomName === creep.room.name) return 1;
                const visible = Game.rooms[roomName];
                if (visible && visible.controller) {
                    if (visible.controller.my) return 1;
                    if (visible.controller.owner) return Infinity;
                }
                if (Memory.roomSurvey && Memory.roomSurvey[roomName] && Memory.roomSurvey[roomName].owned
                    && !(visible && visible.controller && visible.controller.my)) return Infinity;
                const avoid = settings.get(null, 'travel_avoid_rooms');
                if (avoid && avoid.includes(roomName)) return Infinity;
                return 1;
            },
        });
        if (route === ERR_NO_PATH || !route.length) {
            console.log(`[${creep.name}] No safe route ${creep.room.name} -> ${bankPos.roomName}, fallback direct`);
            creep.moveTo(bankPos, {reusePath: 10, visualizePathStyle: {stroke: '#ff4444', lineStyle: 'dashed'}});
            return;
        }
        creep.memory._route = {in: creep.room.name, to: bankPos.roomName, exit: route[0].exit};
    }
    const exit = creep.pos.findClosestByPath(creep.memory._route.exit);
    if (exit) {
        creep.moveTo(exit, {reusePath: 10, visualizePathStyle: {stroke: '#ff4444', lineStyle: 'dashed'}});
    } else {
        creep.moveTo(bankPos, {reusePath: 10, visualizePathStyle: {stroke: '#ff4444', lineStyle: 'dashed'}});
    }
}

const roleAttacker = {
    run: function(creep) {
        if (creep.fatigue !== 0) return;

        const bank = Memory.power_banks ? Memory.power_banks[creep.memory.target_bank_id] : null;
        // Кешируем target_room - bank-запись исчезает после looting/done, но no_retreat
        // крип должен ещё долбить хостайлов в той же комнате.
        if (bank && !creep.memory.target_room) {
            creep.memory.target_room = bank.roomName;
        }
        const targetRoom = creep.memory.target_room;

        // Self-heal каждый тик (бесплатно если есть HEAL parts). На тике с attack интент heal
        // снимается (см. attackAndDropHeal): в движке heal и attack взаимоисключающие
        // (processor/intents/creeps/intents.js: priorities.attack включает 'heal'), при обоих
        // интентах attack молча отбрасывается - атакер после первой же отдачи банка 3 тика из 4
        // только лечился.
        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }

        // no_retreat в target room: чужие крипы в приоритете над банком - дешманский крип
        // полезнее всего сбивать carrier'ов чужого сквада, чтобы они не успели подобрать
        // дроп. Бьём ЛЮБОГО хостайла (без фильтра по ATTACK/RANGED_ATTACK), включая carrier'ов.
        if (creep.memory.no_retreat && targetRoom && creep.room.name === targetRoom) {
            const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (hostile) {
                if (creep.pos.isNearTo(hostile)) {
                    attackAndDropHeal(creep, hostile);
                } else {
                    creep.moveTo(hostile, {reusePath: 3, visualizePathStyle: {stroke: '#ff0000'}});
                }
                return;
            }
        }

        // Если задача отменена/банк убит/looted - recycle.
        if (!bank || bank.status === 'done' || bank.status === 'looting') {
            creep.memory.recycling = true;
            return;
        }

        // Squad-логика: retreat при чужих атакерах в комнате банка. Флаг no_retreat отключает
        // retreat - для дешманских одноразовых крипов (130e [ATTACK,MOVE]), которые спавнятся
        // вручную из консоли и должны воевать, а не отступать.
        if (creep.room.name === bank.roomName && !creep.memory.no_retreat) {
            const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                filter: c => _.find(c.body, p => p.type === ATTACK || p.type === RANGED_ATTACK)
            });
            if (hostile) {
                console.log(`[${creep.name}] Hostile detected at bank room, retreating to ${creep.memory.home_room}.`);
                creep.memory.recycling = true;
                return;
            }
        }

        // Travel в комнату банка (через безопасный маршрут).
        if (creep.room.name !== bank.roomName) {
            travelToBankRoom(creep, new RoomPosition(bank.x, bank.y, bank.roomName));
            return;
        }

        const target = Game.getObjectById(bank.id);
        if (!target) {
            // Банк уже мёртв/decay'd - выйдем по recycle через condition выше на след. тик.
            creep.memory.recycling = true;
            return;
        }

        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, {reusePath: 5});
            return;
        }

        // Без хилера рядом не бьём. Отдача банка - POWER_BANK_HIT_BACK = 50% нанесённого урона
        // (20 ATTACK x4 = 2400 урона -> 1200 в ответ за тик), свой хил слабее (10 HEAL x4 = 480)
        // и с attack в одном тике не совместим. Банк сам не атакует - стоим рядом и ждём пару;
        // хилера, который ещё не заспавнен или погиб, доспавнит modules/powerBank. Крипы без
        // pair (ручные no_retreat) бьют сразу, как раньше. solo (хилера не будет - мало TTL,
        // ставит modules/powerBank) - бьём только на полных hits, между ударами self-heal.
        const healer = creep.memory.pair ? Game.creeps[creep.memory.pair] : null;
        if (creep.memory.pair && !(healer && healer.pos.isNearTo(creep))) {
            if (!creep.memory.solo) {
                creep.say('⏳Healer');
                return;
            }
            if (creep.hits < creep.hitsMax) return;
        }
        attackAndDropHeal(creep, target);
    }
};

// attack с отменой self-heal этого тика (cancelOrder -> intents.remove в driver'е): иначе движок
// отбросил бы attack. Если attack не прошёл (напр. ATTACK-части выбиты) - heal остаётся.
function attackAndDropHeal(creep, target) {
    if (creep.attack(target) === OK) creep.cancelOrder('heal');
}

module.exports = roleAttacker;
