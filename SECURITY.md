# Security

saidso decides what other people's agents may do in your name, so security reports matter to us.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab → Report a vulnerability** on https://github.com/saidso-dev/saidso.

We answer within 3 working days and keep you posted until it is fixed. Credit is yours if you want it.

## In scope

- An agent getting something done that the agreement (`saidso.yml`) did not allow, or did not wait for a person's OK.
- A message that passes itself off as an instruction from the agent's own person, or escapes the `<saidso-message>` wrapper.
- A change to the agreement that takes effect without each person accepting it.
- Anything in the published npm package that does more than the source in this repo.

## Known limits (not vulnerabilities, see the README)

- Approvals are not yet cryptographically signed: an agent with full shell access could fake a terminal.
- A member with write access to the room can write a file that claims another sender. Git history shows the real committer.

## Supported versions

Only the latest release gets fixes while saidso is 0.x.
