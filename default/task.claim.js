function canClaimNewRoom() {
    const myRooms = Object.keys(Game.rooms).map(roomName => Game.rooms[roomName]).filter(room => room.controller && room.controller.my);
    if (myRooms.length >= Game.gcl.level) {
        return false;
    }
    return true;
}

exports.checkNewExpand = function() {
    if (!canClaimNewRoom()) {
        return;
    }
    if (Memory.claiming.status !== 'idle') {
        return;
    }
    if (!Game.flags['Expand']) {
        return;
    }
    Memory.claiming.status = 'claimer';
    console.log('Start new claiming')
}

if (typeof Memory.claiming !== 'object') {
    Memory.claiming = {
        // Statuses: idle->claimer->remote_upgrader
        status: 'idle',

        // Claimer set roomName
        roomName: false,

        controllerClaimed: false,
        spawnBuilt: false, 
    };
}
