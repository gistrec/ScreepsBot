/// Идеи (с описанием реализации):
// * Обновлять контроллер только при необходимости (если контроллер 8 уровня, то только если у него осталось меньше 80% тиков).
//   Видимо будет процесс, который раз в 300 тиков будет проверять нужно ли улучшать контроллер.
// * Если комната 8 уровня, то не спавнить много рабочих - проверять, что нужно чинить стенки, что-нибудь строить.
// * Не спавнить майнера, если он был убит врагом. Видимо у каждой комнаты будет список 'запрещенных' источников,
//   для которых запрещено в течении какого-то времени (может быть пока враг не ушел из комнаты) спавнить майнера.
//   Нужно научиться определять, что крип был убит врагом.
// * Отслеживать, что rampart был атакован врагом. И активировать safeMode только если rampart был атакован.
//   Иначе safeMode может включиться если просто поставить rampart и в комнату зайдет враг.

// * Не атаковать врага башнями, если он может отхилить
// * Хранить в Storage резервные 200к энергии
// * Переделать widthdraw/fill - добавить
//    * min/max количество
//    * забирать полный инвентарь или сколько удастся
// * Добавить rampartDefender'у TOUGH + буст (стоит мало, зато мы его точно не потеряем).
// * Запрещать крипам двигаться рядом с врагом!!!
require('prototypes/creep');
require('prototypes/others');
require('prototypes/room');

const roleMiner     = require('roles/miner');
const roleScout     = require('roles/scout');
const roleCharger   = require('roles/charger');
const roleClaimer   = require('roles/claimer');
const roleUpgrader  = require('roles/upgrader');
const roleHarvester = require('roles/harvester');
const roleReserver  = require('roles/reserver');
const roleWarrior   = require('roles/warrior');
const roleDefender  = require('roles/defender');
const roleExtractor = require('roles/extractor');
const roleRemoteUpgrader     = require('roles/remoteUpgrader');
const roleRampartDefender    = require('roles/rampartDefender');
const roleSafeModeGenerator  = require('roles/safeModeGenerator');
const roleControllerUpgrader = require('roles/controllerUpgrader');

const rolePowerBankAttacker  = require('roles/powerBankAttacker');
const rolePowerBankHealer    = require('roles/powerBankHealer');
const rolePowerCarrier       = require('roles/powerCarrier');
const roleOperator           = require('roles/operator');

const taskDefend   = require('tasks/defend');
const taskCreep    = require('tasks/creep');
const taskRoom     = require('tasks/room');
const taskBoost    = require('tasks/boost');
const taskLink     = require('tasks/link');
const taskResource = require('tasks/resource');

const moduleLab   = require('modules/lab');
const moduleBuild = require('modules/build');
const moduleObserver  = require('modules/observer');
const moduleExpansion = require('modules/expansion');
const moduleRoomSurvey = require('modules/roomSurvey');
const moduleResourceBalance = require('modules/resourceBalance')
const modulePower     = require('modules/power');
const modulePowerBank = require('modules/powerBank');

const visualization = require('visualization');


// Profiler оборачивает зарегистрированные функции; даже без profile() это лишний overhead.
// Включается через консоль: `Memory.profiler_enabled = true` + обновление кода.
const profiler = require('screeps-profiler');
if (Memory.profiler_enabled) {
    profiler.enable();
}


function spawnCreeps(room) {
    if (!room.controller || !room.controller.my) {
        return;
    }

    if (!roleMiner.spawn(room)) return;
    if (!roleCharger.spawn(room)) return;
    if (!roleRampartDefender.spawn(room)) return;
    // if (!roleDefender.spawn(room)) return;
    if (!roleUpgrader.spawn(room)) return;
    if (!roleExtractor.spawn(room)) return;
    if (!roleReserver.spawn(room)) return;
    if (!roleHarvester.autoSpawn(room)) return;
}

function upgradeCreeps(room) {
    if (!roleCharger.upgrade(room)) return;
    if (!roleUpgrader.upgrade(room)) return;
}

