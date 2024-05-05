const utils = require('utils');

const taskCreep     = require('task.creep');
const taskResource  = require('task.resource');
const taskStructure = require('task.structure');



const MAX_CREEPS_PER_ROOM = 1;


const roleUpgrader = {
    spawn: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => /* spawn.name == room.name && */ !spawn.spawning && spawn.isActive()}).shift();
        if (!spawn) {
            return true;
        }
        
        const upgraders = room.find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "controller_upgrader"});
        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        
        
        if (upgraders.length >= MAX_CREEPS_PER_ROOM) {
            return true;
        }

        parts = [WORK,  WORK,  WORK,  WORK,  WORK, 
                 WORK,  WORK,  WORK,  WORK,  WORK, 
                 WORK,  WORK,  WORK,  WORK,  WORK, 
                 WORK,  WORK,  WORK,  WORK,  WORK, 
                 CARRY, CARRY, CARRY, CARRY,
                 MOVE,  MOVE,  MOVE,  MOVE]
        
        const boost = (room.name == "W8S36") ? "XLH2O" : false; // Boost repair and build
        const boost = false;
        const name = 'ControllerUpgrader' + Game.time;
        const role = 'controller_upgrader';
        spawn.spawnCreep(parts, name, {memory: {role, boost}, energyStructures: [
            // Сначала выкачиваем энергию из экстеншенов.
            ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_EXTENSION}),
            spawn
        ]});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        taskResource.chechHarvesting(creep);
	    if(!creep.memory.harvesting) {
            taskStructure.upgradeController(creep);
            return;
        }else {
            taskResource.withdrawTarget(creep, Game.getObjectById(creep.memory.link_id));
        }
	}
};

module.exports = roleUpgrader;