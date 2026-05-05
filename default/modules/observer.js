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


const get_observers = exports.get_observers = function() {
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

// Power bank registry. Каждое сканирование пишет/обновляет/удаляет запись по id банка.
// Поля: { id, roomName, x, y, hits, amount, decayAt, status, squad }.
// status переключается из observer'a и powerBank-модуля:
//   'pending'   - банк только найден, ещё никого не послали
//   'attacking' - squad назначен и едет/бьёт
//   'looting'   - банк уничтожен, дроп ждёт carrier'ов
//   'done'      - всё забрали (cleanup'ится)
exports.process = function() {
    if (!Memory.power_banks) Memory.power_banks = {};

    // Обрабатываем результат предыдущего observeRoom (комната видна 1 тик после observe).
    const room_name = rooms[current_room_index];
    const room = Game.rooms[room_name];
    if (room) {
        const power_bank = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_POWER_BANK}).shift();
        if (power_bank) {
            const existing = Memory.power_banks[power_bank.id];
            if (!existing) {
                console.log(`[${room_name}] PowerBank found: ${power_bank.power} power, ${power_bank.hits} HP, ${power_bank.ticksToDecay} ttl.`);
                Memory.power_banks[power_bank.id] = {
                    id:       power_bank.id,
                    roomName: room_name,
                    x:        power_bank.pos.x,
                    y:        power_bank.pos.y,
                    hits:     power_bank.hits,
                    amount:   power_bank.power,
                    decayAt:  Game.time + power_bank.ticksToDecay,
                    status:   'pending',
                    squad:    [],
                };
            } else {
                // Refresh live данных. status/squad не трогаем - ими владеет powerBank-модуль.
                existing.hits     = power_bank.hits;
                existing.decayAt  = Game.time + power_bank.ticksToDecay;
            }
        } else {
            // Банка в комнате больше нет. Запись с status=='looting' оставляем (carrier'ы
            // ещё едут забирать дроп), остальные удаляем.
            for (const id in Memory.power_banks) {
                if (Memory.power_banks[id].roomName == room_name
                 && Memory.power_banks[id].status != 'looting') {
                    delete Memory.power_banks[id];
                }
            }
        }
    }

    // Cleanup: protacted-status или истёкшие записи. Реже - find выше уже подчищает в норме.
    if (Game.time % 100 === 0) {
        for (const id in Memory.power_banks) {
            const entry = Memory.power_banks[id];
            if (entry.status === 'done' || entry.decayAt < Game.time) {
                delete Memory.power_banks[id];
            }
        }
    }

    // Сканируем следующую комнату по кругу. Видимость появится в следующем тике.
    current_room_index = (current_room_index + 1) % rooms.length;
    const observers = get_observers();
    if (observers.length > 0) {
        observers[0].observeRoom(rooms[current_room_index]);
    }
}