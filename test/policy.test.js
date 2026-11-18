import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicy, evaluate, SaidsoError } from '../src/policy.js';
import { AGREEMENT } from './helpers.js';

const p = parsePolicy(AGREEMENT);

test('information with no action is always delivered', () => {
  const d = evaluate(p, 'dana', 'maya');
  assert.equal(d.verdict, 'deliver');
  assert.equal(d.kind, 'info');
});

test('an agreed action is delivered', () => {
  assert.equal(evaluate(p, 'maya', 'dana', 'content-change').verdict, 'deliver');
  assert.equal(evaluate(p, 'dana', 'maya', 'question').verdict, 'deliver');
});

test('an action that needs an OK names who must give it', () => {
  const d = evaluate(p, 'dana', 'maya', 'deploy-production');
  assert.equal(d.verdict, 'needs-ok');
  assert.deepEqual(d.okFrom, ['maya']);
});

test('an action outside the role is blocked, with a reason a person can read', () => {
  const d = evaluate(p, 'dana', 'maya', 'content-change');
  assert.equal(d.verdict, 'blocked');
  assert.match(d.reason, /developer's agent may not start "content-change"/);
});

test('an action nobody agreed to is blocked', () => {
  const d = evaluate(p, 'dana', 'maya', 'send-newsletter');
  assert.equal(d.verdict, 'blocked');
  assert.match(d.reason, /not in the agreement/);
});

test('"to" limits whom an action may be asked of', () => {
  const two = parsePolicy(AGREEMENT.replace('members:', 'members:\n  avi: { role: client, name: Avi }'));
  assert.equal(evaluate(two, 'maya', 'avi', 'content-change').verdict, 'blocked');
});

test('strangers are blocked', () => {
  assert.equal(evaluate(p, 'mallory', 'maya').verdict, 'blocked');
  assert.equal(evaluate(p, 'dana', 'mallory').verdict, 'blocked');
});

test('an OK can come from a named member instead of a role', () => {
  const q = parsePolicy(AGREEMENT.replace('ok: client', 'ok: maya'));
  assert.deepEqual(evaluate(q, 'dana', 'maya', 'deploy-production').okFrom, ['maya']);
});

test('a broken agreement explains every problem at once', () => {
  assert.throws(
    () => parsePolicy('room: x\nmembers:\n  Bad Name: { role: dev }\nactions:\n  a: { by: ghost }\n'),
    (/** @type {Error} */ e) => e instanceof SaidsoError && /lowercase/.test(e.message) && /"say"/.test(e.message) && /role "ghost"/.test(e.message),
  );
});

test('a change in meaning cannot hide in a moved line', async () => {
  const { describeChange } = await import('../src/policy.js');
  // Same lines, rearranged: "ok: client" moves from deploy-production to deploy-staging.
  const before = 'room: r\nmembers:\n  d: { role: developer }\n  c: { role: client }\nactions:\n  deploy-staging:\n    say: test site\n    by: developer\n  deploy-production:\n    say: live site\n    by: developer\n    ok: client\n';
  const after = 'room: r\nmembers:\n  d: { role: developer }\n  c: { role: client }\nactions:\n  deploy-staging:\n    say: test site\n    by: developer\n    ok: client\n  deploy-production:\n    say: live site\n    by: developer\n';
  const lines = describeChange(before, after);
  assert.ok(lines.some((l) => /deploy-production changed: .*needs OK from client -> .*no OK needed/.test(l)), lines.join('\n'));
  assert.deepEqual(describeChange(before, before + '# a comment\n'), ['No change in meaning (only comments or formatting).']);
});
