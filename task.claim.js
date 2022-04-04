function canClaimNewRoom() {
    const gpl = Game.gpl;
    const myRooms = Game.rooms().filter(room => room.controller && room.controller.my);
    if (myRooms.length + Object.keys(claiming_rooms).length >= gpl) {
        return false;
    }
    return true;
}

exports.processCurrentClaimings = function() {

}

exports.processNewClaimings = function() {
    if (!canClaimNewRoom()) {
        return;
    }

    const myRooms = Game.rooms().filter(room => room.controller && room.controller.my);
    for (const room of myRooms) {
        if (room.)
    }
}

if (typeof Memory.claiming_rooms !== 'object') {
    Memory.claiming_rooms = {/* source_room => claim_room */};
}
