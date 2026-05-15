Error.prototype.log = function() {
    const [, lineno, colno] = this.stack.match(/(\d+):(\d+)/);
    const msg =  `Error: ${this.message}\n${this.stack}\nLine ${lineno}, column ${colno}`;
    console.log(msg);
}

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

// -6 в Screeps API имеет три имени-алиаса (NOT_ENOUGH_ENERGY/RESOURCES/EXTENSIONS) - все
// тот же код. По коду неотличить, какой из них вернул движок, поэтому печатаем канонический
// RESOURCES (как в engine constants).
const STATUS_NAMES = {
     0:  'OK',
    [-1]: 'ERR_NOT_OWNER',
    [-2]: 'ERR_NO_PATH',
    [-3]: 'ERR_NAME_EXISTS',
    [-4]: 'ERR_BUSY',
    [-5]: 'ERR_NOT_FOUND',
    [-6]: 'ERR_NOT_ENOUGH_RESOURCES',
    [-7]: 'ERR_INVALID_TARGET',
    [-8]: 'ERR_FULL',
    [-9]: 'ERR_NOT_IN_RANGE',
    [-10]: 'ERR_INVALID_ARGS',
    [-11]: 'ERR_TIRED',
    [-12]: 'ERR_NO_BODYPART',
    [-14]: 'ERR_RCL_NOT_ENOUGH',
    [-15]: 'ERR_GCL_NOT_ENOUGH',
    [-16]: 'ERR_ACCESS_DENIED',
};

Number.prototype.toStringStatus = function() {
    return STATUS_NAMES[Number(this)] || 'UNKNOWN_ERROR';
}
