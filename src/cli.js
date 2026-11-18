import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Room, roomDir, initRoom, roomsHome, git } from './room.js';
import { STARTER_POLICY, SaidsoError, displayName, describeChange } from './policy.js';
import { forPerson, forAgent, AGENT_PREAMBLE, logLine, bold, dim, green, red, yellow, cyan } from './format.js';

const HELP = `${bold('saidso')} - agents act only on what their people agreed to.

${bold('Start or join a room')}
  saidso init <room> --me <id> --role <role> [--name "Your Name"]
  saidso join <owner/repo> [--as <member>]      clone a shared room from GitHub
  saidso whoami [--set <member>]

${bold('For agents')}
  saidso send <member> "text" [--action <name>] [--re <id>]
  saidso inbox [--all] [--for-agent]             new messages for me
  saidso check <action> [--ref <id>]             may my agent do this now?
  saidso done <id> "what was done"               use up an approved request
  saidso mcp                                     run as an MCP server (stdio)

${bold('For people')}
  saidso pending                                 requests that wait for my OK
  saidso approve <id|n> ["note"]                 say yes (n = number from "pending")
  saidso deny <id> ["why"]
  saidso log                                     everything, in order: who said what to whom
  saidso agreement                               the agreement, and what changed since you accepted it
  saidso accept                                  accept a changed agreement (asks you to confirm)
  saidso thread <id>

Room folder: --room <dir>, or SAIDSO_ROOM, or the current folder.
`;

