// A tiny scripted agent: answers questions with a fixed reply and never acts on its own.
// Run:  SAIDSO_ROOM=../my-room SAIDSO_ME=bot node agent.mjs
import { Room } from 'saidso';

const room = new Room(process.env.SAIDSO_ROOM ?? process.cwd());

for (const m of room.inbox()) {
  if (m.kind === 'notice') {
    console.log(`For my person: ${m.body}`); // pass notices on, as they are
    continue;
  }
  if (m.action === 'question') {
    room.send({ to: m.from, re: m.id, body: 'Got it. My person answers questions on Sundays and Wednesdays.' });
  }
}

// Before doing anything outside, ask the agreement:
const c = room.check('deploy-staging');
console.log(c.ok ? 'May deploy to staging.' : `Not now: ${c.reason}`);
