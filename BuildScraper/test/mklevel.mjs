import fs from 'node:fs'; import * as nbt from '../src/nbt.js'; import { tag, T } from '../src/nbt.js'; import { gzip } from '../src/compress.js';
const root = tag.compound({ Data: tag.compound({ LevelName: tag.string('Test 1.21'), DataVersion: tag.int(3955), Version: tag.compound({ Name: tag.string('1.21.1'), Id: tag.int(3955) }), SpawnX: tag.int(40), SpawnY: tag.int(70), SpawnZ: tag.int(40), Player: tag.compound({ Pos: tag.list(T.Double, [100.5, 72, 120.5]), Dimension: tag.string('minecraft:overworld') }) }) });
fs.writeFileSync(process.argv[2], await gzip(nbt.write(root, '')));
