// Optional notifications: push the notices that wait for a person out to a channel they already read.
// Channels come from environment variables only, so secrets never sit in the room repo.
// A notification never carries a way to approve: answering stays at a real terminal.
import { spawnSync } from 'node:child_process';
import { SaidsoError, displayName } from './policy.js';

/** @typedef {import('./room.js').Room} Room @typedef {import('./room.js').Message} Message */
/** @typedef {{ name: string, send: (text: string) => Promise<void> }} Channel */

export const HINT = 'To answer, run "saidso pending" in a terminal.';

/**
 * Plain text for one event, built here from verified fields only: the room, who asked whom, the action's
 * wording in the current agreement, and the state. The text of the messages themselves is never forwarded,
 * so another member's words can not reach a person's phone as if saidso said them.
 * @param {Room} room @param {{ kind: 'waiting' | 'stopped' | 'decided', ask: Message, decision?: Message, reason?: string }} e
 */
export function textFor(room, e) {
  const p = room.policy;
  const name = (/** @type {string} */ id) => displayName(p, id);
  const act = e.ask.action && p.actions[e.ask.action] ? p.actions[e.ask.action].say : 'do something the agreement does not mention';
  const head = `[${p.room}]`;
  if (e.kind === 'waiting') return `${head}\n${name(e.ask.from)}'s agent wants to ${act}. Your agreement says this needs your OK, so nothing happens until you answer.\n\n${HINT}`;
  if (e.kind === 'stopped') return `${head}\n${name(e.ask.from)}'s agent tried to ${act} with ${name(e.ask.to)}. It was stopped, because ${e.reason}. Nothing happened.`;
  const yes = e.decision?.decision === 'approved';
  return `${head}\n${name(e.decision?.from ?? '')} said ${yes ? 'yes' : 'no'}: your agent ${yes ? 'may now' : 'may not'} ${act}.`;
}

/** Which channels are configured. @param {NodeJS.ProcessEnv} [env] @returns {Channel[]} */
export function channels(env = process.env) {
  /** @type {Channel[]} */
  const list = [];
  const token = env.SAIDSO_TELEGRAM_TOKEN;
  const chat = env.SAIDSO_TELEGRAM_CHAT;
  if (token && chat) {
    list.push({
      name: 'telegram',
      send: (text) => post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text }, token),
    });
  }
  const hook = env.SAIDSO_NOTIFY_WEBHOOK;
  if (hook) list.push({ name: 'webhook', send: (text) => post(hook, { text }, hook) });
  const cmd = env.SAIDSO_NOTIFY_CMD;
  if (cmd) {
    list.push({
      name: 'command',
      send: async (text) => {
        const r = spawnSync(cmd, { shell: true, input: text, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });
        if (r.error || r.status !== 0) throw new Error(`command exited with ${r.status ?? 'an error'}`);
      },
    });
  }
  return list;
}

/** @param {string} url @param {unknown} json @param {string} secret */
async function post(url, json, secret) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // Never let a secret (a token in the URL) reach the output.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.split(secret).join('***'));
  }
}

/**
 * One round: pull, find new notices for me, send each one, remember only what really went out.
 * @param {Room} room
 * @param {{ dryRun?: boolean, env?: NodeJS.ProcessEnv, log?: (s: string) => void }} [opts]
 */
export async function notifyOnce(room, opts = {}) {
  const log = opts.log ?? (() => {});
  const list = channels(opts.env);
  if (!list.length && !opts.dryRun) {
    throw new SaidsoError('No channel is set. Set SAIDSO_TELEGRAM_TOKEN + SAIDSO_TELEGRAM_CHAT, or SAIDSO_NOTIFY_WEBHOOK, or SAIDSO_NOTIFY_CMD. See the README, "Notifications".');
  }
  const fresh = room.unnotified();
  let sent = 0, failed = 0;
  for (const m of fresh) {
    const text = textFor(room, m);
    if (opts.dryRun) { log(`--- would send (${m.key})\n${text}\n`); continue; }
    try {
      for (const ch of list) await ch.send(text);
      room.markNotified([m.key]);
      sent++;
    } catch (e) {
      failed++;
      log(`could not send ${m.key}: ${e instanceof Error ? e.message : e}. It will be tried again next time.`);
    }
  }
  return { found: fresh.length, sent, failed };
}
