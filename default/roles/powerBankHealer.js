const roleHealer = {
    run: function(creep) {
        if (creep.fatigue !== 0) return;

        const bank = Memory.power_banks ? Memory.power_banks[creep.memory.target_bank_id] : null;

        if (!bank || bank.status === 'done' || bank.status === 'looting') {
            creep.memory.recycling = true;
            return;
        }

        const pair = creep.memory.pair ? Game.creeps[creep.memory.pair] : null;

        // Hostile detection в комнате банка - retreat.
        if (creep.room.name === bank.roomName) {
            const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                filter: c => _.find(c.body, p => p.type === ATTACK || p.type === RANGED_ATTACK)
            });
            if (hostile) {
                console.log(`[${creep.name}] Hostile detected, retreating.`);
                creep.memory.recycling = true;
                return;
            }
        }

        // Если пара мертва - возвращаемся.
        if (creep.memory.pair && !pair) {
            creep.memory.recycling = true;
            return;
        }

        // Move-логика: следуем за парой если она есть; иначе сами идём в комнату банка.
        if (pair) {
            // Вне комнаты пары или дальше 1 - двигаемся.
            if (creep.room.name !== pair.room.name || !creep.pos.isNearTo(pair)) {
                creep.moveTo(pair, {reusePath: 3, visualizePathStyle: {stroke: '#44ff44'}});
            }
        } else if (creep.room.name !== bank.roomName) {
            creep.moveTo(new RoomPosition(bank.x, bank.y, bank.roomName), {reusePath: 10});
            return;
        }

        // Heal: пара в приоритете (range 1, потом range 3), иначе сами.
        if (pair && pair.hits < pair.hitsMax) {
            if (creep.pos.isNearTo(pair)) {
                creep.heal(pair);
                return;
            }
            if (creep.pos.inRangeTo(pair, 3)) {
                creep.rangedHeal(pair);
                return;
            }
        }
        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }
    }
};

module.exports = roleHealer;
