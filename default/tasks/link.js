const utils = require('../utils');


// Source-линки сидят рядом с энергетическими сорсами (range 2 - radius miner.transferEnergy
// не нужен, но миннер именно так находит "свой" линк - см. sources.js). Target-линки -
// всё, что не source: обычно один линк у storage и опционально один у controller.
// Per-tick кеш чтобы не звать find() на каждый transferLinkEnergy.
function getLinkConfig(room) {
    return room.cache('linkConfig', r => {
        const links = utils.getMyStructuresByType(r)[STRUCTURE_LINK] || [];
        if (links.length === 0) return null;

        const sources = r.find(FIND_SOURCES);
        const sourceLinks = links.filter(l => sources.some(s => l.pos.inRangeTo(s, 2)));
        const targetLinks = links.filter(l => !sourceLinks.includes(l));

        return { sources: sourceLinks, targets: targetLinks };
    });
}

exports.transferLinkEnergy = function(room) {
    const cfg = getLinkConfig(room);
    if (!cfg) return;

    for (const target of cfg.targets) {
        if (target.store.getUsedCapacity(RESOURCE_ENERGY) > 200) continue;

        for (const source of cfg.sources) {
            if (source.store.getUsedCapacity(RESOURCE_ENERGY) != 800) continue;
            source.transferEnergy(target);
        }
    }
}
