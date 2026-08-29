# Family Mafia Bot

A self-hosted Discord bot for playing Mafia with up to 50 people, built entirely with free tools:
Node.js + discord.js (bot logic) and an Oracle Cloud "Always Free" VM (hosting).

## What it does
- `/mafia create` — start a lobby in the current channel
- `/mafia join` / `/mafia leave` — join or leave before the game starts
- `/mafia players` — list who's in the lobby
- `/mafia start` — host-only, needs 4+ players. Assigns roles by DM and kicks off the game
- `/mafia end` — host-only, force-ends the game

Roles scale automatically with player count (roughly 20% Mafia, 1 Doctor and 1 Detective per 8 players,
rest Villagers). The bot runs night (private DM actions) and day (public discussion + vote) phases on a
timer automatically until one side wins.

**Video/voice:** create a normal Discord voice channel and have everyone join it for the "everyone on
video" part — the bot's text commands and DMs run alongside that. Note Discord's own limit: video in a
voice channel caps at 25 people once anyone turns their camera on; voice-only holds far more. For a
50-person game, either split into two voice channels or keep video to a smaller "core" group with the
rest on audio.

---

## Step 1 — Create the Discord bot application
1. Go to https://discord.com/developers/applications → **New Application** → name it (e.g. "Family Mafia").
2. Go to **Bot** (left sidebar) → **Reset Token** → copy the token somewhere safe. This is `DISCORD_TOKEN`.
3. Still on the Bot page, turn ON **Server Members Intent** (needed to look up players).
4. Go to **OAuth2 → URL Generator**. Check scopes: `bot`, `applications.commands`.
   Under bot permissions check: Send Messages, Read Message History, Use Slash Commands, Embed Links.
5. Copy the generated URL, open it in a browser, and invite the bot to your family's server.
6. On **General Information**, copy the **Application ID** — this is `CLIENT_ID`.

## Step 2 — Get a free always-on server (Oracle Cloud)
1. Sign up at https://www.oracle.com/cloud/free/ (a card is required for identity verification but the
   "Always Free" tier is not billed).
2. Create a Compute instance: **Always Free eligible** shape (e.g. `VM.Standard.E2.1.Micro`), Ubuntu image.
3. Download the SSH key it gives you, then connect:
   ```
   ssh -i your-key.pem ubuntu@<your-instance-public-ip>
   ```
4. On the instance, install Node.js and git:
   ```
   sudo apt update && sudo apt install -y nodejs npm git
   node -v   # confirm it's v18 or newer; if not, use nodesource setup script
   ```
5. In the Oracle Cloud console, open the instance's **Virtual Cloud Network** and make sure no inbound
   ports need opening — this bot only makes outbound connections to Discord, so no firewall changes needed.

## Step 3 — Deploy the bot
1. Upload this project folder to the VM (e.g. `scp -i your-key.pem -r mafia-bot ubuntu@<ip>:~`), or `git clone`
   it if you push it to your own GitHub repo first.
2. On the VM:
   ```
   cd mafia-bot
   npm install
   cp .env.example .env
   nano .env    # paste in DISCORD_TOKEN, CLIENT_ID, and (optional) GUILD_ID for instant command sync
   npm run deploy   # registers the /mafia slash commands
   ```
3. Keep it running permanently with `pm2` (a free process manager):
   ```
   sudo npm install -g pm2
   pm2 start src/index.js --name mafia-bot
   pm2 save
   pm2 startup    # follow the printed instructions so it survives reboots
   ```
4. Check logs any time with `pm2 logs mafia-bot`.

## Step 4 — Play
In your server: `/mafia create`, have everyone `/mafia join`, host runs `/mafia start`. Everyone should
also join a voice channel for talking (and video, up to Discord's limits noted above).

---

## Tuning
Open `src/index.js` and adjust the constants at the top:
- `NIGHT_ACTION_MS` — how long players get to submit night actions (default 45s)
- `DAY_DISCUSSION_MS` — open talk time before voting (default 90s)
- `DAY_VOTE_MS` — voting window (default 45s)

Role ratios live in `src/game/roles.js` in `buildRoleList()` if you want more/fewer Mafia, Doctors, or
Detectives for your group's taste.

## Notes / current scope
This is a solid MVP covering the core Mafia loop (roles, night actions, voting, win detection) for up to
50 players. Things you may want to add later: a lynch-confirmation step, more roles (e.g. Vigilante,
Mayor), a `/mafia rules` command, persistent stats across games (SQLite), and reconnect-safe state if the
bot restarts mid-game (currently game state is in-memory and resets if the process restarts).
