const taskCreep = require('task.creep')
const taskBoost = require('task.boost')

const MAX_PER_ROOM = 0;

const target_id = "60115a2cd447292e8ф5f0d7";
const target_location = "9:28:W7S37"

const roleWarrior = {
    update: function() {
        const warriors = _.filter(Game.creeps, (creep) => creep.memory.role == 'warrior');
        if(warriors.length < MAX_PER_ROOM) {
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

        // if (taskCreep.checkTTL(creep)   == OK) return;
        if (taskBoost.checkBoost(creep) == OK) return;
        if (taskBoost.canBoost(creep, "XUH2O") && !taskBoost.hasBoost(creep, "XUH2O")) {
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
        }
        
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
            const target = Game.getObjectById(creep.memory.attack_id);
            if (target) return target;
            
            // return new RoomPosition(28, 23, "W8S36").findClosestByRange(FIND_HOSTILE_CREEPS);
            

            // Затем атакуем башню
            const tower = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
                filter: (s) => s.structureType == STRUCTURE_TOWER
            });
            if (tower) return tower;

            // Затем атакуем крипов
            const enemy = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (enemy) return enemy;

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
        })();
        if (target) {
            creep.moveTo(target, {
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
            
            if (target.structureType) {
                creep.dismantle(target)
            }else {
                creep.attack(target);   
            }
            
            if (creep.hits  !=  creep.hitsMax) {
                // creep.heal(creep);
            }
            return;
        }
    }
};

module.exports = roleWarrior;