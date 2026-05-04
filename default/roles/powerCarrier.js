const roleCarrier = {
    run: function(creep) {
        if (creep.fatigue !== 0) return;

        const bank = Memory.power_banks ? Memory.power_banks[creep.memory.target_bank_id] : null;
        const carrying = creep.store.getUsedCapacity(RESOURCE_POWER);

        // Запись о банке исчезла или операция завершена - сдаём power и recycle.
        if (!bank || bank.status === 'done') {
            if (carrying > 0) {
                returnHome(creep);
            } else {
                creep.memory.recycling = true;
            }
            return;
        }

        // Если полный трюм - везём домой и не возвращаемся пока пуст.
        if (creep.store.getFreeCapacity() === 0) {
            returnHome(creep);
            return;
        }

        // Атака идёт - hover в home_room (не лезем под огонь, не трогаем decay).
        if (bank.status === 'attacking') {
            if (creep.room.name !== creep.memory.home_room) {
                creep.moveTo(new RoomPosition(25, 25, creep.memory.home_room), {reusePath: 20});
            }
            return;
        }

        // status === 'looting' - идём за дропом.
        if (creep.room.name !== bank.roomName) {
            creep.moveTo(new RoomPosition(bank.x, bank.y, bank.roomName), {
                reusePath: 10,
                visualizePathStyle: {stroke: '#ffaa00', lineStyle: 'dashed'},
            });
            return;
        }

        // В комнате банка - ищем drop power.
        const drop = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_POWER
        });
        if (drop) {
            if (creep.pos.isNearTo(drop)) {
                creep.pickup(drop);
            } else {
                creep.moveTo(drop, {reusePath: 5});
            }
            return;
        }

        // Дропа нет - может быть в ruin'е (если банк только что killed - ресурсы лежат в ruin).
        const ruin = creep.pos.findClosestByRange(FIND_RUINS, {
            filter: r => r.store.getUsedCapacity(RESOURCE_POWER) > 0
        });
        if (ruin) {
            if (creep.pos.isNearTo(ruin)) {
                creep.withdraw(ruin, RESOURCE_POWER);
            } else {
                creep.moveTo(ruin, {reusePath: 5});
            }
            return;
        }

        // Ничего не осталось в комнате - везём что есть и recycle если пусто.
        if (carrying > 0) {
            returnHome(creep);
        } else {
            creep.memory.recycling = true;
        }
    }
};

function returnHome(creep) {
    if (creep.room.name !== creep.memory.home_room) {
        creep.moveTo(new RoomPosition(25, 25, creep.memory.home_room), {reusePath: 10});
        return;
    }
    const room = Game.rooms[creep.memory.home_room];
    if (!room) return;

    const target = (room.storage && room.storage.store.getFreeCapacity(RESOURCE_POWER) > 0)
        ? room.storage
        : (room.terminal && room.terminal.store.getFreeCapacity(RESOURCE_POWER) > 0 ? room.terminal : null);
    if (!target) {
        // Складировать некуда - дропнем рядом со storage.
        if (room.storage && !creep.pos.isNearTo(room.storage)) {
            creep.moveTo(room.storage);
        }
        return;
    }

    if (creep.pos.isNearTo(target)) {
        creep.transfer(target, RESOURCE_POWER);
    } else {
        creep.moveTo(target, {reusePath: 5});
    }
}

module.exports = roleCarrier;
