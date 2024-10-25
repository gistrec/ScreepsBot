// Модуль - отдельная логическая единица, у которой:
// * Каждый тик вызывается функция process.
//   Вся логика скрыта от другого кода.
// * Минимальное количество функций, доступных наружу.
//   Уменьшаем запутанность.

// Модуль обсерверов:
// * Дефолтное состояние:
//   1. Каждые 10 секунд сканируем "границы большого квадрата"
//   2. Ищем PowerBank

const rooms = [                         "W10S33",
                                        "W10S34",
                                        "W10S35",
                                        "W10S36",         /*W8S36*/
                                        "W10S37",/*W9S37*/
                                        "W10S38",         /*W8S38*/
                   /*W12S39*/           "W10S39",/*W9S39*/
          "W13S40", "W12S40", "W11S40", "W10S40", "W9S41", "W8S40", "W7S40", "W6S40", "W5S40", "W4S40",
                                        "W10S41",         /*W8S41*/
                                        "W10S42",
                                        "W10S43",
];

let current_room_index = 0;
let power_banks = {/* roomName => powerBank */};


const get_observers = function() {
    const rooms = _.filter(Game.rooms, (room) => room.controller && room.controller.my);
    return _.map(rooms, (room) => {
        if (room.memory.observer_id) {
            const observer = Game.getObjectById(room.memory.observer_id);
            if (!observer) {
                delete room.memory.observer_id;
            }
            return observer;
        }
        const observer = room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_OBSERVER}).shift();
        if (observer) {
            room.memory.observer_id = observer.id;
        }
        return observer;
    }).filter(observer => observer);
}

exports.process = function() {
    return;

    // Обрабатываем предыдущий результат.
    const room_name = rooms[current_room_index];
    const room = Game.rooms[room_name];
    if (room) {
        const power_bank = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_POWER_BANK}).shift();
        if (power_bank) {
            console.log(`[${room_name}] PowerBank has been found. ${power_bank.power} power, ${power_bank.ticksToDecay} ttl.`);
            power_banks[room_name] = power_bank;
        } else {
            delete power_banks[room_name];
        }
    }

    // Обозреваем комнату.
    current_room_index = (current_room_index < rooms.length)
        ? current_room_index + 1
        : 0;
    const observers = get_observers();
    observers[0].observeRoom(rooms[current_room_index]);
}