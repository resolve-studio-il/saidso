// Plain-language notices for people. No jargon, no ids in the first sentence:
// someone who never heard of saidso should understand what happened and what they can do.
import { displayName } from './policy.js';

/** @typedef {import('./policy.js').Policy} Policy @typedef {import('./room.js').Message} Message */

/** @param {Policy} p @param {Message} m */
function what(p, m) {
  const a = m.action ? p.actions[m.action] : undefined;
  if (a) return a.say;
  return m.action ? `do something the agreement does not mention ("${m.action}")` : 'send a message';
}

/** @param {string} body */
function quote(body) {
  const short = body.length > 400 ? body.slice(0, 400) + '...' : body;
  return short.split('\n').map((l) => `> ${l}`).join('\n');
}

/** @param {Policy} p @param {Message} m @param {string} who */
export function needsOk(p, m, who) {
  return [
    `${displayName(p, m.from)}'s agent wants to ${what(p, m)}. Your agreement says this needs your OK, so nothing happens until you answer.`,
    '',
    quote(m.body),
    '',
    `To answer: saidso approve ${m.id}   or   saidso deny ${m.id} "why"`,
    who === m.to ? '' : `(This was sent to ${displayName(p, m.to)}, who can see it too.)`,
  ].filter((l, i, arr) => !(l === '' && i === arr.length - 1)).join('\n');
}

/** @param {Policy} p @param {Message} m */
export function blockedForReceiver(p, m) {
  return [
    `${displayName(p, m.from)}'s agent tried to ${what(p, m)} with you. Your agreement does not allow that (${m.reason}). It was stopped. Nothing happened.`,
    '',
    quote(m.body),
    '',
    `If you want to allow it, change saidso.yml together with ${displayName(p, m.from)}. Every change is visible to everyone in the room.`,
  ].join('\n');
}

/** @param {Policy} p @param {Message} m */
export function blockedForSender(p, m) {
  return [
    `Your agent tried to ${what(p, m)} with ${displayName(p, m.to)}. It was stopped, because ${m.reason}.`,
    `${displayName(p, m.to)} was told about it, in the same words.`,
  ].join('\n');
}

/** @param {Policy} p @param {Message} ask @param {Message} d */
export function decided(p, ask, d) {
  const yes = d.decision === 'approved';
  return [
    `${displayName(p, d.from)} said ${yes ? 'yes' : 'no'}: your agent ${yes ? 'may now' : 'may not'} ${what(p, ask)}.`,
    d.body && d.body !== 'Yes.' && d.body !== 'No.' ? `\n\n${quote(d.body)}` : '',
    yes ? `\n\nThis OK is good for one time. When it is done, record it: saidso done ${ask.id} "what you did"` : '',
  ].join('');
}
