// Метка "интент уже отдан" на структуре.
//
// Движок хранит интенты как intents.set(id, name, data): один слот на (объект, действие),
// повторный вызов в том же тике молча перезаписывает предыдущий (driver lib/runtime/runtime.js
// `set`; engine src/game/structures.js: spawnCreep -> 'createCreep', terminal.send -> 'send',
// link.transferEnergy -> 'transfer'). Проверки spawning / cooldown / store при этом идут по
// снимку начала тика, поэтому второй вызов тоже возвращает OK - первый интент теряется, хотя
// caller уже залогировал "заспавнил / отправил".
//
// Обёртки только ЗАПОМИНАЮТ удачный вызов (this._intentAt = Game.time): возвращаемые коды и
// порядок проверок движка не меняются. Решение "второй раз не звать" принимают callers по
// intentSent: utils.findFreeSpawn, tasks/link, lab.transferResourcesBetweenRooms,
// resourceBalance.balanceEnergy, Room.sendEnergy, resource.buyMineralForBoost. Вызов мимо этих
// проверок ведёт себя как раньше (перезапись); внутри loop таких нет (harvester.spawn - ручной
// консольный хелпер, warrior - мёртвый код). Объекты Game пересоздаются каждый тик, так что
// метка живёт ровно тик; на всякий случай сверяем с Game.time.
Object.defineProperty(Structure.prototype, 'intentSent', {
    configurable: true,
    get() { return this._intentAt === Game.time; },
});

function markIntent(proto, method, isNoop = () => false) {
    const original = proto[method];
    proto[method] = function(...args) {
        const result = original.apply(this, args);
        if (result === OK && !isNoop(...args)) this._intentAt = Game.time;
        return result;
    };
}

// spawnCreep с dryRun возвращает OK до intents.set - интента нет, не помечаем.
markIntent(StructureSpawn.prototype,    'spawnCreep',     (body, name, opts) => !!(opts && opts.dryRun));
markIntent(StructureTerminal.prototype, 'send');
markIntent(StructureLink.prototype,     'transferEnergy');
