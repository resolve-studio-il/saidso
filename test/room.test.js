import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { twoPeople, gitLog } from './helpers.js';
import { parseMessage, formatMessage } from '../src/room.js';

test('information travels from one person\'s agent to the other through the shared repo', () => {
  const { dana, maya } = twoPeople();
  dana.send({ to: 'maya', body: 'The new homepage is on the test site.' });
  const inbox = maya.inbox();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].from, 'dana');
  assert.equal(inbox[0].kind, 'info');
  assert.equal(maya.inbox().length, 0, 'seen messages are not shown twice');
  assert.equal(maya.inbox({ all: true }).length, 1);
});

test('every message is a commit with a readable summary', () => {
  const { dana } = twoPeople();
  dana.send({ to: 'maya', body: 'hi' });
  assert.match(gitLog(dana.dir)[0], /^saidso: dana -> maya: info \(deliver\)$/);
});

test('an action that needs an OK waits, and the person who must decide is told in plain words', () => {
  const { dana, maya } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready to put the new homepage live.' });
  assert.equal(dana.check('deploy-production').ok, false);

  const inbox = maya.inbox();
  const notice = inbox.find((m) => m.kind === 'notice');
  assert.ok(notice, 'Maya gets a notice');
  assert.equal(notice.for, 'person');
  assert.match(notice.body, /^Dana's agent wants to put a change on the live website\. Your agreement says this needs your OK/);
  assert.equal(maya.pending()[0].id, message.id);
});

test('approve -> the agent may act once; done uses up the OK', () => {
  const { dana, maya } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  maya.decide(message.id, 'approved', 'Go ahead, before 18:00.');

  const yes = dana.check('deploy-production');
  assert.equal(yes.ok, true);
  assert.equal(yes.approval, message.id);
  const told = dana.inbox().find((m) => m.kind === 'notice');
  assert.match(told?.body ?? '', /Maya said yes/);
  assert.match(told?.body ?? '', /Go ahead, before 18:00\./);

  dana.done(message.id, 'Homepage v2 is live.');
  assert.equal(dana.check('deploy-production').ok, false, 'one OK, one use');
  assert.match(maya.inbox().at(-1)?.body ?? '', /^Done: Dana's agent did what you approved/);
});

test('deny -> the agent may not act, and is told why', () => {
  const { dana, maya } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  maya.decide(message.id, 'denied', 'Not during the campaign.');
  assert.equal(dana.check('deploy-production').ok, false);
  assert.match(dana.inbox().find((m) => m.kind === 'notice')?.body ?? '', /Maya said no.*\n\n> Not during the campaign\./s);
  assert.equal(dana.status(dana.get(message.id)), 'denied');
});

test('only the person named in the agreement can decide, and only once', () => {
  const { dana, maya } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  assert.throws(() => dana.decide(message.id, 'approved'), /waits for Maya, not for you/);
  maya.decide(message.id, 'approved');
  assert.throws(() => maya.decide(message.id, 'denied'), /Already approved/);
});

test('stepping outside the agreement is stopped, and both people are told in plain words', () => {
  const { dana, maya } = twoPeople();
  const { decision } = dana.send({ to: 'maya', action: 'send-newsletter', body: 'Sending the November issue to your list now.' });
  assert.equal(decision.verdict, 'blocked');

  const forMaya = maya.inbox().find((m) => m.kind === 'notice');
  assert.match(forMaya?.body ?? '', /^Dana's agent tried to do something the agreement does not mention \("send-newsletter"\) with you\. Your agreement does not allow that .* It was stopped\. Nothing happened\./);
  const forDana = dana.inbox().find((m) => m.kind === 'notice');
  assert.match(forDana?.body ?? '', /^Your agent tried to do something the agreement does not mention \("send-newsletter"\) with Maya\. It was stopped/);
  assert.equal(maya.pending().length, 0);
});

test('a client may not approve their own request in place of the developer, and roles cannot be borrowed', () => {
  const { dana, maya } = twoPeople();
  assert.equal(maya.send({ to: 'dana', action: 'deploy-production', body: 'Push it live.' }).decision.verdict, 'blocked');
  assert.equal(dana.send({ to: 'maya', action: 'content-change', body: 'I changed your headline.' }).decision.verdict, 'blocked');
});

test('replies stay in one thread', () => {
  const { dana, maya } = twoPeople();
  const q = dana.send({ to: 'maya', action: 'question', body: 'Which photo for the hero?' }).message;
  maya.pull();
  maya.send({ to: 'dana', body: 'The one from the workshop.', re: q.id });
  dana.pull();
  assert.deepEqual(dana.thread(q.id).map((m) => m.from), ['dana', 'maya']);
});

test('the record is append-only: nothing is edited or deleted', () => {
  const { dana, maya } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  const file = join(dana.dir, 'messages', `${message.id}.md`);
  const before = readFileSync(file, 'utf8');
  maya.decide(message.id, 'approved');
  dana.pull();
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(readdirSync(join(dana.dir, 'messages')).length, 4); // ask, notice, decision, notice
});

test('message files round-trip and stay readable on GitHub', () => {
  const m = /** @type {const} */ ({ id: 'x', at: '2026-11-17T10:00:00.000Z', from: 'dana', to: 'maya', kind: 'info', thread: 'x', body: 'Hello\n\nTwo lines.' });
  const text = formatMessage(m);
  assert.match(text, /^---\nid: x\n/);
  assert.deepEqual(parseMessage(text), m);
});

test('an agent cannot speak as someone who is not in the room', () => {
  const { dana } = twoPeople();
  assert.throws(() => dana.setMe('mallory'), /not a member/);
});
