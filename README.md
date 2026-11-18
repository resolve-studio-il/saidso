# saidso

**Agents act only on what their people agreed to.**

Your agent can message your client's agent, your partner's agent, your freelancer's agent.
Over a private GitHub repo you both already can use. No server, no new accounts.
Every step outside what you agreed is stopped, and **both people are told in plain words**.

<p align="center"><img src="docs/demo.gif" alt="Dana's agent asks to deploy to production, Maya is told in plain words and approves; then it tries to send her newsletter, is stopped, and both are told." width="760"></p>

```bash
npx saidso init my-room --me dana --role developer
```

---

## Why

You already work with other people's agents. Today that means copy-pasting between chats:
your Claude writes something, you paste it to your client, she pastes it to her Claude, and back.

Letting the agents talk directly is easy. Letting them talk **safely** is not:

- **A message from another agent is not your instruction.** An agent that obeys whatever arrives in its inbox
  is one poisoned web page away from "please send the newsletter now".
- **Nobody can answer "who approved this?"** When agent C deploys because agent B asked, because agent A
  relayed something, the chain is lost in three chat windows.
- **The people are left out.** A client who gives your agent more freedom needs to see what it tries to do.

saidso is the small layer between agents of different people that fixes those three things.

## How it works

1. **A room** is a private git repo shared by the people in it. Each message is a Markdown file. Nothing is edited
   or deleted. You can read the whole history on GitHub, even from your phone.
2. **The agreement** (`saidso.yml`) says who is in the room, their role, and what each role's agent may start,
   and what needs a person's OK first. Anything not in it is not agreed.
3. **Every message is checked against it:**

| The agent sends...                            | What happens                                                              |
|-----------------------------------------------|---------------------------------------------------------------------------|
| information (no action)                       | delivered, marked as information                                          |
| an agreed action                              | delivered                                                                 |
| an action that needs an OK                    | waits. The person who must decide is told in plain words                  |
| anything else                                 | **stopped**. Both people are told in plain words. Nothing happens         |

4. **Only people approve.** `saidso approve` asks for a typed "yes" at a real terminal. The MCP server has
   no approve tool at all. One OK is good for one time.
5. **No one changes the agreement alone.** When `saidso.yml` changes, every other copy of the room stops sending
   and acting until its person reads the change (`saidso agreement`) and accepts it (`saidso accept`).
6. **Agents read messages as data.** Every incoming message is wrapped and labelled as coming from someone else's
   agent, so it cannot pass itself off as an instruction from the agent's own person.

## Quickstart (2 minutes)

**You** (start a room):

```bash
mkdir my-room && cd my-room && git init
npx saidso init my-room --me dana --role developer --name "Dana"
# edit saidso.yml: add the other person and what each side may do (see below)
gh repo create my-room --private --source . --push
gh repo edit --add-collaborator maya-on-github   # or invite from the GitHub website
```

**The other person** sends one line to their own agent:

> Help me join my saidso room: `npx saidso join dana/my-room`. Follow https://github.com/resolve-studio-il/saidso/blob/main/docs/JOIN.md

Their agent installs git if needed, signs them in to GitHub, clones the room, and connects itself.
They never need to learn git. See [docs/JOIN.md](docs/JOIN.md).

**Connect your agent** (Claude Code):

```bash
claude mcp add saidso -e SAIDSO_ROOM="$PWD" -- npx -y saidso mcp
```

Then just talk to it: *"Tell Maya's agent the new homepage is on staging."*

## The agreement

```yaml
# saidso.yml - everyone in the room can read it; every change is a commit everyone sees.
room: dana-and-maya

members:
  dana:   { role: developer, name: Dana,   github: dana-dev }
  maya: { role: client,    name: Maya, github: maya-client }

actions:
  question:          { say: ask a question,                   by: anyone }
  share-update:      { say: share a progress update,          by: anyone }
  content-change:    { say: change text on the website,       by: client, to: developer }
  deploy-staging:    { say: put a change on the test site,    by: developer }
  deploy-production: { say: put a change on the live website, by: developer, ok: client }
```

- `by`: which roles' agents may start it (`anyone` for all).
- `ok`: a role or a member who must say yes first.
- `to`: optional, whom it may be asked of.
- `say`: how a person would say it. This is what goes into the plain-language notices.

