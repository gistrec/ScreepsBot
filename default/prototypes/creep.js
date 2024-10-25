Creep.prototype.hasAnyBoosts = function() {
    return _.filter(this.body, part => part.boost != undefined).length !== 0;
}

Creep.prototype.isDangerous = function(){
    return this.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK);
}

Creep.prototype.bodyPartCost = function() {
    return this.body.reduce((totalCost, bodyPart) => totalCost + BODYPART_COST[bodyPart], 0);
}
