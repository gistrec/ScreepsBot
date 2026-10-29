const profiler = require('../screeps-profiler');

const utils = require('../utils');

const taskCreep     = require('../tasks/creep');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');



const MAX_CREEPS_PER_ROOM = 1;


const roleUpgrader = {
    spawn: function(room) {
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) {
            return true;
        }

        const upgraders = utils.creepsByRole(room, "controller_upgrader");

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
        const name = 'ControllerUpgrader' + Game.time;
        const role = 'controller_upgrader';
        spawn.spawnCreep(parts, name, {memory: {role, boost}, energyStructures: [
            // Сначала выкачиваем энергию из экстеншенов.
            ...room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_EXTENSION}),
            spawn
        ]});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);

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
            // link_id задаётся руками из консоли (spawn его не пишет). Без него или с протухшим
            // id withdraw(null) возвращал ERR_INVALID_TARGET каждый тик - крип с пустым трюмом
            // стоял до смерти. Протухший id сбрасываем, без линка берём энергию из складов.
            const link = creep.memory.link_id ? Game.getObjectById(creep.memory.link_id) : null;
            if (creep.memory.link_id && !link) {
                console.log(`[${creep.room.name}] ${creep.name} link ${creep.memory.link_id} is gone, withdrawing from storage`);
                delete creep.memory.link_id;
            }
            if (link) {
                taskResource.withdrawTarget(creep, link);
                return;
            }
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE ], RESOURCE_ENERGY) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER], RESOURCE_ENERGY);
        }
	}
};


module.exports = roleUpgrader;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.controllerUpgrader.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.controllerUpgrader.run");