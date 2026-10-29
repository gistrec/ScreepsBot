// Per-tick кеш на room. Screeps пересоздаёт room object каждый тик, поэтому подвешенный
// _cache живёт ровно один тик - явная инвалидация не нужна. Factory вызывается лениво
// и ровно один раз за тик; null/undefined тоже кешируются (`in`, не `=== undefined`),
// чтобы повторные обращения не пересчитывали "ничего не нашлось".
Room.prototype.cache = function(key, factory) {
    if (!this._cache) this._cache = {};
    if (!(key in this._cache)) this._cache[key] = factory(this);
    return this._cache[key];
};

// Состояние угрозы. Три уровня, отвечают на разные вопросы; не объединять в один флаг -
// семантика разная и call-сайты опираются на конкретный.
//
// hasHostiles    - в комнате есть опасные враги (>0 в memory.enemy_creeps): обычные крипы с
//                  ATTACK/RANGED_ATTACK/CLAIM/WORK; HEAL/MOVE-only и power creeps не считаются.
//                  Значение из памяти, обновляется в defend.checkStatus - каждый тик под
//                  defending и в последние тики safeMode, иначе раз в 5 тиков (может отставать
//                  на <=4 тика). Игнорирует safeMode. Используется когда важен сам факт присутствия:
//                  лаба/нюкер не работают, рампарты держатся выше, апгрейдер бустит и т.п.
// isUnderAttack  - hasHostiles И safeMode не активен. Это "опасно прямо сейчас":
//                  миннеры паузятся, чарджер тянет из терминала, пикап с пола стоп.
// isDefending    - военный режим (memory.defending): опасные враги в комнате или рампарт под
//                  ударом, плюс hold-down ~50 тиков после ухода врага. Сам по себе safeMode
//                  defending не держит (под ним враги бить не могут, а стройку/ремонт в это
//                  окно надо вести); пока враги стоят в комнате - держит и под safeMode.
//                  Шире isUnderAttack по времени. Используется для max-count defender'ов,
//                  паузы стройки/ремонта дорог, откладывания апгрейда контроллера.
Object.defineProperty(Room.prototype, 'hasHostiles', {
    configurable: true,
    get() { return !!this.memory.enemy_creeps; },
});
Object.defineProperty(Room.prototype, 'isUnderAttack', {
    configurable: true,
    get() { return !!this.memory.enemy_creeps && !(this.controller && this.controller.safeMode); },
});
Object.defineProperty(Room.prototype, 'isDefending', {
    configurable: true,
    get() { return !!this.memory.defending; },
});

Room.prototype.transfer = function(resource_type, source_id, target_id, max_resource_count_in_target = null, min_resource_count_in_source = null) {
    if (source_id == "terminal") source_id = this.terminal ? this.terminal.id : null;
    if (source_id == "storage")  source_id = this.storage ? this.storage.id : null;
    if (source_id == "factory") {
        const factory = this.getFactory();
        if (factory) source_id = factory.id;
    }

    if (target_id == "terminal") target_id = this.terminal ? this.terminal.id : null;
    if (target_id == "storage")  target_id = this.storage ? this.storage.id : null;
    if (target_id == "factory") {
        const factory = this.getFactory();
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

    // Занятый disassemble-задачей чарджер тоже не свободен: roles/charger.js выполняет её
    // раньше transfer, и выданная ему transfer-задача ждала бы конца disassemble.
    const chargers = require('utils').creepsByRole(this, "charger").filter(c => !c.memory.transfer && !c.memory.disassemble);
    if (chargers.length === 0) {
        console.log(`[${this.name}] No creep to transfer`);
        return
    }

    // Чарджер ближе всех к storage-link нужен для приоритетной выгрузки link -> storage:
    // отдадим ему задачу только если других свободных нет, иначе link забивается, и
    // source-link-и не могут пушить, source-майнеры стоят. link_id у всех чарджеров
    // одинаковый (см. roles/charger.js при спавне), берём из первого.
    let candidates = chargers;
    if (chargers.length > 1) {
        const link = chargers[0].memory.link_id ? Game.getObjectById(chargers[0].memory.link_id) : null;
        if (link) {
            const linkCharger = chargers.reduce((best, c) => {
                const dist = c.pos.getRangeTo(link);
                return (!best || dist < best.dist) ? {creep: c, dist} : best;
            }, null);
            const filtered = chargers.filter(c => c.id !== linkCharger.creep.id);
            if (filtered.length > 0) candidates = filtered;
        }
    }

    const creep = candidates[0];
    creep.memory.transfer = {resource_type, source_id, target_id, max_resource_count_in_target, min_resource_count_in_source};
    console.log(`[${this.name}] Creep ${creep.name} will transfer ${resource_type} resource`);
}

Room.prototype.sendEnergy = function(target_room, amount = Number.MAX_SAFE_INTEGER) {
    if (!this.terminal) {
        console.log(`[${this.name}] Terminal not found`);
        return ERR_NOT_FOUND;
    }
    // cooldown - снимок начала тика; send этого тика ловит intentSent (prototypes/structure.js).
    if (this.terminal.cooldown || this.terminal.intentSent) {
        return ERR_TIRED;
    }
    if (!Game.rooms[target_room] || !Game.rooms[target_room].terminal) {
        console.log(`[${target_room}] Terminal not found`);
        return ERR_NOT_FOUND;
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
    if (amount <= 0) return ERR_NOT_ENOUGH_RESOURCES;

    const status = this.terminal.send(RESOURCE_ENERGY, amount, target_room);
    if (status == OK) {
        console.log(`[${this.name}] Send ${amount} energy to ${target_room} with transaction cost ${cost} (${costRatio}%)`);
    } else {
        console.log(`[${this.name}] sendEnergy to ${target_room} failed: ${status.toStringStatus()}`);
    }
    return status;
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

// Энергия + батарейки×10 во всех "складах". Используется для решения, не пора ли
// прекратить майнинг: если стокпайл огромный, нет смысла гонять майнеров и charger'ов.
Room.prototype.getTotalEnergy = function() {
    let count = 0;
    const stores = [this.storage, this.terminal, this.getFactory()].filter(s => s);
    for (const s of stores) {
        count += s.store.getUsedCapacity(RESOURCE_ENERGY);
        count += s.store.getUsedCapacity(RESOURCE_BATTERY) * 10;
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
            this.memory.factoryId = factory.id;
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
