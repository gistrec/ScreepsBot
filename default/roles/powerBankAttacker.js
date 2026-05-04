const roleAttacker = {
    run: function(creep) {
        if (creep.fatigue !== 0) return;

        const bank = Memory.power_banks ? Memory.power_banks[creep.memory.target_bank_id] : null;

        // Если задача отменена/банк убит/looted - recycle.
        if (!bank || bank.status === 'done' || bank.status === 'looting') {
            creep.memory.recycling = true;
            return;
        }

        // Self-heal каждый тик (бесплатно если есть HEAL parts).
        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }

        // Если в комнате банка - проверка на враждебные creeps с атакой.
        if (creep.room.name === bank.roomName) {
            const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                filter: c => _.find(c.body, p => p.type === ATTACK || p.type === RANGED_ATTACK)
            });
            if (hostile) {
                console.log(`[${creep.name}] Hostile detected at bank room, retreating to ${creep.memory.home_room}.`);
                creep.memory.recycling = true;
                return;
            }
        }

        // Travel в комнату банка.
        if (creep.room.name !== bank.roomName) {
            creep.moveTo(new RoomPosition(bank.x, bank.y, bank.roomName), {
                reusePath: 10,
                visualizePathStyle: {stroke: '#ff4444', lineStyle: 'dashed'},
            });
            return;
        }

        const target = Game.getObjectById(bank.id);
        if (!target) {
            // Банк уже мёртв/decay'd - выйдем по recycle через condition выше на след. тик.
            creep.memory.recycling = true;
            return;
        }

        if (creep.pos.isNearTo(target)) {
            creep.attack(target);
        } else {
            creep.moveTo(target, {reusePath: 5});
        }
    }
};

module.exports = roleAttacker;
