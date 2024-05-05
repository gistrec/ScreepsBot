// Конфигурация ботов, являющаяся чем-то вроде танка. Основана на HEAL.
// Максимальный хиллрейт:  1     2     3     4     5 |    6     7     8
// 1x1: 12 * HEAL         12    24    36    48    60 |   72    84    96
// 2x2: 48 * HEAL         48    96   144   192   240 |  288   336   384
// 3x3: 68 * HEAL         68   136   204   272   340 |  408   476   544
// 4x4: 96 * HEAL         96   192   288   384   480 |  576   672   768

exports.processAll = function() {
    for (const configuration of Memory.configurations) {
        if (!configuration.id || !configuration.size || !configuration.type) {
            console.log('Error configuration memory!');
            continue;
        };
        // Обрабатываем только конфигурацию tank
        if (configuration.type != "tank") continue;

        process(configuration);
    }
}

const STATUS_WAIT  = 0;
const STATUS_READY = 1;

// Переменные у конфигурации:
// * {Number} id   - идентификатор конфигурации, будет установлен у Creep.memory.configuration_id
// * {Number} size - размер квадрата
// * {String} type - равен "tank"
//
// * {String} status - статус конфигурации: "wait", "ready"
// * {Array}  creeps - массив с крипами размера `size x size`
//
// * {String} command - действие, которое задается через консоль. Например:
//                      LEFT, RIGTH, BOTTOM, TOP - передвижение
//                      ATTACK:${id}             - атака структуры с заданным id (без перемещения)
//
// * {RoomPosition} position - позиция (верхний левый угол)

// Переменные у крипа:
// * {Number} configuration_id       - идентификатор конфигурации

/**
 * Основная логика конфигурации, делится на секции:
 * 1. Добавление нового крипа
 * 2. Формирования строя (заполнение ячеек ботами)
 * 3. Хилим поврежденных крипов
 * 4. Обработка команд
 */
const process = function(configuration) {
    const creeps = _.filter(Game.creeps, (creep) => creep.memory.configuration_id == configuration.id)
    // Процесс добавления нового крипа: устанавливаем у него переменную configuration_id
    if (creeps.length != configuration.creeps.length) {
        // Не можем добавить нового крипа в конфигурацию
        if (creeps.length > configuration.size * configuration.size) {
            console.log(`Configuration ${configuration.id} has extra creeps`);
            return; // TODO: Нужно ли?
        }

        // Добавляем крипа в массив крипов
        for (const creep of creeps) {
            const added = _.some(configuration.creeps, (creepName) => creepName == creep.name);
            if (added) continue;

            configuration.creeps.push(creep.name);
            console.log(`Add ${creep.name} to configuration ${configuration.id}`);
        }
    }

    let status = STATUS_WAIT;
return;
    // Процесс формирования строя
    for (let i = 0; i < configuration.creeps.length; i++) {
        // Позиция на которой должен стоять крип
        const position = new RoomPosition(
            configuration.position.x() + i % configuration.size,
            configuration.position.y() + Math.floor(i / 2),
            configuration.position.roomName(),
        );
        const creepName = configuration.creeps[i];
        const creep = Game.creeps[creepName];
        if (creep.pos.x != position.x || creep.pos.y != position.y || creep.pos.roomName != position.roomName) {
            creep.say('🏃 Configuration')
            creep.moveTo(position, {
                visualizePathStyle: {
                    stroke: '#00FFFF',
                    lineStyle: 'dashed',
                    opacity: .75
                }
            });
            status = STATUS_READY;
        }
    }

    // Ждем пока все крипы займут свои позиции
    if (status != STATUS_READY) return;

    ///////////////////////////////////////////////
    //        Алгоритм вычинивания крипов        //
    ///////////////////////////////////////////////

    // Масств размера size x size, хранящий недостающие ХП
    let damaged =  _.map(configuration.creeps, (creepName) => {
        const creep = Game.creeps[creepName];
        return creep.hitsMax - creep.hits;
    })
    // Массив размера size x size, хранящий информацию о том, похилил крип или нет
    let healing = _.map(configuration.creeps, (creepName) => false);

    // Сначала пытаемся хилить ближайших крипов
    for (let i = 0; i < configuration.creeps.length; i++) {
        // Получаем крипов в соседних клетках, которым необходим хил
        const creeps = 1;
    }


    // Проверяем нужно ли хилить крипов
    // const action = configuration.action;

}