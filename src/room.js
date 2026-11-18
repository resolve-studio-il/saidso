// A room is a folder (normally a git repo shared by the people in it).
// Every message is one Markdown file in messages/. Nothing is edited or deleted:
// a decision or a notice is a new file that points at the message it is about.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import YAML from 'yaml';
import { loadPolicy, evaluate, displayName, SaidsoError, POLICY_FILE } from './policy.js';
import * as notice from './notice.js';

/**
 * @typedef {import('./policy.js').Policy} Policy
 * @typedef {{
 *   id: string, at: string, from: string, to: string,
 *   kind: 'info' | 'ask' | 'notice' | 'decision',
 *   action?: string, thread: string, re?: string,
 *   verdict?: 'deliver' | 'needs-ok' | 'blocked', reason?: string, ok_from?: string[],
 *   decision?: 'approved' | 'denied', for?: 'person' | 'agent',
 *   body: string,
 * }} Message
 * @typedef {'delivered' | 'waiting-for-ok' | 'approved' | 'denied' | 'blocked'} Status
 */

const MESSAGES = 'messages';
const LOCAL = '.saidso';
const ACCEPTED = 'accepted-agreement.yml';
const KINDS = new Set(['info', 'ask', 'notice', 'decision']);

/** Find the room: --room, then SAIDSO_ROOM, then the current folder. @param {string} [explicit] */
export function roomDir(explicit) {
  return resolve(explicit ?? process.env.SAIDSO_ROOM ?? process.cwd());
}

