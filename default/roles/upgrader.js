const profiler = require('../screeps-profiler');

const utils = require('../utils');

const taskCreep     = require('../tasks/creep');
const taskResource  = require('../tasks/resource');
const taskStructure = require('../tasks/structure');


const configurations = [
    {"energy": 300,  "max_count": 6, "parts": [WORK, MOVE, CARRY, MOVE, CARRY]}, // Когда на старте есть максимум 300 энергии, спавним простого рабочего
    {"energy": 550,  "max_count": 5, "parts": [WORK, WORK, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1100, "max_count": 4, "parts": [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
    {"energy": 1700, "max_count": 3, "parts": [WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]},
];


const roleUpgrader = {
    rebalanceRepairing: function(room) {
        const MAX_CREEPS_PER_WALL = room.hasHostiles ? 3 : 1;

        const creeps = utils.creepsByRole(room, 'upgrader');
        const walls = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_RAMPART })
                          .sort((lhv, rhv) => { return rhv.hits - lhv.hits; });
        for (const chunk of _.chunk(creeps, MAX_CREEPS_PER_WALL)) {
            const wall = walls.pop();
            if (!wall) {
                continue;
            }
            for (const creep of chunk) {
                creep.memory.repairing = wall.id;
            }
        }
        console.log(`[${room.name}][Upgrader] Rebalancing upgraders`);

    },
    spawn: function(room) {
        const spawn = utils.findFreeSpawn(room);
        if (!spawn) return true;

        const creepConfiguration = utils.getAvailableCreepConfiguration(configurations, room);
        const replacementTtl = utils.minerReplacementTtl(creepConfiguration.parts.length);

        // Не учитываем уходящих - чтобы спавнить замену заранее, а не после смерти.
        // В бутстрапе count=0 в любом случае, фильтр не блокирует первый спавн.
        const upgraders = utils.creepsByRole(room, "upgrader").filter(c => c.ticksToLive > replacementTtl);
        // Bootstrap (нет ferrying-инфраструктуры) - один апгрейдер, который фокусируется
        // на постройке контейнера. После того как контейнер построен, needsChargers станет
        // true и max_count вернёт обычное значение (6 в 300e конфиге).
        const maxCount = utils.needsChargers(room) ? creepConfiguration.max_count : 1;
        if (upgraders.length >= maxCount) return true;

        if (creepConfiguration.energy > room.energyAvailable) {
            console.log(`[${room.name}] Need Upgrader, but not enought energy [${room.energyAvailable}/${creepConfiguration.energy}]`);
            return false;
        }

        const boost = room.hasHostiles ? "XLH2O" : false; // Boost repair and build
        const role = 'upgrader';
        const name = 'Upgrader' + Game.time;
        const energyStructures = utils.getEnergyStructures(room, spawn);
        spawn.spawnCreep(creepConfiguration.parts, name, {memory: {role, boost}, energyStructures});
        console.log(`[${room.name}] Spawning new ${role} ${name}`);
        return false;
    },
    upgrade: function(room) {
        return true;
    },
    run: function(creep) {
        if (creep.fatigue != 0) return;

        // Не чиним крипа, у которого есть буст
        if (!creep.memory.boosted) {
            if (taskCreep.checkTTL(creep) == OK) return; // Проверяем TTL бота
        }

        taskResource.chechHarvesting(creep);

        // Если есть ресурсы
	    if(!creep.memory.harvesting) {
            // С линком апгрейдер прикован к нему - сразу льёт в контроллер. Maintain-таск
            // (downgrade close) тоже приоритетнее всех остальных задач.
            if (creep.memory.link_id || creep.room.memory.need_maintain_controller) {
                taskStructure.upgradeController(creep);
                return;
            }

            // На bootstrap'е первый и единственный апгрейдер должен прежде всего достроить
            // контейнер у source - без него миннер 550e (RCL 2) бесполезен (дропает энергию
            // на землю), да и сам апгрейдер потом возьмёт из контейнера, а не будет гонять
            // через всю комнату к source. buildClosest стоит раньше upgradeController, так
            // что контейнер достроится прежде контроллера. Заполняет спавн в это время миннер
            // (через self-deliver в miner.run) и чарджер (через pickup дропов).
            if (taskStructure.buildClosest(creep) == OK) return;

	        // Если чиним структуру, то пытаемся её дочинить
            if (taskStructure.continueRepairStructure(creep) == OK) return;

            // В осаде дороги/контейнеры не трогаем - они часто снаружи рампартов, плюс
            // апгрейдер должен максимально лить hits в рампарты, а не размазываться.
            const types = creep.room.isDefending
                ? [STRUCTURE_RAMPART]
                : [STRUCTURE_ROAD, STRUCTURE_CONTAINER, STRUCTURE_RAMPART];
            if (taskStructure.startRepairClosestStructs(creep, types) == OK) return;

            if (creep.room.controller && creep.room.controller.my && creep.room.controller.level != 8) {
                if (taskStructure.upgradeController(creep) == OK) return;
            }

            // Заполняем нюкер - только когда в комнате спокойно и есть избыток ресурсов.
            if (taskResource.fillNukerIfCalm(creep) == OK) return;
        }else {
	        if (creep.memory.link_id) {
	            taskResource.withdrawTarget(creep, Game.getObjectById(creep.memory.link_id));
                return;
	        }

            // Основная задача:
            // * Поднять лежащие ресурсы
            // * Получить ресурсы из хранилища
            if (!creep.room.isUnderAttack) {
                if (taskResource.pickupClosestResources(creep, [RESOURCE_ENERGY], /* full cargo */ true)  == OK) return;
            }

            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_STORAGE ], RESOURCE_ENERGY) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_TERMINAL], RESOURCE_ENERGY) == OK) return;
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_FACTORY ], RESOURCE_ENERGY) == OK) return;
            // Bootstrap-fallback: на RCL 1-3 нет storage/terminal/factory. Контейнер у source -
            // единственный накопитель энергии (миннер на 550e дропает в него без CARRY).
            if (taskResource.withdrawClosestResources(creep, [STRUCTURE_CONTAINER], RESOURCE_ENERGY) == OK) return;
            // На RCL 1 нет вообще ничего: миннер с CARRY несёт всё в спавн, дропов/контейнеров
            // у source нет. У апгрейдера во всех конфигах есть WORK - добывает сам.
            if (creep.getActiveBodyparts(WORK) > 0) {
                const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
                if (source) {
                    if (taskResource.harvestTarget(creep, source) == OK) return;
                }
            }
        }
	}
};


module.exports = roleUpgrader;


module.exports.spawn = profiler.registerFN(module.exports.spawn, "role.upgrader.spawn");
module.exports.run = profiler.registerFN(module.exports.run, "role.upgrader.run");