/** @param {string[]} argv */
export async function main(argv) {
  const { _, flags } = parseArgs(argv);
  const [cmd, ...args] = _;
  const dir = roomDir(str(flags.room));
  if (flags.help) { process.stdout.write(HELP); return 0; }
  if (flags.version) { console.log('0.1.0'); return 0; }
  try {
    switch (cmd) {
      case undefined: case 'help': case '--help': case '-h':
        process.stdout.write(HELP); return 0;
      case '--version': case 'version':
        console.log('0.1.0'); return 0;
      case 'init': return init(dir, args, flags);
      case 'join': return join_(args, flags);
      case 'mcp': { const { serve } = await import('./mcp.js'); await serve(dir); return 0; }
    }
    const room = new Room(dir);
    switch (cmd) {
      case 'whoami': {
        if (flags.set) { room.setMe(str(flags.set) ?? ''); }
        const me = room.me();
        console.log(`${bold(displayName(room.policy, me))} (${me}), ${room.policy.members[me].role} in room "${room.policy.room}"`);
        return 0;
      }
      case 'send': {
        const [to, ...rest] = args;
        if (!to || !rest.length) throw new SaidsoError('Usage: saidso send <member> "text" [--action <name>]');
        const { message, decision, notices } = room.send({ to, body: rest.join(' '), action: str(flags.action), re: str(flags.re) });
        const name = displayName(room.policy, to);
        if (decision.verdict === 'deliver') console.log(`${green('sent')} to ${name}. ${dim(decision.reason)}`);
        if (decision.verdict === 'needs-ok') console.log(`${yellow('waiting for an OK')} from ${decision.okFrom.map((x) => displayName(room.policy, x)).join(' or ')}. ${dim('They were told in plain words.')}`);
        if (decision.verdict === 'blocked') console.log(`${red('stopped')}: ${decision.reason}.\n${dim(`Nothing happened. ${name} and you were both told.`)}`);
        console.log(dim(`id ${message.id}${notices.length ? ` · ${notices.length} notice(s)` : ''}`));
        return decision.verdict === 'blocked' ? 2 : 0;
      }
      case 'inbox': {
        const msgs = room.inbox({ all: Boolean(flags.all) });
        const all = room.all();
        if (!msgs.length) { console.log(flags['for-agent'] ? 'saidso: nothing new.' : dim('Nothing new.')); return 0; }
        if (flags['for-agent']) { console.log(`${AGENT_PREAMBLE}\n\n${msgs.map((m) => forAgent(room, m, all)).join('\n\n')}`); return 0; }
        // For a person, a request that waits or was stopped is already explained by its notice. Show the notice.
        const explained = new Set(msgs.filter((m) => m.kind === 'notice' && m.re).map((m) => m.re));
        for (const m of msgs) if (!(m.kind === 'ask' && explained.has(m.id))) console.log(forPerson(room, m, all));
        return 0;
      }
      case 'pending': {
        const list = room.pending();
        const all = room.all();
        if (!list.length) { console.log(dim('Nothing waits for you.')); return 0; }
        list.forEach((m, i) => console.log(`${bold(`${i + 1}.`)} ${forPerson(room, m, all)}${dim(`   saidso approve ${i + 1}  ·  saidso deny ${i + 1} "why"`)}\n`));
        return 0;
      }
      case 'approve': case 'deny': {
        const [id, ...note] = args;
        if (!id) throw new SaidsoError(`Usage: saidso ${cmd} <id> ["note"]`);
        const waiting = room.pending();
        const ask = /^\d{1,3}$/.test(id) && waiting[Number(id) - 1] ? waiting[Number(id) - 1] : room.get(id);
        await confirmPerson(room, ask, cmd);
        room.decide(ask.id, cmd === 'approve' ? 'approved' : 'denied', note.join(' '));
        console.log(cmd === 'approve' ? green('Approved.') : red('Denied.'), dim(`${displayName(room.policy, ask.from)} was told.`));
        return 0;
      }
      case 'check': {
        const [action] = args;
        if (!action) throw new SaidsoError('Usage: saidso check <action> [--ref <id>]');
        const r = room.check(action, { ref: str(flags.ref) });
        console.log(`${r.ok ? green('yes') : red('no')}: ${r.reason}`);
        return r.ok ? 0 : 1;
      }
      case 'done': {
        const [id, ...what] = args;
        if (!id) throw new SaidsoError('Usage: saidso done <id> "what was done"');
        room.done(id, what.join(' '));
        console.log(green('Recorded.'), dim('The person who approved it was told.'));
        return 0;
      }
      case 'agreement': {
        room.pull();
        const c = room.agreementChange();
        if (!c.changed) { console.log(c.current); console.log(dim('This is the agreement your person accepted.')); return 0; }
        showChange(room, c);
        console.log(`\nUntil you accept it, nothing is sent or done from here. To accept: ${bold('saidso accept')}`);
        return 0;
      }
      case 'accept': {
        room.pull();
        const c = room.agreementChange();
        if (!c.changed) { console.log(dim('Nothing to accept.')); return 0; }
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SaidsoError('"accept" is for people, at a real terminal. Run "saidso agreement" to see the change first.');
        showChange(room, c);
        console.log('');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Type "yes" to accept the new agreement: ')).trim().toLowerCase();
        rl.close();
        if (answer !== 'yes') throw new SaidsoError('Not accepted. Nothing changed.');
        room.acceptAgreement(c.current); // exactly what was shown; refuses if the file changed meanwhile
        console.log(green('Accepted.'));
        return 0;
      }
      case 'log': {
        room.pull();
        const all = room.all();
        console.log(dim(`room "${room.policy.room}" · ${all.length} entries\n`));
        for (const m of all) console.log(logLine(room, m, all));
        return 0;
      }
      case 'thread': {
        const [id] = args;
        if (!id) throw new SaidsoError('Usage: saidso thread <id>');
        const all = room.all();
        for (const m of room.thread(id)) console.log(forPerson(room, m, all));
        return 0;
      }
      default:
        throw new SaidsoError(`Unknown command "${cmd}". Run "saidso help".`);
    }
  } catch (e) {
    if (e instanceof SaidsoError) { console.error(red('saidso: ') + e.message); return 1; }
    throw e;
  }
}

/** @param {string} dir @param {string[]} args @param {Flags} flags */
function init(dir, args, flags) {
  const room = args[0] ?? basename(dir);
  const me = str(flags.me);
  const role = str(flags.role);
  if (!me || !role) throw new SaidsoError('Usage: saidso init <room> --me <id> --role <role> [--name "Your Name"]');
  initRoom(dir, STARTER_POLICY({ room, me, role, name: str(flags.name) }), me);
  console.log(`${green('Room started')} in ${dir}.
Next:
  1. Add the other people and what each side may do in ${bold('saidso.yml')}.
  2. Push this folder to a private GitHub repo and invite them.
  3. Send them one line: ${cyan(`"Help me join my saidso room: npx saidso join <owner/repo>"`)}
     Their agent does the rest (see docs/JOIN.md).`);
  return 0;
}

