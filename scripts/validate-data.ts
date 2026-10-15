import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { catalogSchema, parseStatistics, statisticsSchema } from '../src/data.ts';

const heroes = catalogSchema.parse(JSON.parse(readFileSync(new URL('../public/data/heroes.json', import.meta.url), 'utf8')));
const statistics = parseStatistics(JSON.parse(readFileSync(new URL('../public/data/statistics.json', import.meta.url), 'utf8')), heroes);
writeFileSync(new URL('../public/data/statistics.schema.json', import.meta.url), JSON.stringify(z.toJSONSchema(statisticsSchema), null, 2) + '\n');
console.log(`Validated ${heroes.length} heroes, ${statistics.roleStats.length} role records, and ${statistics.matchups.length} matchup records.`);
