# Screeps Bot

Автономный игровой бот для [Screeps World](https://screeps.com/) — MMO-стратегии, в которой вместо мышки вы управляете юнитами **кодом на JavaScript**.

---

## 🎮 Что такое Screeps?

Screeps — это **программируемая RTS**. Игра работает на собственном сервере 24/7. Вы загружаете на сервер JavaScript-код — и он каждый игровой тик (≈ 3 секунды) управляет вашими юнитами и комнатами. Логику вы пишете и заливаете; дальше игра идёт сама — пока вы спите, обедаете или путешествуете.

Основные сущности:

| Сущность   | Что это |
|------------|---------|
| **Room**   | Карта 50×50 клеток. Источники энергии, минералы, вражеские базы. |
| **Creep**  | Ваш юнит. Тело собирается из частей — `WORK`, `CARRY`, `MOVE`, `ATTACK`, `HEAL`, `RANGED_ATTACK`, `TOUGH`, `CLAIM`. |
| **Spawn**  | Здание, рождающее creep'ов. Они стоят энергию. |
| **Structure** | Постройки: extension'ы (хранят энергию), tower'ы (атака/хил/ремонт), storage, terminal, factory, link, lab, observer, nuker. |
| **CPU**    | Бюджет процессорного времени за тик (по умолчанию 20). Превысил — твои крипы стоят. |

Игра жёстко требует оптимизации. Невозможно «спамить» компонентами — каждый `find()`, каждый pathfinding съедают CPU. Поэтому бот — это не только логика, но и кэши, дросселирование, выборочная пересчёт-стратегия.

---

## 🤖 Что умеет этот бот

### Экономика

- **Майнинг с handoff'ом**: новый майнер заранее спавнится, привязывается к источнику pre-assign'ом, старый суицидится при появлении замены — вместо тупого пересечения двух крипов на одном споте.
- **Динамический TTL-порог**: учитывает реальное время spawn+walk нового тела, а не хардкод.
- **Пауза майнинга при насыщении** (`getTotalEnergy() > 2M`, считается с учётом батареек ×10) — нет смысла гонять майнеров если складам некуда.
- **Балансировка энергии между комнатами**: rich → poor через `terminal.send`, с учётом cooldown'ов и трансакционных издержек.
- **Компрессия / декомпрессия**: при переизбытке — энергия → батарейки в factory. Под атакой — обратное преобразование, чтобы tower'ы не сидели голодные.

### Производство в лабах

- **Многоэтапная цепочка**: T1-минералы (OH, LH, ZH, …) производятся в одних комнатах, объединяются в T2 (LH2O, XLH2O, …) в других через `terminal.send`.
- **Force-evac «зависших» лаб**: если storage и terminal перенасыщены и target-labs не могут вылить продукт более 500 тиков — выгружаем всё насильно, освобождая лабы для других задач (boost, смена рецепта).
- **Контроль грязных лаб**: если лаба содержит не тот минерал (после boost-задачи) — эвакуация перед следующей реакцией.
- **Smart refill source-лаб**: топ-ап до 1500 (а не до полного), чтобы не блокировать дорогие минералы вроде X в лабе.

### Оборона

- **Auto-safeMode** срабатывает по двум сигналам:
  1. rampart упал ниже 5% HP, OR
  2. суммарный HP rampart'ов просел > 5k за тик (детектор «нас сейчас быстро ломают», работает даже на 300M-rampart'ах).
- **Tower'ы** под атакой: динамический порог ремонта (15k → 100k), учёт дальности при heal.
- **Rampart defender** ищет цели с приоритетом по угрозе: HEAL → WORK → ATTACK/RANGED_ATTACK. Координирует rampart'ы между собой (не лезут на один и тот же).
- **Defender prioritization**: ремонт rampart'ов, ближайших к врагам и в зоне приземления нюков.

### Nuker

- Заполняется (energy + ghodium) только когда **в комнате спокойно**:
  - нет врагов сейчас,
  - с последней атаки прошло ≥ 5000 тиков,
  - `getTotalEnergy() ≥ 1.5M`.
- Низкий приоритет в fill-цепочке (после spawn/ext/tower/lab/terminal/storage).

### Charger logic

- В мирном режиме fallback на резервы (storage/terminal/factory) при наличии **реального потребителя** — иначе CPU гонял бы charger'а в бесконечном цикле storage↔terminal.
- Под атакой — берёт сразу из защищённых складов, без захода к контейнерам у источников.
- **Interrupt**: долгоживущие задачи (`transfer`, `disassemble`) автоматически прерываются под атакой / при энерго-кризисе, если крип не везёт минералы. Возобновляются когда условие снимется.

### Визуализация

В каждой моей комнате над контроллером:

```
〽️ E/t: 15.2
⚡ Energy 27000/30000
🏰 Upgrade 67.42%
⚔️ Defending mode: Off
🧪 OH: 5/8 active
```

Цветовой код для состояния лаб:
- 🟦 active — реакции идут.
- 🟥 stuck — terminal+storage перенасыщены, лабы не могут вылить.
- 🟪 evacuating — stuck слишком долго, выгружаем насильно.
- 🟧 dirty — в лабе чужой минерал.
- 🟨 idle — нет входных минералов.

---

## 🚀 Как развернуть

### Требования