/** @param {string[]} args @param {Flags} flags */
function join_(args, flags) {
  const [repo] = args;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new SaidsoError('Usage: saidso join <owner/repo> [--as <member>]');
  if (!has('git')) {
    throw new SaidsoError(`git is not installed. In plain steps:
  Mac:     open Terminal and run: xcode-select --install
  Windows: download "Git for Windows" from https://git-scm.com/download/win and install with the defaults
  Linux:   sudo apt install git   (or your system's package manager)
Then run this command again.`);
  }
  const dir = join(roomsHome(), repo.replace('/', '__'));
  if (existsSync(join(dir, '.git'))) {
    git(dir, ['pull', '--rebase', '--quiet']);
  } else if (has('gh')) {
    execFileSync('gh', ['repo', 'clone', repo, dir, '--', '--quiet'], { stdio: 'inherit' });
  } else {
    execFileSync('git', ['clone', '--quiet', `https://github.com/${repo}.git`, dir], { stdio: 'inherit' });
  }
  const room = new Room(dir);
  let me = str(flags.as);
  if (!me && has('gh')) {
    try {
      const login = execFileSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8' }).trim();
      me = Object.keys(room.policy.members).find((id) => room.policy.members[id].github?.toLowerCase() === login.toLowerCase());
    } catch { /* not logged in; ask below */ }
  }
  if (me) room.setMe(me);
  console.log(`${green('Joined')} room "${room.policy.room}" in ${dir}${me ? ` as ${bold(me)}` : ''}.`);
  if (!me) console.log(`Tell saidso who you are: saidso whoami --room "${dir}" --set <member>   (members: ${Object.keys(room.policy.members).join(', ')})`);
  console.log(`
Connect your agent:
  Claude Code:  claude mcp add saidso -e SAIDSO_ROOM="${dir}" -- npx -y saidso mcp
  Other agents: any MCP client can run "npx -y saidso mcp" with SAIDSO_ROOM="${dir}"
Read the agreement first: ${join(dir, 'saidso.yml')}`);
  return 0;
}

/** Approvals are for people. Refuse when there is no real terminal (agents run commands without one). */
/** @param {Room} room @param {import('./room.js').Message} ask @param {string} cmd */
async function confirmPerson(room, ask, cmd) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SaidsoError(`"${cmd}" is for people, at a real terminal. An agent cannot ${cmd} for you. Run it yourself.`);
  }
  const a = ask.action ? room.policy.actions[ask.action] : undefined;
  console.log(`\n${bold(displayName(room.policy, ask.from))}'s agent wants to ${bold(a?.say ?? ask.action ?? '?')}:\n\n${ask.body.split('\n').map((l) => '  ' + l).join('\n')}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const word = cmd === 'approve' ? 'yes' : 'no';
  const answer = (await rl.question(`Type "${word}" to ${cmd}: `)).trim().toLowerCase();
  rl.close();
  if (answer !== word) throw new SaidsoError('Not confirmed. Nothing changed.');
}

/** Show what changed, by meaning, then the whole new agreement. @param {Room} room @param {{ first: boolean, accepted?: string, current: string }} c */
function showChange(room, c) {
  if (c.first) console.log(yellow('You have not accepted this room\'s agreement yet.') + '\n');
  else {
    console.log(yellow('The agreement changed since you last accepted it.') + dim(` Last change: ${lastChange(room.dir)}`) + '\n');
    for (const line of describeChange(c.accepted ?? '', c.current)) console.log(`  ${bold('*')} ${line}`);
    console.log('');
  }
  console.log(dim('The whole agreement, as it is now:\n'));
  console.log(c.current);
}

/** @param {string} dir */
function lastChange(dir) {
  try { return git(dir, ['log', '-1', '--format=%an, %ar', '--', 'saidso.yml']).trim(); } catch { return 'unknown'; }
}

/** @param {string} bin */
function has(bin) {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** @typedef {Record<string, string | boolean>} Flags */
/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */ const _ = [];
  /** @type {Flags} */ const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else _.push(a);
  }
  return { _, flags };
}
/** @param {string | boolean | undefined} v */
function str(v) { return typeof v === 'string' ? v : undefined; }