export class Room {
  /** @param {string} dir @param {{ sync?: boolean }} [opts] */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.sync = opts.sync ?? isGitRepo(dir);
    /** @type {Policy} */
    this.policy = loadPolicy(dir);
  }

  /** Who this copy of the room speaks for. */
  me() {
    const id = process.env.SAIDSO_ME || readLocal(this.dir, 'me')?.trim();
    if (!id) throw new SaidsoError('This copy of the room does not know who you are yet. Run "saidso whoami --set <member>".');
    if (!this.policy.members[id]) throw new SaidsoError(`"${id}" is not a member in ${POLICY_FILE}.`);
    return id;
  }

  /** @param {string} id */
  setMe(id) {
    if (!this.policy.members[id]) throw new SaidsoError(`"${id}" is not a member in ${POLICY_FILE}. Members: ${Object.keys(this.policy.members).join(', ')}`);
    writeLocal(this.dir, 'me', id + '\n');
    if (readLocal(this.dir, ACCEPTED) === undefined) this.acceptAgreement();
  }

  /**
   * The agreement is only valid as this person accepted it. If someone changes saidso.yml,
   * this copy of the room stops sending and acting until a person here reads the change and accepts it.
   */
  agreementChange() {
    const current = readFileSync(join(this.dir, POLICY_FILE), 'utf8');
    const accepted = readLocal(this.dir, ACCEPTED);
    return { changed: accepted !== undefined && accepted !== current, accepted, current };
  }

  acceptAgreement() {
    writeLocal(this.dir, ACCEPTED, readFileSync(join(this.dir, POLICY_FILE), 'utf8'));
  }

  #guard() {
    const c = this.agreementChange();
    if (c.accepted === undefined) { this.acceptAgreement(); return; }
    if (c.changed) {
      throw new SaidsoError('The agreement (saidso.yml) changed since your person last accepted it. Nothing is sent or done until they read the change and accept it, themselves: saidso agreement');
    }
  }

  /** Bring in what others wrote. Safe to call often. */
  pull() {
    if (!this.sync) return;
    if (!hasRemote(this.dir)) return;
    git(this.dir, ['pull', '--rebase', '--quiet']);
    this.policy = loadPolicy(this.dir);
  }

  /** @returns {Message[]} oldest first */
  all() {
    const dir = join(this.dir, MESSAGES);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => parseMessage(readFileSync(join(dir, f), 'utf8')))
      .filter((m) => KINDS.has(m.kind) && (m.from === 'saidso' || this.policy.members[m.from]) && this.policy.members[m.to])
      .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
  }

  /** @param {string} id */
  get(id) {
    const m = this.all().find((x) => x.id === id || x.id.endsWith(id));
    if (!m) throw new SaidsoError(`No message "${id}".`);
    return m;
  }

  /** @param {Message} m @param {Message[]} [all] @returns {Status} */
  status(m, all = this.all()) {
    if (m.kind !== 'ask') return 'delivered';
    // Never trust what a message file says about itself: judge it again by the current agreement.
    const now = evaluate(this.policy, m.from, m.to, m.action);
    if (m.verdict === 'blocked' || now.verdict === 'blocked') return 'blocked';
    if (now.verdict === 'deliver') return 'delivered';
    const d = all.find((x) => x.kind === 'decision' && x.re === m.id && x.from !== m.from && now.okFrom.includes(x.from));
    if (!d) return 'waiting-for-ok';
    return d.decision === 'approved' ? 'approved' : 'denied';
  }

  /** Who may answer this request, by the current agreement. @param {Message} m */
  okFrom(m) {
    const now = evaluate(this.policy, m.from, m.to, m.action);
    return now.verdict === 'needs-ok' ? now.okFrom.filter((x) => x !== m.from) : [];
  }

  /**
   * An agent sends a message. The agreement decides what happens; people are told in plain words
   * whenever something waits for them or was stopped.
   * @param {{ to: string, body: string, action?: string, re?: string }} input
   */
  send({ to, body, action, re }) {
    this.pull();
    this.#guard();
    const from = this.me();
    if (!body?.trim()) throw new SaidsoError('The message is empty.');
    const d = evaluate(this.policy, from, to, action);
    const parent = re ? this.get(re) : undefined;
    const msg = this.#make({
      from, to, kind: d.kind, action, re: parent?.id, thread: parent?.thread,
      verdict: d.verdict, reason: d.reason, ok_from: d.okFrom.length ? d.okFrom : undefined, body,
    });
    /** @type {Message[]} */
    const written = [msg];
    if (d.verdict === 'needs-ok') {
      for (const who of d.okFrom) written.push(this.#notice(who, msg, notice.needsOk(this.policy, msg, who)));
    }
    if (d.verdict === 'blocked' && this.policy.members[to]) {
      written.push(this.#notice(to, msg, notice.blockedForReceiver(this.policy, msg)));
      written.push(this.#notice(from, msg, notice.blockedForSender(this.policy, msg)));
    }
    this.#commit(written, `${from} -> ${to}: ${action ?? 'info'} (${d.verdict})`);
    return { message: msg, decision: d, notices: written.slice(1) };
  }

  /**
   * A person answers a request that waits for them. Only for people: the CLI asks them to confirm
   * at a real terminal, and the MCP server does not offer this at all.
   * @param {string} id @param {'approved' | 'denied'} decision @param {string} [note]
   */
  decide(id, decision, note) {
    this.pull();
    this.#guard();
    const me = this.me();
    const all = this.all();
    const ask = this.get(id);
    const okFrom = this.okFrom(ask);
    if (ask.kind !== 'ask' || !okFrom.length) throw new SaidsoError('That message does not wait for anyone\'s OK.');
    if (!okFrom.includes(me)) throw new SaidsoError(`This waits for ${okFrom.map((x) => displayName(this.policy, x)).join(' or ')}, not for you.`);
    const current = this.status(ask, all);
    if (current !== 'waiting-for-ok') throw new SaidsoError(`Already ${current}.`);
    const d = this.#make({
      from: me, to: ask.from, kind: 'decision', action: ask.action, re: ask.id, thread: ask.thread, decision, for: 'person',
      body: note?.trim() || (decision === 'approved' ? 'Yes.' : 'No.'),
    });
    const told = this.#notice(ask.from, ask, notice.decided(this.policy, ask, d));
    this.#commit([d, told], `${me} ${decision} ${ask.id}`);
    return d;
  }

  /**
   * May my agent go ahead with this action now? Use before doing anything that leaves the room.
   * @param {string} action @param {{ ref?: string, with?: string }} [opts]
   */
  check(action, opts = {}) {
    this.pull();
    this.#guard();
    const me = this.me();
    const a = this.policy.actions[action];
    if (!a) return { ok: false, reason: `"${action}" is not in the agreement.` };
    if (!a.by.includes('anyone') && !a.by.includes(this.policy.members[me].role)) {
      return { ok: false, reason: `Your role (${this.policy.members[me].role}) may not start "${action}".` };
    }
    if (!a.ok) return { ok: true, reason: `Agreed: a ${this.policy.members[me].role}'s agent may "${a.say}" without asking.` };
    const all = this.all();
    const candidates = all.filter((m) => m.kind === 'ask' && m.from === me && m.action === action && (!opts.ref || m.id === opts.ref || m.id.endsWith(opts.ref)));
    const approved = candidates.reverse().find((m) => this.status(m, all) === 'approved');
    if (approved) {
      const used = all.some((m) => m.kind === 'notice' && m.re === approved.id && m.body.startsWith('Done:'));
      if (!used) return { ok: true, reason: `Approved in ${approved.id}. One use.`, approval: approved.id };
    }
    const okFrom = this.policy.members[a.ok] ? a.ok : `a ${a.ok}`;
    return { ok: false, reason: `"${a.say}" needs an OK from ${okFrom}. Ask with: saidso send <member> --action ${action} "why"` };
  }

  /** Record that an approved action was carried out, so one OK is used once. @param {string} id @param {string} what */
  done(id, what) {
    this.pull();
    this.#guard();
    const me = this.me();
    const ask = this.get(id);
    if (ask.from !== me) throw new SaidsoError('You can only report on your own requests.');
    if (this.status(ask) !== 'approved') throw new SaidsoError('That request is not approved.');
    const msgs = this.okFrom(ask).map((who) => this.#notice(who, ask, `Done: ${displayName(this.policy, me)}'s agent did what you approved (${ask.action}). ${what}`.trim()));
    this.#commit(msgs, `${me} done ${ask.id}`);
  }

  /** Messages for me that I have not seen. @param {{ all?: boolean, markSeen?: boolean }} [opts] */
  inbox(opts = {}) {
    this.pull();
    this.#guard();
    const me = this.me();
    const seen = new Set(readSeen(this.dir));
    const mine = this.all().filter((m) => m.to === me && (opts.all || !seen.has(m.id)));
    if (opts.markSeen !== false) writeSeen(this.dir, [...seen, ...mine.map((m) => m.id)]);
    return mine;
  }

  /** Requests that wait for my OK. */
  pending() {
    this.pull();
    const me = this.me();
    const all = this.all();
    return all.filter((m) => m.kind === 'ask' && this.okFrom(m).includes(me) && this.status(m, all) === 'waiting-for-ok');
  }

  /** @param {string} id */
  thread(id) {
    const t = this.get(id).thread;
    return this.all().filter((m) => m.thread === t);
  }

  /**
   * @param {Omit<Message, 'id' | 'at' | 'thread'> & { thread?: string }} fields
   * @returns {Message}
   */
  #make(fields) {
    const at = new Date().toISOString();
    const id = `${at.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${fields.from}-${randomBytes(2).toString('hex')}`;
    return /** @type {Message} */ (clean({ id, at, ...fields, thread: fields.thread ?? id }));
  }

  /** @param {string} to @param {Message} about @param {string} text */
  #notice(to, about, text) {
    return this.#make({ from: 'saidso', to, kind: 'notice', action: about.action, re: about.id, thread: about.thread, for: 'person', body: text });
  }

  /** @param {Message[]} msgs @param {string} summary */
  #commit(msgs, summary) {
    const dir = join(this.dir, MESSAGES);
    mkdirSync(dir, { recursive: true });
    const files = msgs.map((m) => {
      const file = join(MESSAGES, `${m.id}.md`);
      writeFileSync(join(this.dir, file), formatMessage(m), { flag: 'wx' });
      return file;
    });
    if (!this.sync) return;
    git(this.dir, ['add', '--', ...files]);
    git(this.dir, ['commit', '--quiet', '-m', `saidso: ${summary}`]);
    if (!hasRemote(this.dir)) return;
    for (let i = 0; i < 3; i++) {
      try { git(this.dir, ['push', '--quiet']); return; } catch {
        git(this.dir, ['pull', '--rebase', '--quiet']);
      }
    }
    throw new SaidsoError('Could not push to the shared repo. The message is saved here and will go out on the next send.');
  }
}

