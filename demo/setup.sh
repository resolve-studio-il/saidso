#!/usr/bin/env bash
# Builds the demo room: a shared repo and two clones (Dana the developer, Maya the client).
set -euo pipefail
D=/tmp/saidso-demo; rm -rf "$D"; mkdir -p "$D"; cd "$D"
git init -q --bare -b main room.git
git clone -q room.git dana 2>/dev/null; cd dana
git config user.name Dana; git config user.email dana@example.com
cat > saidso.yml <<'Y'
room: dana-and-maya
members:
  dana: { role: developer, name: Dana }
  maya: { role: client, name: Maya }
actions:
  question:          { say: ask a question, by: anyone }
  deploy-staging:    { say: put a change on the test site, by: developer }
  deploy-production: { say: put a change on the live website, by: developer, ok: client }
Y
printf '.saidso/\n' > .gitignore
git add . && git commit -q -m start && git push -q -u origin main
node "$SAIDSO_BIN" whoami --set dana >/dev/null
cd "$D"; git clone -q room.git maya; cd maya
git config user.name Maya; git config user.email maya@example.com
node "$SAIDSO_BIN" whoami --set maya >/dev/null
