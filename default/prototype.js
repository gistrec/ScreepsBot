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

Room.prototype.transfer = function(resource_type, source_id, target_id, max_resource_count_in_target = null) {
    if (source_id == "terminal") source_id = this.terminal.id;
    if (source_id == "storage")  source_id = this.storage.id;
    if (source_id == "factory") {
        const factory = this.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_FACTORY}).shift();
        if (factory) source_id = factory.id;
    }

    if (target_id == "terminal") target_id = this.terminal.id;
    if (target_id == "storage")  target_id = this.storage.id;
    if (target_id == "factory") {
        const factory = this.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_FACTORY}).shift();
        if (factory) target_id = factory.id;
    }

    if (!Game.getObjectById(source_id)) {
        console.log(`[${this.name}] Source ${source_id} not found`);
        return
    }
    if (!Game.getObjectById(target_id)) {
        console.log(`[${this.name}] Target ${target_id} not found`);
        return
    }

    const creep = this.find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger" && !c.memory.transfer}).shift();
    if (!creep) {
        console.log(`[${this.name}] No creep to transfer`);
        return
    }
    creep.memory.transfer = {resource_type, source_id, target_id, max_resource_count_in_target};
    console.log(`[${this.name}] Creep ${creep.name} will transfer ${resource_type} resource`);
}


Room.prototype.sendEnergy = function(target_room, amount = Number.MAX_SAFE_INTEGER) {
    if (!this.terminal) {
        console.log(`[${this.name}] Terminal not found`);
        return
    }
    if (!Game.rooms[target_room] || !Game.rooms[target_room].terminal) {
        console.log(`[${target_room}] Terminal not found`);
        return
    }

    if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < amount) {
        amount = this.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    }

    if (Game.rooms[target_room].terminal.store.getFreeCapacity() < amount) {
        amount = Game.rooms[target_room].terminal.store.getFreeCapacity()
    }

    const cost = Game.market.calcTransactionCost(amount, this.name, target_room);
    const costRatio = (cost / amount * 100).toFixed(1);

    amount = amount - cost;
    this.terminal.send(RESOURCE_ENERGY, amount, target_room);
    console.log(`[${this.name}] Send ${amount} energy to ${target_room} with transaction cost ${cost} (${costRatio}%)`);
}


Room.prototype.getMineral = function() {
    if (this.memory.mineralType === undefined) {
        const mineral = this.find(FIND_MINERALS).shift();

        this.memory.mineralId   = (mineral ? mineral.id : null);
        this.memory.mineralType = (mineral ? mineral.mineralType : null);
    }

    return [this.memory.mineralId, this.memory.mineralType];
}


Room.prototype.getFactory = function() {
    if (this.memory.factoryId === undefined) {
        // TODO: Add cache - don't look every time
        const factory = this.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_FACTORY }).shift();
        if (factory) {
            this.memory.factoryId == factory.id;
            return factory;
        }
        return;
    }
    const factory = Game.getObjectById(this.memory.factoryId);
    if (!factory) {
        delete this.memory.factoryId;
        // Try to look for a new factory
        return this.getFactory();
    }
    return factory;
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
