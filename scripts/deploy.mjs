import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Publish compiled assets to a separate branch. Source remains on main.
const gitOptions = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const git = (args, cwd) => execFileSync('git', [...gitOptions, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const remote = git(['remote', 'get-url', 'origin']).trim();
const parsed = new URL(remote);
if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) throw new Error('Use an HTTPS GitHub origin.');
const directory = mkdtempSync(join(tmpdir(), 'draft-pages-'));
try {
  cpSync(new URL('../dist/', import.meta.url), directory, { recursive: true });
  writeFileSync(join(directory, '.nojekyll'), '');
  git(['init', '-b', 'gh-pages'], directory);
  git(['remote', 'add', 'origin', remote], directory);
  const existing = spawnSync('git', [...gitOptions, 'ls-remote', '--exit-code', '--heads', 'origin', 'gh-pages'], { cwd: directory, encoding: 'utf8' });
  if (existing.status === 0) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], directory);
    git(['reset', '--mixed', 'FETCH_HEAD'], directory);
  } else if (existing.status !== 2) throw new Error('Could not check the Pages branch. Check GitHub authentication.');
  git(['add', '--all'], directory);
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: directory });
  if (staged.status === 0) console.log('The published app is already current.');
  else {
    const source = git(['rev-parse', '--short', 'HEAD']).trim();
    git(['commit', '-m', `Publish app from ${source}`], directory);
    console.log(git(['push', 'origin', 'gh-pages'], directory));
    console.log('Published compiled files to gh-pages. GitHub Pages will deploy this branch.');
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
