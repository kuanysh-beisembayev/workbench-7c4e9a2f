import { readFile } from 'node:fs/promises';

// Query the OSV advisory database without changing the Socket package registry.
const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const packageSection = lockfile.split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0];
if (!packageSection) throw new Error('The lockfile packages section is missing.');
const packages = [...packageSection.matchAll(/^ {2}'?([^\s']+)'?:\s*$/gm)].map(match => {
  const key = match[1];
  const separator = key.lastIndexOf('@');
  if (separator <= 0) throw new Error('Unexpected lockfile package entry.');
  return { name: key.slice(0, separator), version: key.slice(separator + 1) };
});
if (!packages.length) throw new Error('No locked packages were found.');
const response = await fetch('https://api.osv.dev/v1/querybatch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ queries: packages.map(item => ({ package: { name: item.name, ecosystem: 'npm' }, version: item.version })) }),
  signal: AbortSignal.timeout(45_000),
});
if (!response.ok) throw new Error(`OSV audit failed with HTTP ${response.status}.`);
const result = await response.json();
if (!Array.isArray(result.results) || result.results.length !== packages.length) throw new Error('Unexpected OSV response.');
let findings = 0;
result.results.forEach((entry, index) => {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid advisory result.');
  if (entry.vulns !== undefined && !Array.isArray(entry.vulns)) throw new Error('Invalid advisory list.');
  for (const vulnerability of entry.vulns ?? []) {
    if (typeof vulnerability?.id !== 'string') throw new Error('Invalid advisory identifier.');
    console.error(`${packages[index].name}@${packages[index].version}: ${vulnerability.id}`);
    findings++;
  }
});
console.log(`Checked ${packages.length} locked packages against OSV: ${findings} known advisories.`);
if (findings) process.exitCode = 1;
