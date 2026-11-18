// The agreement: who is in the room, what each role's agent may start,
// and which actions need a person's OK first. Lives in saidso.yml.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export const POLICY_FILE = 'saidso.yml';

/**
 * @typedef {{ role: string, name?: string, github?: string }} Member
 * @typedef {{ say: string, by: string[], ok?: string, to?: string[] }} Action
 * @typedef {{ room: string, members: Record<string, Member>, actions: Record<string, Action> }} Policy
 * @typedef {{
 *   verdict: 'deliver' | 'needs-ok' | 'blocked',
 *   kind: 'info' | 'ask',
 *   reason: string,
 *   okFrom: string[],
 * }} Decision
 */

/** @param {string} dir */
export function loadPolicy(dir) {
  const file = join(dir, POLICY_FILE);
  if (!existsSync(file)) {
    throw new SaidsoError(`No ${POLICY_FILE} in ${dir}. Run "saidso init" to start a room, or "saidso join" to join one.`);
  }
  return parsePolicy(readFileSync(file, 'utf8'));
}

/** @param {string} text @returns {Policy} */
export function parsePolicy(text) {
  const raw = YAML.parse(text) ?? {};
  const problems = [];
  if (!raw.room || typeof raw.room !== 'string') problems.push('"room" must be a name');
  if (!raw.members || typeof raw.members !== 'object') problems.push('"members" is missing');
  if (!raw.actions || typeof raw.actions !== 'object') problems.push('"actions" is missing');
  if (problems.length) throw new SaidsoError(`${POLICY_FILE} is not valid: ${problems.join('; ')}`);

  /** @type {Record<string, Member>} */
  const members = {};
  for (const [id, m] of Object.entries(raw.members)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`member "${id}": use lowercase letters, digits and dashes`);
    if (!m || typeof m.role !== 'string') problems.push(`member "${id}" needs a role`);
    else members[id] = { role: m.role, name: m.name, github: m.github };
  }
  const roles = new Set(Object.values(members).map((m) => m.role));

  /** @type {Record<string, Action>} */
  const actions = {};
  for (const [id, a] of Object.entries(raw.actions)) {
    if (!a || typeof a !== 'object') { problems.push(`action "${id}" is empty`); continue; }
    const by = toList(a.by);
    const to = a.to === undefined ? undefined : toList(a.to);
    if (!by.length) problems.push(`action "${id}" needs "by" (which roles may start it)`);
    if (typeof a.say !== 'string' || !a.say.trim()) problems.push(`action "${id}" needs "say": a plain sentence a person understands`);
    for (const r of [...by, ...(to ?? [])]) {
      if (r !== 'anyone' && !roles.has(r)) problems.push(`action "${id}" mentions role "${r}", but no member has it`);
    }
    if (a.ok !== undefined && typeof a.ok !== 'string') problems.push(`action "${id}": "ok" is one role or one member`);
    if (typeof a.ok === 'string' && !roles.has(a.ok) && !members[a.ok]) problems.push(`action "${id}": "ok" names "${a.ok}", which is neither a role nor a member`);
    actions[id] = { say: a.say, by, ok: a.ok, to };
  }
  if (problems.length) throw new SaidsoError(`${POLICY_FILE} is not valid:\n  - ${problems.join('\n  - ')}`);
  return { room: raw.room, members, actions };
}

/**
 * Decide what happens when `from`'s agent sends `to` a message, optionally naming an action.
 * Pure: no I/O. This is the heart of saidso.
 * @param {Policy} policy @param {string} from @param {string} to @param {string} [action]
 * @returns {Decision}
 */
export function evaluate(policy, from, to, action) {
  const sender = policy.members[from];
  const receiver = policy.members[to];
  if (!sender) return blocked(`"${from}" is not a member of this room`);
  if (!receiver) return blocked(`"${to}" is not a member of this room`);
  if (!action) return { verdict: 'deliver', kind: 'info', reason: 'Information only. It asks for nothing.', okFrom: [] };

  const a = policy.actions[action];
  if (!a) return blocked(`"${action}" is not in the agreement, so no one agreed to it`);
  if (!allows(a.by, sender.role)) return blocked(`a ${sender.role}'s agent may not start "${action}"; the agreement allows it for ${a.by.join(', ')}`);
  if (a.to && !allows(a.to, receiver.role)) return blocked(`"${action}" may only be asked of ${a.to.join(', ')}, and ${to} is a ${receiver.role}`);

  if (a.ok) {
    const okFrom = policy.members[a.ok] ? [a.ok] : Object.keys(policy.members).filter((id) => policy.members[id].role === a.ok);
    return { verdict: 'needs-ok', kind: 'ask', reason: `the agreement says "${action}" needs an OK from ${a.ok}`, okFrom };
  }
  return { verdict: 'deliver', kind: 'ask', reason: `the agreement allows a ${sender.role}'s agent to start "${action}"`, okFrom: [] };
}

/** @param {string} reason @returns {Decision} */
function blocked(reason) {
  return { verdict: 'blocked', kind: 'ask', reason, okFrom: [] };
}

/** @param {string[]} list @param {string} role */
function allows(list, role) {
  return list.includes('anyone') || list.includes(role);
}

/** @param {unknown} v @returns {string[]} */
function toList(v) {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map(String);
}

/** @param {Policy} policy @param {string} id */
export function displayName(policy, id) {
  return policy.members[id]?.name ?? id;
}

export class SaidsoError extends Error {}

export const STARTER_POLICY = (/** @type {{room: string, me: string, role: string, name?: string}} */ o) => `# saidso.yml - the agreement for this room.
# Everyone in the room can read it. Change it only together: every change is a commit everyone sees.
#
# members: the people in the room. Each person's agent acts in their name.
# actions: what an agent may start. "by" = which roles may start it.
#          "ok" = a role or member who must say yes first. "say" = how a person would say it.
# Anything not listed here is not agreed, so it is blocked and the people involved are told.

room: ${o.room}

members:
  ${o.me}:
    role: ${o.role}
    name: ${o.name ?? o.me}
  # client:
  #   role: client
  #   name: Your client

actions:
  question:
    say: ask a question
    by: anyone
  share-update:
    say: share a progress update
    by: anyone
`;
