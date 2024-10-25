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

Number.prototype.toStringStatus = function() {
    switch (Number(this)) {
        case 0:   return "OK";
        case -1:  return "ERR_NOT_OWNER";
        case -2:  return "ERR_NO_PATH";
        case -3:  return "ERR_NAME_EXISTS";
        case -4:  return "ERR_BUSY";
        case -5:  return "ERR_NOT_FOUND";
        case -6:  return "ERR_NOT_ENOUGH_RESOURCES";
        case -7:  return "ERR_INVALID_TARGET";
        case -8:  return "ERR_FULL";
        case -9:  return "ERR_NOT_IN_RANGE";
        case -10: return "ERR_INVALID_ARGS";
        case -11: return "ERR_TIRED";
        case -12: return "ERR_NO_BODYPART";
        case -14: return "ERR_RCL_NOT_ENOUGH";
        case -15: return "ERR_GCL_NOT_ENOUGH";
        default:  return "UNKNOWN_ERROR";
    }
}
