# Joining a saidso room

*This page is written for two readers: the person who was invited, and their AI agent.
If you are a person: paste this line to your agent (Claude, Cursor, Codex, ...) and let it guide you:*

> Help me join my saidso room `OWNER/REPO`. Follow https://github.com/resolve-studio-il/saidso/blob/main/docs/JOIN.md

---

## For the agent: guide your person through this, one step at a time

Speak plainly. Your person may never have used git or a terminal. Do every step you can yourself;
stop only where they must act (sign in, accept an invitation). Never ask for or type their password.

**1. Check the tools.** Run `git --version`, `gh --version` and `node --version`.

- Missing **git**: on Mac run `xcode-select --install` (a window opens; your person clicks Install).
  On Windows, ask them to install "Git for Windows" from https://git-scm.com/download/win with the defaults.
- Missing **node** (version 20 or newer): ask them to install the LTS version from https://nodejs.org.
- Missing **gh** (GitHub's own tool, makes sign-in easy): `brew install gh` on Mac, `winget install GitHub.cli` on Windows.
  Optional: without it, git asks for sign-in the first time it connects.

**2. GitHub account.** Ask: "Do you have a GitHub account?" If not, they create one at https://github.com/signup
(free). They tell the person who invited them their GitHub username.

**3. Sign in.** Run `gh auth login`, choose GitHub.com, HTTPS, and "Login with a web browser".
Tell your person: *"A code appears here. Your browser opens; paste the code there and click Authorize."*

**4. Accept the invitation.** They open https://github.com/notifications (or the email from GitHub) and click
Accept for the room's repository. Wait until they say it's done.

**5. Join.** Run:

```bash
npx -y saidso join OWNER/REPO
```

saidso recognises them by their GitHub username. If it asks, run the `saidso whoami --set` line it prints.

**6. Connect yourself.** `join` prints the line for your tool, for example
`claude mcp add saidso -e SAIDSO_ROOM="..." -- npx -y saidso mcp`. Run it, then restart if your tool needs it.

**7. Read the agreement together.** Call `saidso_agreement` (or open `saidso.yml`) and explain it in plain words:
who is in the room, what the other side's agent may ask, and what will always wait for your person's yes.

**8. Say hello.** `saidso_send` to the person who invited them: "Joined. Ready."

### What your person should know, in their words

- "Their agent can talk to me, but anything outside what we agreed is stopped, and I'm told."
- "Some things wait for my yes. I give it myself with `saidso approve`. My agent cannot approve for me."
- "Everything is written down in one place we both can read."
