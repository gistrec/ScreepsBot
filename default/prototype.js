/*Object.defineProperty(Array.prototype, 'first', {
    value() {
        return this.find(e => true);
    }
});*/

Error.prototype.log = function() {
    const [, lineno, colno] = this.stack.match(/(\d+):(\d+)/);
    const msg =  `Error: ${this.message}\n${this.stack}\nLine ${lineno}, column ${colno}`;
    console.log(msg);
}

// Считаем стоимость крипа
Array.prototype.bodyPartCost = function() {
    return this.reduce((totalCost, bodyPart) => totalCost + BODYPART_COST[bodyPart], 0);
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

Creep.prototype.hasAnyBoosts = function() {
    return _.filter(this.body, part => part.boost != undefined).length !== 0;
}

Creep.prototype.isDangerous = function(){
    return this.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK);
}