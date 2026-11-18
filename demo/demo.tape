# vhs demo/demo.tape  ->  docs/demo.gif
Output docs/demo.gif
Set Shell bash
Set FontSize 17
Set Width 1180
Set Height 720
Set Padding 26
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms
Set WindowBar Colorful

Hide
Type "export SAIDSO_BIN=$PWD/bin/saidso.js; alias saidso='node $SAIDSO_BIN'; bash demo/setup.sh; cd /tmp/saidso-demo/dana; export PS1='\[\e[1;36m\]\W\[\e[0m\] $ '; clear" Enter
Sleep 2s
Show

Type "# Dana's agent asks to go live. The agreement says: needs Maya's OK." Enter
Type 'saidso send maya --action deploy-production "Homepage v2 passed review. Ready to go live."' Enter
Sleep 2.2s
Type "# Then it tries something nobody agreed to:" Enter
Type 'saidso send maya --action send-newsletter "Sending the November issue now."' Enter
Sleep 2.6s
Type "cd ../maya && clear && saidso inbox" Enter
Sleep 6s
Type "saidso approve 1" Enter
Sleep 1.6s
Type "yes" Sleep 400ms Enter
Sleep 1.6s
Type "cd ../dana && saidso check deploy-production" Enter
Sleep 2s
Type "saidso log" Enter
Sleep 5s
