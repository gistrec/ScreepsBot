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
const roleRemoteUpgrader    = require('role.remoteUpgrader');
const roleSafeModeGenerator = require('role.safeModeGenerator');

const taskDefend = require('task.defend');
const taskCreep  = require('task.creep');
const taskRoom   = require('task.room');

const statistics = require('statistics');

// const configurationTank = require('configuration.tank');


function spawnCreeps(room) {
    if (!roleMiner.spawn(room)) return;
    if (!roleCharger.spawn(room)) return;
    if (!roleDefender.spawn(room)) return;
    if (!roleUpgrader.spawn(room)) return;
}

function upgradeCreeps(room) {
    if (!roleCharger.upgrade(room)) return;
    if (!roleUpgrader.upgrade(room)) return;
}

function updateRoom(room) {
    if (Game.time % 5 == 0) try {
        taskDefend.checkStatus(room);
    } catch(err) { console.log(err) };
    if (Game.time % 10 == 0) try {
        spawnCreeps(room);
        taskRoom.renewCreeps(room);
    } catch (err) { console.log(err) };
    if (Game.time % 200 == 0) try {
        upgradeCreeps(room);
    } catch (err) { console.log(err) };
    
    statistics.room(room);
    statistics.map(room);

    taskRoom.recalculateCostMatrixRewrites(room);
}

module.exports.loop = function () {
    if (Game.cpu.bucket >= 10000) try {
        Game.cpu.generatePixel()
    } catch (err) { console.log(err) };
    
    for (const roomName in Game.rooms) try {
        const room = Game.rooms[roomName];
        updateRoom(room)    
    } catch (err) { console.log(err) }

    try {
        taskDefend.fireTower()
    } catch(err) { console.log(err) };
    
    for (const name in Game.creeps) try {
        const creep = Game.creeps[name];

        // Если есть команда к перемещению
        if (taskCreep.checkGoTo(creep) == OK) continue;
        // Если крип находится в конфигурации
        if (creep.memory.configuration_id) continue;
        // Если есть команда на переработку
        if (taskCreep.checkRecycling(creep) == OK) continue;

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
    } catch(err) { console.log(err) };
}