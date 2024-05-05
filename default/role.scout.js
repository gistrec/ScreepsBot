const utils = require('utils');


const configurations = [
    {"energy": 200, "parts": [MOVE, MOVE, MOVE, MOVE]}
]


const roleClaimer = {
    spawn: function() {
        if (Memory.claiming.status !== 'scout') {
            return true;
        }

        const scouts = Object.keys(Game.creeps).filter((creepName) => Game.creeps[creepName].memory.role === 'scout');
        if (scouts.length !== 0) {
            return true;
        }

        // TODO: Find nearest room.
        const room = Object.keys(Game.rooms).map(roomName => Game.rooms[roomName])
                               .filter(room => room.controller && room.controller.my)
                               .sort((lhv, rhv) => lhv.energyAvailable - rhv.energyAvailable)
                               .pop(); // Last
        const spawn = room.find(FIND_MY_SPAWNS)
                          .filter(spawn => !spawn.spawning)
                          .sort((lhv, rhv) => lhv.energy - rhv.energy)
                          .pop(); // Last
        if (!spawn) {
            return false;
        }

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        if (creepConfiguration["energy"] > room.energyCapacityAvailable) {
            console.log(`Room ${room.name} need Scout, but not enought energy [${room.energyCapacityAvailable}/${creepConfiguration["energy"]}]`)
            return false;
        }

        const name = 'Scout' + Game.time;
        const role = 'scout';
        spawn.spawnCreep(creepConfiguration["parts"], name, {memory: { role }});
        console.log(`Spawning new ${role} ${name} in ${room.name}`);

        return false;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        const expand = Game.flags['Expand'];

        // Move to expand room.
        if (expand.room == undefined || expand.room != creep.room) {   
            creep.moveTo(expand, {reusePath: 10});
            return;
        }
        if (!Memory.claiming.roomName || Memory.claiming.status == "scout") {
            Memory.claiming.roomName = creep.room.name;
            Memory.claiming.status = 'claimer';
            console.log(`Scout find expand room ${creep.room.name}`);
            console.log(`Claiming status change scout->claimer`);
        }
        
        // Idle...
	}
};

module.exports = roleClaimer;