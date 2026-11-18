import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Room } from '../src/room.js';

export const AGREEMENT = `room: dana-and-maya
members:
  dana:   { role: developer, name: Dana, github: dana-dev }
  maya: { role: client, name: Maya, github: maya-client }
actions:
  question:          { say: ask a question, by: anyone }
  content-change:    { say: change text on the website, by: client, to: developer }
  deploy-staging:    { say: put a change on the test site, by: developer }
  deploy-production: { say: put a change on the live website, by: developer, ok: client }
`;

/** @param {string[]} args @param {string} cwd */
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * A shared bare repo and two clones: one for Dana's agent, one for Maya's.
 * This is the real path: every send is a commit and a push, every read is a pull.
 */
export function twoPeople() {
  const base = mkdtempSync(join(tmpdir(), 'saidso-'));
  const remote = join(base, 'room.git');
  git(['init', '--bare', '-q', '-b', 'main', remote], base);

  const danaDir = join(base, 'dana');
  git(['clone', '-q', remote, danaDir], base);
  identity(danaDir, 'Dana');
  writeFileSync(join(danaDir, 'saidso.yml'), AGREEMENT);
  writeFileSync(join(danaDir, '.gitignore'), '.saidso/\n');
  git(['add', '.'], danaDir);
  git(['commit', '-q', '-m', 'start'], danaDir);
  git(['push', '-q', '-u', 'origin', 'main'], danaDir);

  const mayaDir = join(base, 'maya');
  git(['clone', '-q', remote, mayaDir], base);
  identity(mayaDir, 'Maya');

  const dana = new Room(danaDir); dana.setMe('dana');
  const maya = new Room(mayaDir); maya.setMe('maya');
  return { dana, maya, base };
}

/** @param {string} dir @param {string} name */
function identity(dir, name) {
  git(['config', 'user.name', name], dir);
  git(['config', 'user.email', `${name.toLowerCase()}@example.com`], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
}

/** @param {string} dir */
export function gitLog(dir) {
  return git(['log', '--format=%s'], dir).trim().split('\n');
}
