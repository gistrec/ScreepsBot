const utils = require('utils')

const taskCreep = require('task.creep');
const taskBoost = require('task.boost');
const taskResource  = require('task.resource');


const roleTransport = {
    update: function() {
        const warriors = _.filter(Game.creeps, (creep) => creep.memory.role == 'warrior');
        if(warriors.length <= MAX_PER_ROOM) {
            const name = 'Warrior' + Game.time;
            console.log('Spawning new warrior: ' + name);
            Game.spawns[''].spawnCreep([TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, ATTACK, ATTACK], name, {
                memory: {
                    role: 'transport',
                }
            });
        }
    },
    run: function(creep) {
        if (taskBoost.canBoost(creep, "XKH2O") && !taskBoost.hasBoost(creep, "XKH2O")) {
            console.log("Need XKH2O for carry")
            creep.memory.boost = "XKH2O";
            return;
        }
        
        if (taskBoost.canBoost(creep, "XZHO2") && !taskBoost.hasBoost(creep, "XZHO2")) {
            console.log("Need XZHO2 for MOVE")
            creep.memory.boost = "XZHO2";
            return;
        }
        
        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            const target = Game.getObjectById(creep.memory.target_id);
            if (target.room != creep.room) {
                creep.moveTo(target);
                return;
            }
            taskResource.fillTarget(creep, target);
	    } else {
            const source = Game.getObjectById(creep.memory.source_id);
            if (source.room != creep.room) {
                creep.moveTo(source);
                return;
            }
            taskResource.withdrawTarget(creep, source, RESOURCE_ENERGY);
        }
    }
};

module.exports = roleTransport;