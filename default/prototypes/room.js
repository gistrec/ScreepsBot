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

Room.prototype.getStoredEnergy = function() {
    let count = 0;
    if (this.storage) {
        count += this.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    if (this.terminal) {
        count += this.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    if (this.getFactory()) {
        count += this.getFactory().store.getUsedCapacity(RESOURCE_ENERGY);
    }
    return count;
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
