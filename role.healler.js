const taskCreep = require('task.creep')

const MAX_PER_ROOM = 0;

const roleHealler = {
    update: function() {
        const warriors = _.filter(Game.creeps, (creep) => creep.memory.role == 'healler');
        if(warriors.length < MAX_PER_ROOM) {
            const name = 'Healler' + Game.time;
            console.log('Spawning new healler: ' + name);
            Game.spawns['Spawn1'].spawnCreep([MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, HEAL, HEAL, HEAL, HEAL, HEAL, ATTACK, ATTACK], name, {
                memory: {
                    role: 'healler',
                }
            });
        }
    },
    run: function(creep) {
        //if (creep.fatigue != 0) return;

        creep.heal(creep);

        // Если бот лечится
        if (taskCreep.checkTTL(creep) == OK) return;

        // Если крип - танк, то пытаемся проникнуть на вражескую территорию, если есть ХП
        if (creep.memory.tank) {
            // Если хп не все, то отъезжаем + хилимся
            if (creep.hitsMax - creep.hits > 500) {
                creep.moveTo(new RoomPosition(9, 1, "W8S37"));
                return;
            }
            // Едем в комнату врага, если не в ней
            console.log(creep.room.name)
            if (creep.room.name != "W8S36") {
                creep.moveTo(new RoomPosition(9, 48, "W8S36"));
                return;
            }
            //creep.moveTo(new RoomPosition(9, 26, "W7S37"));
        }/*else {
            if (creep.room.name !== "W8S37") {
                //creep.moveTo(new RoomPosition(48, 24, "W8S37"), {
                //    reusePath: false
                //});
                return;
            }
        }*/

        /*const damaged = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.hits != c.hitsMax
                        && !c.memory.recycling
        });
        const status = creep.heal(damaged);
        if (status == ERR_NOT_IN_RANGE) {
            //creep.moveTo(damaged, {
            //    reusePath: false,
            //    visualizePathStyle: {
            //        stroke: '#00FF00'
            //    },
            //    maxRooms: 1
            //});
            creep.heal(damaged);
            return;
        }*/

        const target = (() => {
            // Сначала атакуем стену
            const wall = Game.getObjectById("60018d7e6446c14bf8e1f575");
            if (wall) return wall;

            // Затем атакуем башни
            //const tower = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            //if (tower) return tower;

            // Затем атакуем башни
            //const structure = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES);
            //if (structure) return structure;
        })();
        if (target) {
            const status = creep.attack(target)
            if (status == ERR_NOT_IN_RANGE) {
                creep.moveTo(target, {
                    reusePath: false
                });
                creep.attack(target)
            }
            return;
        }
    }
};

module.exports = roleHealler;