const utils = require('utils');
const taskCreep = require('task.creep')

const MAX_PER_ROOM = 0;


const roleHealler = {
    spawn: function(room) {
        const spawn = room.find(FIND_MY_SPAWNS, {filter: (spawn) => spawn.name == room.name && !spawn.spawning}).shift();
        if (!spawn) return true;

        // const warriors = _.filter(Game.creeps, (creep) => creep.memory.role == 'healler');
        
        const name = 'Healler' + Game.time;
        const role = 'healler';
        const parts = [...Array(10).fill(TOUGH), ...Array(30).fill(HEAL), ...Array(10).fill(MOVE)]
        const energyStructures = utils.getEnergyStructures(room, spawn);

        spawn.spawnCreep(parts, name, {memory: { role }, energyStructures});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);
    },
    run: function(creep) {
        const damaged = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.hits != c.hitsMax && !c.memory.recycling
        });
        if (!damaged) {
            creep.heal(creep);
            return;
        }

        const status = creep.heal(damaged);
        if (status == ERR_NOT_IN_RANGE) {
            creep.moveTo(damaged, {
                reusePath: false,
                visualizePathStyle: {
                    stroke: '#00FF00'
                },
                maxRooms: 1
            });
            creep.heal(damaged);
            return;
        }
    }
};

module.exports = roleHealler;