- [Node.js](https://nodejs.org/) (только для локальной сборки и push'а — на сервере Screeps свой движок).
- Аккаунт на [screeps.com](https://screeps.com/) и [API token](https://docs.screeps.com/auth-tokens.html).

### Установка

```bash
git clone <repo>
cd screeps
npm install
```

### Конфигурация

Положи в `~/.zshrc` или `~/.bashrc`:

```bash
export SCREEPS_EMAIL="you@example.com"
export SCREEPS_TOKEN="<your-api-token>"
```

### Деплой

```bash
grunt          # пересобирает default/ и пушит на сервер
```

> ⚠️ **Важно:** `grunt screeps` (без default-таски) **только** загружает то, что лежит в `build/step_2/` — без пересборки. Это частая ловушка: правишь файлы в `default/`, бежишь `grunt screeps`, но улетает старый билд.

### Pipeline

Screeps хранит код плоским списком файлов (без папок). Поэтому `default/foo/bar.js` нельзя загрузить как есть. Grunt:

1. Копирует `default/**` → `build/step_1/`.
2. Переписывает `require('./foo/bar')` → `require('foo_bar')`.
3. Сплющивает `build/step_1/foo/bar.js` → `build/step_2/foo_bar.js`.
4. Пушит `build/step_2/*` через `grunt-screeps`.

---

## ⚙️ Тюнинг через memory

Все важные пороги переопределяются прямо из консоли Screeps без пересборки:

```js
// Не майнить, пока в комнате есть >3M энергии-эквивалента (вместо дефолта 2M).
Memory.rooms.W12S39.miner_pause_total_energy = 3_000_000;

// Заливать nuker только если энергии больше 2.5M.
Memory.rooms.W12S39.nuker_fill_min_total_energy = 2_500_000;

// Считать комнату «спокойной» только после 10k тиков мира.
Memory.rooms.W12S39.nuker_fill_peace_ticks = 10000;

// Включить профилировщик (после следующего push кода).
Memory.profiler_enabled = true;

// Запретить авто-safeMode для конкретной комнаты.
Memory.rooms.W11S39.disable_safe_mode = true;

// Force-evac лаб после 1000 тиков stuck вместо 500.
Memory.rooms.W12S39.lab_stuck_evac_delay = 1000;
```

---

## 🏗️ Архитектура

Высокоуровнево, каждый тик `main.js`:

```
1. Tick loop start
2. Глобальные модули:
     lab.process       — реакции и transfer'ы между комнатами
     build.process     — авто-постройка структур
     observer.process  — сканирование комнат
     expansion.process — claim новой комнаты
     resourceBalance.process — energy / minerals / battery
     visualization.process

3. Для каждой комнаты:
     defend.checkStatus     — каждый тик при defending, иначе раз в 5
     defend.fireTower       — каждый тик
     link.transferLinkEnergy — каждый тик
     spawnCreeps            — каждые 10 тиков (sequential: miner → charger → …)
     upgradeCreeps          — каждые 300 тиков
     rebalanceRepairing     — каждые 600 (или 100 под атакой)
     scheduleNukerGhodium   — каждые 1000 тиков

4. Cleanup:
     Memory.creeps[deadName]
     Memory.rooms[stale]

5. Для каждого creep:
     boost / unboost / goto / recycle pre-checks
     роль.run(creep)  — switch по memory.role
```

**Sequential spawn order** (`miner → charger → rampartDefender → upgrader → extractor`) намеренно. Без миньонов нет энергии. Без charger'а энергия не доходит до спавна. Эта последовательность гарантирует bootstrap пустой комнаты.

---

## 📁 Структура проекта

```
default/
  main.js                — entry point + per-tick loop
  sources.js             — source assignment для майнеров
  utils.js               — getStructuresByType cache, minerReplacementTtl
  visualization.js       — room overlays
  modules/               — макро-системы
    lab.js               — реакции, transfer T1, force-evac
    build.js             — авто-постройка
    observer.js          — сканирование
    expansion.js         — claim
    resourceBalance.js   — energy/mineral/battery balancing
  prototypes/            — расширения движка
    creep.js             — bodyPartCost, isDangerous, hasAnyBoosts
    room.js              — getStoredEnergy, getTotalEnergy, getFactory, transfer, sendEnergy
    others.js            — Error.log(), Array/String position parsing
  roles/                 — поведение крипов (.spawn / .run)
    miner.js             — добыча
    charger.js           — энергелогистика
    upgrader.js          — апгрейд контроллера, ремонт стен
    defender.js          — оборона + ремонт под атакой
    rampartDefender.js   — стационарный боец на rampart'е
    extractor.js         — добыча минералов
    harvester.js         — remote-добыча
    warrior.js           — атакующий
    scout.js             — разведка
    claimer.js           — захват комнат
    remoteUpgrader.js    — апгрейд чужого контроллера
    controllerUpgrader.js
    safeModeGenerator.js — enabler safeMode через ghodium
  tasks/                 — общие подпрограммы
    boost.js             — лабораторный буст крипов
    creep.js             — TTL renew, recycle, goto
    defend.js            — checkStatus, fireTower
    link.js              — баланс энергии между линками
    resource.js          — fill/withdraw/harvest helpers + interrupts
    room.js              — cost matrix, claim, controller maintenance
    structure.js         — build/repair helpers
Gruntfile.js             — build pipeline
export.js                — обратный pull (с сервера в файлы)
```

---

## 📝 Стиль коммитов

Краткие, в повелительном наклонении, с заглавной первой буквы:

```
Fix bugs in default
Improve energy balancing
Reduce CPU spikes during attacks
Pause mining when room is energy-saturated
Force-evacuate stuck labs after delay
```

---

## 🔗 Полезные ссылки

- [Документация Screeps API](https://docs.screeps.com/api/)
- [Гайд для новичков](https://docs.screeps.com/contributed/intro.html)
- [Discord-сообщество](https://discord.gg/screeps)
- [Awesome-Screeps](https://github.com/screepers/awesome-screeps) — список бот-репозиториев и инструментов
