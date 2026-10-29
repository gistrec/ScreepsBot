// Модуль - отдельная логическая единица, у которой:
// * Каждый тик вызывается функция process.
//   Вся логика скрыта от другого кода.
// * Минимальное количество функций, доступных наружу.
//   Уменьшаем запутанность.

// Модуль обсерверов:
// * Дефолтное состояние:
//   1. Каждые 10 секунд сканируем "границы большого квадрата"
//   2. Ищем PowerBank

const modulePowerBank = require('./powerBank');

// Сколько тиков после decayAt банка (или последнего увиденного лута) запись в 'looting'
// переживает cleanup (см. ниже).
const LOOT_GRACE = 3000;

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
// Поля: { id, roomName, x, y, hits, amount, decayAt, status, squad, contested, home_room }.
// status переключается из observer'a и powerBank-модуля:
//   'pending'   - банк только найден, ещё никого не послали
//   'attacking' - squad назначен и едет/бьёт
//   'stealing'  - банк бьёт кто-то другой, ждём смерти чтобы подобрать дроп
//   'looting'   - банк уничтожен, дроп ждёт carrier'ов
//   'done'      - всё забрали (cleanup'ится)
exports.process = function() {
    if (!Memory.power_banks) Memory.power_banks = {};

    // Обрабатываем результат предыдущего observeRoom (комната видна 1 тик после observe).
    const room_name = rooms[current_room_index];
    const room = Game.rooms[room_name];
    if (room) {
        const power_bank = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_POWER_BANK}).shift();
        // Враги с ATTACK-частями = кто-то уже ломает банк. Source Keeper'ов на хайвеях нет,
        // Invader'ы структуры не трогают - значит это другой игрок и наш сквад туда не нужен.
        const hostileAttackers = power_bank
            ? room.find(FIND_HOSTILE_CREEPS, {filter: c => c.body.some(p => p.type === ATTACK)})
            : [];
        if (power_bank) {
            const existing = Memory.power_banks[power_bank.id];
            const isContested = hostileAttackers.length > 0;
            if (!existing) {
                const note = isContested ? ` [contested by ${hostileAttackers.length} hostile attackers]` : '';
                console.log(`[${room_name}] PowerBank found: ${power_bank.power} power, ${power_bank.hits} HP, ${power_bank.ticksToDecay} ttl${note}.`);
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
                    contested: isContested,
                    hitsLastScanTick: Game.time,
                    dps:      0,
                };
            } else {
                // Refresh live данных. status/squad не трогаем - ими владеет powerBank-модуль.
                // DPS estimate: HP-дельта между сканами (одна комната сканится раз в ~rooms.length
                // тиков). Используется визуализацией для оценки tickToDeath. Если HP не упало
                // (никто не бил между сканами) - dps=0.
                if (existing.hitsLastScanTick !== undefined) {
                    const deltaHits  = existing.hits - power_bank.hits;
                    const deltaTicks = Game.time - existing.hitsLastScanTick;
                    if (deltaTicks > 0) {
                        existing.dps = deltaHits > 0 ? Math.round(deltaHits / deltaTicks) : 0;
                    }
                }
                existing.hitsLastScanTick = Game.time;
                existing.hits     = power_bank.hits;
                existing.decayAt  = Game.time + power_bank.ticksToDecay;
                // Помечаем contested только пока 'pending' - если сквад уже в пути ('attacking'),
                // вмешиваться поздно, доводим бой до конца. 'stealing' уже помечен.
                if (!existing.contested && isContested && existing.status === 'pending') {
                    existing.contested = true;
                    console.log(`[${room_name}] PowerBank ${power_bank.id} contested by ${hostileAttackers.length} hostile attackers.`);
                }
            }
        } else {
            // Банка в комнате больше нет.
            for (const id in Memory.power_banks) {
                const entry = Memory.power_banks[id];
                if (entry.roomName != room_name) continue;
                if (entry.status == 'looting') {
                    // Power кончилась (ни drop/ruin/tombstone в комнате, ни груза у carrier'ов) -
                    // done. Без своих крипов в комнате powerBank.process этого не видит, и запись
                    // висела бы до cleanup'а ниже, держа слот power_bank_max_active, а первая волна
                    // carrier'ов после гибели уезжала бы впустую.
                    if (modulePowerBank.hasLootInRoom(room)) {
                        entry.lootSeenAt = Game.time;
                    } else if (!modulePowerBank.carriersCarrying(entry)) {
                        console.log(`[${room_name}] Bank ${id} fully looted.`);
                        entry.status = 'done';
                    }
                    continue;
                }
                // 'attacking'/'stealing' с заданным home_room: банк убит или decay'нулся. Есть
                // power (ruin/drop) - 'looting', carrier'ов спавнит powerBank.process; нет - 'done'
                // без carrier'ов (раньше при decay уезжали 3 пустых рейса). Раньше 'attacking'-
                // запись просто удалялась, если observer успевал раньше process() - и дроп терялся.
                if (entry.home_room && (entry.status == 'attacking' || entry.status == 'stealing')) {
                    const next = modulePowerBank.hasLootInRoom(room) ? 'looting' : 'done';
                    console.log(`[${room_name}] Bank ${id} disappeared during ${entry.status} -> ${next}.`);
                    entry.status = next;
                    if (next == 'looting') entry.lootSeenAt = Game.time;
                    continue;
                }
                delete Memory.power_banks[id];
            }
        }
    }

    // Cleanup: protacted-status или истёкшие записи. Реже - find выше уже подчищает в норме.
    // 'looting' живёт дольше decayAt банка: лут убитого банка лежит на земле до ~2300 тиков
    // (5000 power по ceil(amount/1000) за тик) плюс tombstone'ы carrier'ов (5 тиков на часть);
    // выход из looting - скан выше (нет лута и никто не везёт -> done), здесь только страховка.
    // Раньше запись удалялась по decayAt с лутом на земле - carrier'ы (`!bank`) бросали сбор.
    // Отсчёт от последнего увиденного лута (lootSeenAt): цепочка погибших carrier'ов держит power
    // в tombstone'ах и отодвигает decay, абсолютный дедлайн удалил бы запись с лутом.
    if (Game.time % 100 === 0) {
        for (const id in Memory.power_banks) {
            const entry = Memory.power_banks[id];
            const deadline = entry.status === 'looting'
                ? Math.max(entry.decayAt, entry.lootSeenAt || 0) + LOOT_GRACE
                : entry.decayAt;
            if (entry.status === 'done' || deadline < Game.time) {
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