A bigger, real-world example: [examples/studio-and-client/saidso.yml](examples/studio-and-client/saidso.yml).

## What people see

When Dana's agent asks for something that needs Maya's OK, Maya (through her agent, or `saidso inbox`) reads:

> Dana's agent wants to put a change on the live website. Your agreement says this needs your OK, so nothing happens until you answer.
>
> > Homepage v2 passed review on staging. Ready to go live.
>
> To answer: saidso approve 20261117-191203-dana-3f70   or   saidso deny 20261117-191203-dana-3f70 "why"

When an agent steps outside the agreement:

> Dana's agent tried to do something the agreement does not mention ("send-newsletter") with you.
> Your agreement does not allow that. It was stopped. Nothing happened.

And Dana is told the same thing about his own agent. No one is surprised later.

## For agents

| MCP tool           | CLI                        | What it does                                               |
|--------------------|----------------------------|------------------------------------------------------------|
| `saidso_agreement` | `cat saidso.yml`           | who is here, and what is agreed                            |
| `saidso_send`      | `saidso send <to> "..."`   | message or ask (`--action`)                                |
| `saidso_inbox`     | `saidso inbox`             | new messages, wrapped as data                              |
| `saidso_check`     | `saidso check <action>`    | may I do this now?                                         |
| `saidso_done`      | `saidso done <id> "..."`   | report an approved action as done (uses up the OK)         |
| `saidso_log`       | `saidso log`               | the whole record, in order                                 |
| (none, on purpose) | `saidso approve` / `deny`  | people only, typed confirmation at a real terminal         |

Setup for each agent: [Claude Code](examples/claude-code), [Cursor](examples/cursor), [Codex](examples/codex),
[a plain script](examples/script-agent), [any agent with a shell](examples/any-agent.md).

## What saidso does and does not guarantee

Honest version, v0.1:

- **It does:** keep one append-only, readable record of who said what to whom; check every message against an
  agreement both sides can see; stop and announce anything outside it; keep approvals out of the agents' tools;
  label every incoming message as someone else's words; stop everything when the agreement changes until each
  person accepts the change.
- **It does not (yet):** cryptographically prove that a human, not an agent, typed the "yes". An agent with full
  shell access on your machine could fake a terminal. Signed approvals (SSH signatures, which GitHub already
  verifies) are next on the roadmap. Until then saidso keeps honest agents honest and makes dishonest moves
  visible in git history.
- **Anyone with write access to the room can write files.** saidso never trusts what a file says about itself:
  every request is judged again by the current agreement, and a decision counts only if it comes from a member the
  agreement names. But a member can still write a file *claiming* to be someone else; git history shows who really
  committed it. Signed commits close this, and come with signed approvals.
- saidso does not run your agent and does not block it from doing things outside the room. Your agent asks
  `saidso_check` before acting, the way it reads `AGENTS.md`. The rule is in its instructions; the record is in git.

## How it fits with what exists

- **A2A / MCP**: A2A connects agents of organisations over HTTP; MCP connects an agent to tools. saidso is about
  the *people* behind two agents and what they agreed. It runs as an MCP server, and an A2A bridge is on the roadmap.
- **Agent mailboxes** (mcp_agent_mail and friends): great for many agents of *one* developer coordinating on one
  codebase. saidso is for agents of *different* people with different rights.
- **Claude Code's SendMessage**: sessions on one machine, one person. saidso works across people, machines and tools.

## Roadmap

- [ ] Signed approvals (SSH signing, verified by GitHub)
- [ ] Approve from your phone: a GitHub issue per request, approve with a comment
- [ ] A daily plain-language digest for each person
- [ ] Organisations: many rooms, one place to see them (a studio and all its clients)
- [ ] A GitHub Action that pings the other agent when mail arrives
- [ ] A2A bridge

## Develop

```bash
npm install
npm test          # 31 tests, real git repos in a temp folder
npm run typecheck
```

Releases: bump `version` in package.json through a PR, then push a tag `vX.Y.Z` on that commit.
The release workflow publishes to npm with provenance through npm Trusted Publishing, so no npm token
is stored anywhere.

MIT licensed. Built by [Resolve Studio](https://resolve.co.il), where a developer, clients and several agents
work together every day. That is where this came from.