function updateRoom(room) {
    if (room.isDefending || Game.time % 5 == 0) try {
        taskDefend.checkStatus(room);
    } catch(err) { err.log() };

    try { taskDefend.fireTower(room);        } catch(err) { err.log() };
    try { taskLink.transferLinkEnergy(room); } catch(err) { err.log() };

    if (Game.time % 10 == 0) try {
        spawnCreeps(room);
        // Spawn new creeps instead
        // taskRoom.renewCreeps(room);
    } catch(err) { err.log() };

    if (Game.time % 300 == 0) try {
        upgradeCreeps(room);
    } catch(err) { err.log() };

    const rebalanceTime = room.hasHostiles ? 100 : 600;
    if (Game.time % rebalanceTime == 0) try {
        roleDefender.rebalanceRepairing(room);
        roleUpgrader.rebalanceRepairing(room)
    } catch(err) { err.log() };

    // Фоновая задача: при спокойной комнате с большим резервом - шедулим заливку nuker'а
    // ghodium'ом. Энергию заливает обычная fill-цепочка charger/upgrader.
    if (Game.time % 1000 == 0) try {
        taskResource.scheduleNukerGhodium(room);
    } catch(err) { err.log() };

    // Покупка G на маркете - opt-in через room.memory.nuker_buy_max_price.
    // getAllOrders() дорогая, поэтому реже чем scheduleNukerGhodium.
    if (Game.time % 5000 == 0) try {
        taskResource.buyNukerGhodium(room);
    } catch(err) { err.log() };
}

loop = function () {
    // if (Game.cpu.bucket >= 10000) try {
    //     Game.cpu.generatePixel()
    // } catch (err) { err.log() };

    try { moduleLab.process();             } catch (err) { err.log() }
    try { moduleBuild.process();           } catch (err) { err.log() }
    try { moduleObserver.process();        } catch (err) { err.log() }
    try { moduleExpansion.process();       } catch (err) { err.log() }
    try { moduleRoomSurvey.process();      } catch (err) { err.log() }
    try { moduleResourceBalance.process(); } catch (err) { err.log() }
    try { modulePower.process();           } catch (err) { err.log() }
    try { modulePowerBank.process();       } catch (err) { err.log() }

    try { visualization.process();   } catch (err) { err.log() }

    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        updateRoom(room)
        taskRoom.processRoom(room);
    } catch (err) { err.log() }

    if (Game.time % 100 == 0) try {
        for (const creepName in Memory.creeps) {
            if (!Game.creeps[creepName]) {
                delete Memory.creeps[creepName];
            }
        }
        // Чистим Memory.rooms для комнат, которые мы СЕЙЧАС видим и которые нам не принадлежат
        // (например, потеряли claim, или transient visibility от scout'а в чужой комнате).
        // Невидимые комнаты не трогаем - не знаем их статуса, могут быть наши remote'ы.
        if (Memory.rooms) {
            for (const roomName in Memory.rooms) {
                const room = Game.rooms[roomName];
                if (room && (!room.controller || !room.controller.my)) {
                    delete Memory.rooms[roomName];
                }
            }
        }
        console.log("Died creeps and orphan rooms memory have been deleted");
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

            case 'remote_upgrader':
                roleRemoteUpgrader.run(creep);
                break;

            case 'controller_upgrader':
                roleControllerUpgrader.run(creep);
                break;

            case 'rampart_defender':
                roleRampartDefender.run(creep);
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

            case 'reserver':
                roleReserver.run(creep);
                break;

            case 'extractor':
                roleExtractor.run(creep);
                break;

            case 'safe_mode_generator':
                roleSafeModeGenerator.run(creep);
                break;

            case 'powerBankAttacker':
                rolePowerBankAttacker.run(creep);
                break;

            case 'powerBankHealer':
                rolePowerBankHealer.run(creep);
                break;

            case 'powerCarrier':
                rolePowerCarrier.run(creep);
                break;

            default:
                creep.say('Err role');
        }
    } catch(err) { err.log() };

    // PowerCreeps - отдельный loop, не пересекается с Game.creeps.
    for (const name in Game.powerCreeps) try {
        const pc = Game.powerCreeps[name];
        if (!pc.ticksToLive) continue;  // ещё не задеплоен.
        roleOperator.run(pc);
    } catch (err) { err.log() };
}

module.exports.loop = function() {
    profiler.wrap(function() {
        loop();
    });
}
