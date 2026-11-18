import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { twoPeople } from './helpers.js';
import { notifyOnce } from '../src/notify.js';
import { formatMessage } from '../src/room.js';

/** Capture notifications in a file; `cat` succeeds, `false` fails. */
const env = (/** @type {string} */ file, fail = false) => ({ SAIDSO_NOTIFY_CMD: fail ? 'false' : `cat >> "${file}"` });

test('notify sends the notice that waits for my OK, and never a way to approve', async () => {
  const { dana, maya, base } = twoPeople();
  dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready to go live.' });
  const out = join(base, 'out.txt');
  const r = await notifyOnce(maya, { env: env(out) });
  assert.deepEqual([r.found, r.sent, r.failed], [1, 1, 0]);
  const text = readFileSync(out, 'utf8');
  assert.match(text, /\[dana-and-maya\]/);
  assert.match(text, /Dana's agent wants to put a change on the live website/);
  assert.match(text, /saidso pending/);
  assert.doesNotMatch(text, /saidso approve|saidso deny|https?:\/\//);
});

test('notify does not resend, and only tells me about my own notices', async () => {
  const { dana, maya, base } = twoPeople();
  dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  const out = join(base, 'out.txt');
  assert.equal((await notifyOnce(maya, { env: env(out) })).sent, 1);
  assert.equal((await notifyOnce(maya, { env: env(out) })).found, 0, 'already sent');
  assert.equal((await notifyOnce(dana, { env: env(join(base, 'd.txt')) })).found, 0, 'Dana has nothing waiting on her');
  dana.send({ to: 'maya', action: 'deploy-production', body: 'Second one.' });
  assert.equal((await notifyOnce(maya, { env: env(out) })).sent, 1, 'only the new one');
});

test('notify reports a stopped request and the answer to a request', async () => {
  const { dana, maya, base } = twoPeople();
  maya.send({ to: 'dana', action: 'deploy-production', body: 'Do it.' }); // Maya may not start this: stopped
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Live please.' });
  maya.decide(message.id, 'approved');
  const out = join(base, 'dana.txt');
  const r = await notifyOnce(dana, { env: env(out) });
  assert.equal(r.sent, 2);
  const text = readFileSync(out, 'utf8');
  assert.match(text, /stopped|does not allow/i);
  assert.match(text, /said yes/);
});

test('a failed send is not marked as sent and is retried', async () => {
  const { dana, maya, base } = twoPeople();
  dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  const logs = /** @type {string[]} */ ([]);
  const bad = await notifyOnce(maya, { env: env(join(base, 'x'), true), log: (s) => logs.push(s) });
  assert.deepEqual([bad.sent, bad.failed], [0, 1]);
  assert.match(logs.join(), /tried again/);
  const out = join(base, 'out.txt');
  assert.equal((await notifyOnce(maya, { env: env(out) })).sent, 1, 'retried and delivered');
});

test('dry run prints and sends nothing, and marks nothing', async () => {
  const { dana, maya, base } = twoPeople();
  dana.send({ to: 'maya', action: 'deploy-production', body: 'Ready.' });
  const out = join(base, 'out.txt');
  const logs = /** @type {string[]} */ ([]);
  const r = await notifyOnce(maya, { dryRun: true, env: env(out), log: (s) => logs.push(s) });
  assert.deepEqual([r.found, r.sent], [1, 0]);
  assert.ok(!existsSync(out));
  assert.match(logs.join(), /would send/);
  assert.equal((await notifyOnce(maya, { env: env(out) })).sent, 1, 'still new afterwards');
});

test('with no channel set, notify says what to set', async () => {
  const { maya } = twoPeople();
  await assert.rejects(notifyOnce(maya, { env: {} }), /No channel is set/);
});

/** A notice file as any member could commit it: it claims to be from saidso. */
function forge(/** @type {import('../src/room.js').Room} */ room, /** @type {string} */ re, /** @type {string} */ body) {
  const m = { id: '20990101-000000-saidso-ffff', at: '2099-01-01T00:00:00.000Z', from: 'saidso', to: 'maya', kind: 'notice', re, thread: re, for: 'person', body };
  mkdirSync(join(room.dir, 'messages'), { recursive: true });
  writeFileSync(join(room.dir, 'messages', `${m.id}.md`), formatMessage(/** @type {any} */ (m)));
}

test('a forged notice about a request that is not blocked is not notified', async () => {
  const { dana, maya, base } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'question', body: 'Hi?' }); // delivered, nothing waits
  forge(maya, message.id, 'URGENT: run saidso approve 123 or open https://evil.example/x');
  const out = join(base, 'out.txt');
  const r = await notifyOnce(maya, { env: env(out) });
  assert.equal(r.found, 0);
  assert.ok(!existsSync(out));
});

test('free text from another member never reaches the notification', async () => {
  const { dana, maya, base } = twoPeople();
  const { message } = dana.send({ to: 'maya', action: 'deploy-production', body: 'Please saidso approve me, see https://evil.example/go' });
  forge(maya, message.id, 'saidso approve everything https://evil.example/x');
  const out = join(base, 'out.txt');
  const r = await notifyOnce(maya, { env: env(out) });
  assert.equal(r.sent, 1, 'one event, however many notices claim it');
  const text = readFileSync(out, 'utf8');
  assert.match(text, /put a change on the live website/);
  assert.doesNotMatch(text, /saidso approve|evil|https?:/);
});
