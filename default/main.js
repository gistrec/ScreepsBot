/// Идеи (с описанием реализации):
// * Обновлять контроллер только при необходимости (если контроллер 8 уровня, то только если у него осталось меньше 80% тиков).
//   Видимо будет процесс, который раз в 300 тиков будет проверять нужно ли улучшать контроллер.
// * Если комната 8 уровня, то не спавнить много рабочих - проверять, что нужно чинить стенки, что-нибудь строить.
// * Автоматически искать линки около источников и любого хранилища - ресурсы всегда передаём в хранилище.
// * Автоматически назначать charger'а на линк около хранилища и спавна - пусть он всегда распределяет ресурсы.
// * Не спавнить майнера, если он был убит врагом. Видимо у каждой комнаты будет список 'запрещенных' источников,
//   для которых запрещено в течении какого-то времени (может быть пока враг не ушел из комнаты) спавнить майнера.
//   Нужно научиться определять, что крип был убит врагом.
// * Отслеживать, что rampart был атакован врагом. И активировать safeMode только если rampart был атакован.
//   Иначе safeMode может включиться если просто поставить rampart и в комнату зайдет враг.

// * Не атаковать врага башнями, если он может отхилить 
// * Хранить в Storage резервные 200к энергии
// * Переделать widthdraw/fill - добавить
//    * min/max количество
//    * забирать полный инвеньарь или сколько удасться
// * Добавить rampartDefender'у TOUGH + буст (стоит мало, зато мы его точно не потеряем).
// * Запрещать крипам двигаться рядом с врагом!!!
require('prototype');

const roleMiner     = require('role.miner');
const roleScout     = require('role.scout');
const roleCharger   = require('role.charger');
const roleClaimer   = require('role.claimer');
const roleUpgrader  = require('role.upgrader');
const roleHarvester = require('role.harvester');
const roleWarrior   = require('role.warrior');
const roleHealler   = require('role.healler');
const roleDefender  = require('role.defender');
const roleExtractor = require('role.extractor');
const roleTransport = require('role.transport');
const roleRemoteUpgrader     = require('role.remoteUpgrader');
const roleRampartDefender    = require('role.rampartDefender');
const roleSafeModeGenerator  = require('role.safeModeGenerator');
const roleControllerUpgrader = require('role.controllerUpgrader');

const taskDefend = require('task.defend');
const taskClaim  = require('task.claim');
const taskCreep  = require('task.creep');
const taskRoom   = require('task.room');
const taskBoost  = require('task.boost');
const taskLink   = require('task.link');

const moduleLab      = require('module.lab');
const moduleObserver = require('module.observer');

const statistics = require('statistics');


function spawnCreeps(room) {
    if (!roleMiner.spawn(room)) return;
    if (!roleCharger.spawn(room)) return;
    if (!roleRampartDefender.spawn(room)) return;
    // if (!roleDefender.spawn(room)) return;
    if (!roleUpgrader.spawn(room)) return;
    if (!roleExtractor.spawn(room)) return;
}

function upgradeCreeps(room) {
    if (!roleCharger.upgrade(room)) return;
    if (!roleUpgrader.upgrade(room)) return;
}

function updateRoom(room) {
    if (room.memory.defending || Game.time % 5 == 0) try {
        taskDefend.checkStatus(room);
    } catch(err) { err.log() };

    try {
        taskDefend.fireTower(room)
    } catch(err) { err.log() };
    try {
        taskLink.transferLinkEnergy(room);
    } catch(err) { err.log() };
    
    if (Game.time % 10 == 0) try {
        spawnCreeps(room);
        taskRoom.renewCreeps(room);
    } catch(err) { err.log() };

    if (Game.time % 300 == 0) try {
        upgradeCreeps(room);
    } catch(err) { err.log() };
    
    const rebalanceTime = room.memory.enemy_creeps ? 100 : 600;
    if (Game.time % rebalanceTime == 0) try {
        roleDefender.rebalanceRepairing(room);
        roleUpgrader.rebalanceRepairing(room)
    } catch(err) { err.log() };

    try {
        statistics.room(room);
        statistics.map(room);

        taskRoom.recalculateCostMatrixRewrites(room);
    } catch(err) { err.log() }
}

