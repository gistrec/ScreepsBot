const utils = require('../utils')

const taskCreep = require('../tasks/creep')
const taskBoost = require('../tasks/boost')

const MAX_PER_ROOM = 0;


const WHITELIST = ["ganyu"];

const roleWarrior = {
    update: function() {
        const warriors = _.filter(Game.creeps, (creep) => creep.memory.role == 'warrior');
        if(warriors.length <= MAX_PER_ROOM) {
            const name = 'Warrior' + Game.time;
            console.log('Spawning new warrior: ' + name);
            Game.spawns[''].spawnCreep([TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, ATTACK, ATTACK], name, {
                memory: {
                    role: 'warrior',
                }
            });
        }
    },
    run: function(creep) {
        // if (creep.fatigue != 0) return;

        /*if (taskBoost.canBoost(creep, "XUH2O") && !taskBoost.hasBoost(creep, "XUH2O")) {
            console.log("Need XUH2O")
            creep.memory.boost = "XUH2O";
            return;
        }


        if (taskBoost.canBoost(creep, "XZHO2") && !taskBoost.hasBoost(creep, "XZHO2")) {
            console.log("Need XZHO2")
            creep.memory.boost = "XZHO2";
            return;
        }
        if (taskBoost.canBoost(creep, "XLHO2") && !taskBoost.hasBoost(creep, "XLHO2")) {
            console.log("Need XLHO2")
            creep.memory.boost = "XLHO2";
            return;
        }
        if (taskBoost.canBoost(creep, "XGHO2") && !taskBoost.hasBoost(creep, "XGHO2")) {
            console.log("Need XGHO2")
            creep.memory.boost = "XGHO2";
            return;
        }*/

        /*if (creep.room.name !== target_location.roomName()) {
            creep.moveTo(target_location.roomPosition(), {
                visualizePathStyle: {
                    stroke: 'red',
                    lineStyle: 'dotted',
                    opacity: .75
                }
            });
            creep.heal(creep);
            return;
        }*/

        const target = (() => {
            const target = Game.getObjectById(creep.memory.attack_id || creep.memory.target_id);
            if (target) return target;

            // Затем атакуем башню
            const tower = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
                filter: (s) => s.structureType == STRUCTURE_TOWER
            });
            if (tower) return tower;

            // Затем атакуем крипов
            //const enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            //if (enemy) return enemy;

            // Затем атакуем спаун
            const spawn = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
                filter: (s) => s.structureType == STRUCTURE_SPAWN
            });
            if (spawn) return spawn;

            // Затем другие структуры
            const structures = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
                filter: (s) => s.structureType != STRUCTURE_CONTROLLER
            });
            if (structures) return structures;

            if (creep.room.controller && !creep.room.controller.my) {
                const structures = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s) => s.structureType != STRUCTURE_CONTROLLER && s.structureType != STRUCTURE_WALL
                });
                if (structures) return structures;
            }
        })();
        if (target) {
            const result = creep.attack(target)
            if(result == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
         /*   creep.moveTo(target, {
                reusePath: false,
                visualizePathStyle: {
                    stroke: 'red',
                    lineStyle: 'dashed',
                    opacity: .75
                },
                costCallback: (roomName, costMatrix) => {
                    costMatrix.set(39, 30, 999);
                    costMatrix.set(39, 31, 999);
                },
            });

            //if (target.structureType) {
            //    creep.attack(target);
            //    creep.dismantle(target)
            //}else {
                const result = creep.attack(target);
                console.log(target);
            //    creep.rangedAttack(target);
                console.log(result)
            }*/
        }
        if (creep.hits != creep.hitsMax) {
            creep.heal(creep);
        }
    }
};

module.exports = roleWarrior;