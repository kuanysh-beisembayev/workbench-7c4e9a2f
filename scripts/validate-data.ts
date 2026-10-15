import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { catalogSchema, parseStatistics, statisticsSchema } from '../src/data.ts';

const heroes = catalogSchema.parse(JSON.parse(readFileSync(new URL('../public/data/heroes.json', import.meta.url), 'utf8')));
for (const hero of heroes) {
  const portrait = readFileSync(new URL('../public/images/heroes/' + encodeURIComponent(hero.slug) + '.png', import.meta.url));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (portrait.length < 1000 || !portrait.subarray(0, 8).equals(signature) || portrait.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Invalid portrait for ${hero.name}`);
  }
  const width = portrait.readUInt32BE(16);
  const height = portrait.readUInt32BE(20);
  if (width < 128 || height < 72 || width * 9 !== height * 16) throw new Error(`Invalid portrait dimensions for ${hero.name}`);
}
const statistics = parseStatistics(JSON.parse(readFileSync(new URL('../public/data/statistics.json', import.meta.url), 'utf8')), heroes);
writeFileSync(new URL('../public/data/statistics.schema.json', import.meta.url), JSON.stringify(z.toJSONSchema(statisticsSchema), null, 2) + '\n');
console.log(`Validated ${heroes.length} heroes and portraits, ${statistics.roleStats.length} role records, and ${statistics.matchups.length} matchup records.`);
