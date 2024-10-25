const links = {
    "W9S37": {
        targets: ["62d1be99bf18f825ec75da79"],
        sources: ["625080d3c6f82b8cc51f2eec", "6257014e1069bb663da23b02"],
    },
    "W8S36": {
        targets: ["6321c2f464973c587e22ee74"],
        sources: ["63286662ab17672ba6039450"],
    },
    "W8S38": {
        targets: ["62fd0025b2eed5f0538f7621"],
        sources: ["626ba802fa0bdbfa8cac8c9e", "62d951b1a8e094d6397138d1"]
    },
    "W9S39": {
        targets: ["62f235de30c135a013930579"],
        sources: ["6396674e527450ad5ece4bb1", "63966e994a12a5284801bd74"]
    },
    "W12S39": {
        targets: ["6360b71d1b732040fccd6225"],
        sources: ["6360c22b5bcf9d5336065430", "63689c7a7a86a4d3cfc5ddca"]
    },
    "W11S39": {
        targets: ["636656f7fb9c9699d509416f"],
        sources: ["63665abc6d7b718202fd8734", "6395dfe58688eb2a142e4304"]
    },
    "W12S37": {
        targets: ["66433fdd6bce394246588b58"],
        sources: ["66434decaa3b0a9e5eced64e", "6644a6b0e7438745422463be"]
    }
}

exports.transferLinkEnergy = function(room) {
    if (!links[room.name]) {
        return;
    }

    const targets_ids = links[room.name]["targets"];
    const sources_ids = links[room.name]["sources"];
    for (const target_id of targets_ids) {
        const target = Game.getObjectById(target_id);
        if (!target) {
            console.log(`[${room.name}] There is not link with id ${target_id}`);
            continue;
        }

        if (target.store.getUsedCapacity(RESOURCE_ENERGY) > 200) {
            continue;
        }

        for (const source_id of sources_ids) {
            const source = Game.getObjectById(source_id);
            if (!source) {
                console.log(`[${room.name}] There is not link with id ${source_id}`);
                continue;
            }

            if (source.store.getUsedCapacity(RESOURCE_ENERGY) != 800) {
                continue;
            }

            source.transferEnergy(target);
        }
    }
}