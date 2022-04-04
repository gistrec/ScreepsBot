/*Object.defineProperty(Array.prototype, 'first', {
    value() {
        return this.find(e => true);
    }
});*/

Array.prototype.x = function() {
    return parseInt(this[0]);
}

Array.prototype.y = function() {
    return parseInt(this[1])
}

Array.prototype.roomName = function() {
    return this[2];
}

Array.prototype.roomPosition = function() {
    return new RoomPosition(this.x(), this.y(), this.roomName());
}

String.prototype.x = function() {
    return parseInt(this.split(':')[0]);
}

String.prototype.y = function() {
    return parseInt(this.split(':')[1])
}

String.prototype.roomName = function() {
    return this.split(':')[2];
}

String.prototype.roomPosition = function() {
    return new RoomPosition(this.x(), this.y(), this.roomName());
}

Creep.prototype.hasAnyBoosts = function() {
    return _.filter(this.body, part => part.boost != undefined).length !== 0;
}