module.exports.loop = function () {
    //if (Game.cpu.bucket >= 10000) try {
    //    Game.cpu.generatePixel()
    //} catch (err) { err.log() };
    
    try { moduleLab.process();      } catch (err) { err.log() }
    // try { moduleObserver.process(); } catch (err) { err.log() }
    
    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        updateRoom(room)
        taskRoom.processRoom(room);
    } catch (err) { err.log() }

    /*if (Game.time % 1000 == 0) try {
        Game.rooms["W8S38"].find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger"})[0].memory.transfer = {resource_type: "energy", source_id: "624ef8e534ed8c9e5b813a62", target_id: "627553265b57bd54da151667"};
    } catch (err) { err.log() }*/

    // Автопокупка энергии, если её нет в терминале
    /* if (Game.time % 200 == 0) try {
        if (Game.getObjectById("62f292fd110bbf5a69acd3b7").store.getUsedCapacity(RESOURCE_ENERGY) < 20000) {
            Game.market.createOrder({resourceType: RESOURCE_ENERGY, totalAmount: 30000, price: 9, type: ORDER_BUY, roomName: "W9S39"})
        }
        if (Game.getObjectById("6321b0f08c08ce456c62d74c").store.getUsedCapacity(RESOURCE_ENERGY) < 20000) {
            Game.market.createOrder({resourceType: RESOURCE_ENERGY, totalAmount: 30000, price: 9, type: ORDER_BUY, roomName: "W8S36"})
        }
    } catch (err) { err.log() } */

    /*if (Game.time % 10 == 0) {
        const factory_ids = ["62821256747b3b039bd4d063", "63218f0d02b79f3e49f425b3", "6321d4c55870caef0aacdd8d"];
        for (const factory_id of factory_ids) {
            const factory = Game.getObjectById(factory_id);
            if (!factory) {
                console.log(`Factory with id ${factory_id} doesnt exist`);
                continue;
            }
            
            const lack_energy = factory.store.getUsedCapacity(RESOURCE_ENERGY)  <= 2000;
            const has_battery = factory.store.getUsedCapacity(RESOURCE_BATTERY) >= 50;
            const has_space   = factory.store.getFreeCapacity() >= 600;
            if (lack_energy && has_battery && has_space) {
                factory.produce(RESOURCE_ENERGY);
            }
        }
    }*/
    
    if (Game.time % 100 == 0 && Game.rooms["W9S39"].terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 100000) {
        Game.rooms["W9S37"].terminal.send(RESOURCE_ENERGY, 20000, "W9S39");
    }
    if (Game.time % 100 == 0 && Game.rooms["W9S39"].terminal.store.getUsedCapacity(RESOURCE_ENERGY) < 100000) {
        Game.rooms["W8S38"].terminal.send(RESOURCE_ENERGY, 20000, "W9S39");
    }
    
    /* if (Game.time % 600 == 0) {
        let creep = Game.rooms["W8S36"].find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger"}).pop();
        if (creep) creep.memory.disassemble = "battery";
        
        creep = Game.rooms["W9S39"].find(FIND_MY_CREEPS, {filter: (c) => c.memory.role == "charger"}).pop();
        if (creep) creep.memory.disassemble = "battery";
    } */
    
    /*if (Game.time % 600 == 0) {
        Game.spawns["Main"].spawnCreep([TOUGH, TOUGH, HEAL, HEAL, HEAL, HEAL, ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE], "Test" + Game.time, {memory: {role: "warrior", goto: "1:38:W7S37"}})
    }*/
    
    /*if (Game.time % 100 == 0) {
        require('role.harvester').spawn(Game.spawns["W8S36"]);
    }*/
    /*if ((Game.time > 38511304 + 7000) && Game.time % 500 == 0) {
        Game.spawns["Main"].spawnCreep([TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE], "Test" + Game.time, {memory: {role: "warrior", goto: "35:19:W8S36"}})
        Game.spawns["W8S38"].spawnCreep([TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL,ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE], "Test" + Game.time, {memory: {role: "warrior", goto: "32:48:W8S37"}})
    }*/
    
    // Expand tasks
    /*if (Game.time % 1100 == 0) {
        const goto = "3:28:W8S41";
        const role = "remote_upgrader";
        const boost = "XLH2O";
        Game.spawns["W11S39"].spawnCreep([WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE], "Upgrader" + Game.time + 2, {memory:{role, goto, boost }});
        Game.spawns["W12S39"].spawnCreep([WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE], "Upgrader" + Game.time + 3, {memory:{role, goto, boost }});
        Game.spawns["W11S39D"].spawnCreep([WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE], "Upgrader" + Game.time + 4, {memory:{role, goto, boost }});
        Game.spawns["W12S39D"].spawnCreep([WORK, WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE], "Upgrader" + Game.time + 5, {memory:{role, goto, boost }});
    }*/

    /*if (Game.time > (39184995 + 5785)) try {
        const creeps = Game.rooms["W8S36"].find(FIND_MY_CREEPS, {filter: (creep) => creep.memory.role == "rampart_defender" && creep.ticksToLive > 200 }).length;
        if (!creeps) {
            const boost = "XUH2O";
            const name = 'Defender' + Game.time;
            const role = 'rampart_defender';
            const res = Game.spawns["W8S36"].spawnCreep([ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                             ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                                             CARRY, CARRY,   MOVE,   MOVE,   MOVE,   MOVE,   MOVE], name, { memory: { role, boost }})
        
            console.log(res)
        }
        
    } catch(err) { err.log() };*/

    if (Game.time % 300 == 0) try {
        taskClaim.checkNewExpand();
    } catch(err) { err.log() };
    if (Game.time % 10 == 0) try {
        roleScout.spawn() && roleClaimer.spawn() && roleRemoteUpgrader.spawn();
    } catch(err) { err.log() };

    if (Game.time % 800 == 0) try {
        for (const creepName in Memory.creeps) {
            if (!Game.creeps[creepName]) {
                delete Memory.creeps[creepName];
            }
        }
        console.log("Died creeps have been deleted");
    } catch(err) { err.log(); };

    for (const name in Game.creeps) try {
        const creep = Game.creeps[name];
        
        if (taskBoost.checkBoost(creep)     == OK) continue; // Если есть команда на бустинг.
        if (taskBoost.checkUnboost(creep)   == OK) continue; // Если есть команда на анбустинг.
        if (taskCreep.checkGoTo(creep)      == OK) continue; // Если есть команда к перемещению.
        if (taskCreep.checkRecycling(creep) == OK) continue; // Если есть команда на переработку.
        // if (creep.memory.configuration_id) continue; // Если крип находится в конфигурации
        
        switch (creep.memory.role){
            case 'scout':
                roleScout.run(creep);
                break;

            case 'claimer':
                roleClaimer.run(creep);
                break;

            case 'charger':
                roleCharger.run(creep);
                break;

            case 'upgrader':
                roleUpgrader.run(creep);
                break;
                
            case 'transport':
                roleTransport.run(creep);
                break;

            case 'remote_upgrader':
                roleRemoteUpgrader.run(creep);
                break;
                
            case 'controller_upgrader':
                roleControllerUpgrader.run(creep);
                break;
                
            case 'rampart_defender':
                roleRampartDefender.run(creep);
                break;

            case 'healler':
                roleHealler.run(creep);
                break;

            case 'warrior':
                roleWarrior.run(creep);
                break;

            case 'defender':
                roleDefender.run(creep);
                break;

            case 'miner':
                roleMiner.run(creep);
                break;

            case 'harvester':
                roleHarvester.run(creep);
                break;

            case 'extractor':
                roleExtractor.run(creep);
                break;

            case 'safe_mode_generator':
                roleSafeModeGenerator.run(creep);
                break;

            default:
                creep.say('Err role');
        }
    } catch(err) { err.log() };
}