/** @param {Message} m */
export function formatMessage(m) {
  const { body, ...head } = m;
  return `---\n${YAML.stringify(head).trimEnd()}\n---\n\n${body.trim()}\n`;
}

/** @param {string} text @returns {Message} */
export function parseMessage(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new SaidsoError('A message file is not in saidso format.');
  return { ...YAML.parse(match[1]), body: match[2].trim() };
}

/**
 * Start a room in `dir`.
 * @param {string} dir @param {string} policyText @param {string} me
 */
export function initRoom(dir, policyText, me) {
  mkdirSync(join(dir, MESSAGES), { recursive: true });
  if (existsSync(join(dir, POLICY_FILE))) throw new SaidsoError(`${POLICY_FILE} already exists here.`);
  writeFileSync(join(dir, POLICY_FILE), policyText);
  writeFileSync(join(dir, MESSAGES, '.gitkeep'), '');
  appendFileSync(join(dir, '.gitignore'), `${LOCAL}/\n`);
  const room = new Room(dir, { sync: false });
  room.setMe(me);
  if (isGitRepo(dir)) {
    git(dir, ['add', POLICY_FILE, '.gitignore', join(MESSAGES, '.gitkeep')]);
    git(dir, ['commit', '--quiet', '-m', 'saidso: start the room']);
  }
  return room;
}

/** Where `saidso join` puts rooms. */
export function roomsHome() {
  return process.env.SAIDSO_HOME ?? join(homedir(), '.saidso', 'rooms');
}

// ---- small helpers -------------------------------------------------------

/** @param {string} dir @param {string[]} args */
export function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}
/** @param {string} dir */
function isGitRepo(dir) {
  try { return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { return false; }
}
/** @param {string} dir */
function hasRemote(dir) {
  try { return git(dir, ['remote']).trim().length > 0; } catch { return false; }
}
/** @param {string} dir @param {string} name */
function readLocal(dir, name) {
  const f = join(dir, LOCAL, name);
  return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
}
/** @param {string} dir @param {string} name @param {string} text */
function writeLocal(dir, name, text) {
  mkdirSync(join(dir, LOCAL), { recursive: true });
  writeFileSync(join(dir, LOCAL, name), text);
}
/** @param {string} dir @returns {string[]} */
function readSeen(dir) {
  try { return JSON.parse(readLocal(dir, 'seen.json') ?? '[]'); } catch { return []; }
}
/** @param {string} dir @param {string[]} ids */
function writeSeen(dir, ids) {
  writeLocal(dir, 'seen.json', JSON.stringify([...new Set(ids)]));
}
/** @param {Record<string, unknown>} o */
function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
