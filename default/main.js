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
const roleWarrior   = require('roles/warrior');
const roleDefender  = require('roles/defender');
const roleExtractor = require('roles/extractor');
const roleRemoteUpgrader     = require('roles/remoteUpgrader');
const roleRampartDefender    = require('roles/rampartDefender');
const roleSafeModeGenerator  = require('roles/safeModeGenerator');
const roleControllerUpgrader = require('roles/controllerUpgrader');

const taskDefend = require('tasks/defend');
const taskCreep  = require('tasks/creep');
const taskRoom   = require('tasks/room');
const taskBoost  = require('tasks/boost');
const taskLink   = require('tasks/link');

const moduleLab   = require('modules/lab');
const moduleBuild = require('modules/build');
const moduleObserver  = require('modules/observer');
const moduleExpansion = require('modules/expansion');
const moduleResourceBalance = require('modules/resourceBalance')

const visualization = require('visualization');


const profiler = require('screeps-profiler');
profiler.enable();


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
}

function upgradeCreeps(room) {
    if (!roleCharger.upgrade(room)) return;
    if (!roleUpgrader.upgrade(room)) return;
}

function updateRoom(room) {
    if (room.memory.defending || Game.time % 5 == 0) try {
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

    const rebalanceTime = room.memory.enemy_creeps ? 100 : 600;
    if (Game.time % rebalanceTime == 0) try {
        roleDefender.rebalanceRepairing(room);
        roleUpgrader.rebalanceRepairing(room)
    } catch(err) { err.log() };
}

loop = function () {
    if (Game.cpu.bucket >= 10000) try {
        Game.cpu.generatePixel()
    } catch (err) { err.log() };

    try { moduleLab.process();             } catch (err) { err.log() }
    try { moduleBuild.process();           } catch (err) { err.log() }
    try { moduleObserver.process();        } catch (err) { err.log() }
    try { moduleExpansion.process();       } catch (err) { err.log() }
    try { moduleResourceBalance.process(); } catch (err) { err.log() }

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

module.exports.loop = function() {
    profiler.wrap(function() {
        loop();
    });
}
