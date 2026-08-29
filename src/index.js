require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GameManager, PHASE, ROLES } = require('./game/GameManager');
const { buildTargetSelectRows } = require('./game/selectMenus');

// ---- Tunable timers (ms). Adjust to taste. ----
const NIGHT_ACTION_MS = 45_000;
const DAY_DISCUSSION_MS = 90_000;
const DAY_VOTE_MS = 45_000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const manager = new GameManager();
// Tracks which guild's game a user is currently part of, so we can route
// DM-based night-action interactions (DMs have no guildId of their own).
const playerGuild = new Map(); // userId -> guildId

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return handleCommand(interaction);
    if (interaction.isStringSelectMenu()) return handleSelectMenu(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: `Error: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

async function handleCommand(interaction) {
  if (interaction.commandName !== 'mafia') return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const game = manager.create(interaction.guildId, interaction.channelId, interaction.user.id);
    game.addPlayer(interaction.user.id, interaction.user.username);
    playerGuild.set(interaction.user.id, interaction.guildId);
    return interaction.reply(
      `🎭 Mafia lobby created by <@${interaction.user.id}>! Use \`/mafia join\` to hop in (max 50 players). Host runs \`/mafia start\` when ready.`
    );
  }

  const game = manager.get(interaction.guildId);
  if (!game || game.phase === PHASE.ENDED) {
    return interaction.reply({ content: 'No active lobby. Start one with `/mafia create`.', ephemeral: true });
  }

  if (sub === 'join') {
    game.addPlayer(interaction.user.id, interaction.user.username);
    playerGuild.set(interaction.user.id, interaction.guildId);
    return interaction.reply(`✅ <@${interaction.user.id}> joined! (${game.players.size}/50)`);
  }

  if (sub === 'leave') {
    game.removePlayer(interaction.user.id);
    return interaction.reply(`👋 <@${interaction.user.id}> left the lobby.`);
  }

  if (sub === 'players') {
    const names = [...game.players.values()].map((p) => p.username).join(', ') || 'nobody yet';
    return interaction.reply(`Lobby (${game.players.size}/50): ${names}`);
  }

  if (sub === 'start') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host who created the lobby can start it.', ephemeral: true });
    }
    if (game.players.size < 4) {
      return interaction.reply({ content: 'Need at least 4 players to start.', ephemeral: true });
    }
    game.start();
    const mafiaCount = game.aliveByRole(ROLES.MAFIA).length;
    await interaction.reply(
      `🌙 The game begins! ${game.players.size} players, ${mafiaCount} of them are Mafia. Check your DMs for your role.`
    );
    await sendRoleDMs(game);
    runGameLoop(game).catch((e) => console.error('Game loop crashed:', e));
    return;
  }

  if (sub === 'end') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can end the game.', ephemeral: true });
    }
    game.end();
    manager.delete(interaction.guildId);
    return interaction.reply('🛑 Game ended by host.');
  }
}

async function sendRoleDMs(game) {
  for (const player of game.players.values()) {
    try {
      const user = await client.users.fetch(player.id);
      const flavor =
        player.role === ROLES.MAFIA
          ? 'Work with your fellow Mafia at night to eliminate the town. Try not to get caught.'
          : player.role === ROLES.DOCTOR
          ? 'Each night, pick one player to save from elimination.'
          : player.role === ROLES.DETECTIVE
          ? "Each night, investigate one player to learn if they're Mafia."
          : 'Survive, and use the day discussion to help vote out the Mafia.';
      await user.send(`🎭 Your role is **${player.role}**.\n${flavor}`);
    } catch {
      // User has DMs closed - the game channel will note this.
    }
  }
}

async function runGameLoop(game) {
  const channel = await client.channels.fetch(game.channelId);

  while (true) {
    // ---------------- NIGHT ----------------
    await channel.send(`🌙 **Night ${game.dayNumber}** — check your DMs. You have ${NIGHT_ACTION_MS / 1000}s.`);
    await sendNightPrompts(game);
    await sleep(NIGHT_ACTION_MS);

    const nightResult = game.resolveNight();
    if (nightResult.killedPlayer) {
      await channel.send(`☠️ **${nightResult.killedPlayer.username}** was found dead this morning. They were a **${nightResult.killedPlayer.role}**.`);
    } else {
      await channel.send('☀️ Everyone survived the night!');
    }
    if (nightResult.investigateResult) {
      await notifyDetective(game, nightResult.investigateResult);
    }

    let winner = game.checkWinCondition();
    if (winner) return announceWinner(channel, game, winner);

    // ---------------- DAY: discussion ----------------
    await channel.send(
      `💬 **Discussion time!** You have ${DAY_DISCUSSION_MS / 1000}s to talk it over. Alive: ${game
        .alivePlayers()
        .map((p) => p.username)
        .join(', ')}`
    );
    await sleep(DAY_DISCUSSION_MS);

    // ---------------- DAY: vote ----------------
    const rows = buildTargetSelectRows(`day_vote:${game.guildId}`, 'Vote to eliminate', game.alivePlayers(), true);
    await channel.send({
      content: `🗳️ **Voting is open for ${DAY_VOTE_MS / 1000}s!** Everyone alive, pick who to eliminate (or skip).`,
      components: rows,
    });
    await sleep(DAY_VOTE_MS);

    const dayResult = game.resolveDay();
    if (dayResult.tied) {
      await channel.send('⚖️ The vote was tied — no one is eliminated today.');
    } else if (dayResult.eliminatedPlayer) {
      await channel.send(
        `🪦 The town has voted out **${dayResult.eliminatedPlayer.username}**. They were a **${dayResult.eliminatedPlayer.role}**.`
      );
    } else {
      await channel.send('No votes were cast — no one is eliminated today.');
    }

    winner = game.checkWinCondition();
    if (winner) return announceWinner(channel, game, winner);
  }
}

async function sendNightPrompts(game) {
  const alive = game.alivePlayers();
  const mafia = game.aliveByRole(ROLES.MAFIA);
  const doctors = game.aliveByRole(ROLES.DOCTOR);
  const detectives = game.aliveByRole(ROLES.DETECTIVE);

  for (const m of mafia) {
    const targets = alive.filter((p) => p.role !== ROLES.MAFIA);
    await dmWithRows(m.id, `🔪 Choose tonight's target:`, buildTargetSelectRows(`night_mafia:${game.guildId}`, 'Choose a target', targets));
  }
  for (const d of doctors) {
    await dmWithRows(d.id, `💉 Choose someone to save tonight:`, buildTargetSelectRows(`night_doctor:${game.guildId}`, 'Choose who to save', alive));
  }
  for (const d of detectives) {
    const targets = alive.filter((p) => p.id !== d.id);
    await dmWithRows(
      d.id,
      `🔍 Choose someone to investigate:`,
      buildTargetSelectRows(`night_detective:${game.guildId}:${d.id}`, 'Choose who to investigate', targets)
    );
  }
}

async function dmWithRows(userId, content, rows) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content, components: rows });
  } catch {
    // DMs closed - action simply won't be recorded for this player.
  }
}

async function notifyDetective(game, result) {
  // Find the detective who most recently submitted a check (stored on the game instance).
  const detectiveId = game.lastDetectiveId;
  if (!detectiveId) return;
  try {
    const user = await client.users.fetch(detectiveId);
    const target = game.players.get(result.targetId);
    await user.send(
      `🔍 Investigation result: **${target?.username ?? 'Unknown'}** is ${result.isMafia ? 'MAFIA 🚨' : 'not Mafia ✅'}.`
    );
  } catch {
    // DMs closed
  }
}

async function announceWinner(channel, game, winner) {
  const embed = new EmbedBuilder()
    .setTitle(winner === 'mafia' ? '🔪 Mafia wins!' : '🏘️ Town wins!')
    .setDescription(
      [...game.players.values()].map((p) => `${p.alive ? '💀 alive' : '☠️ dead'} — **${p.username}**: ${p.role}`).join('\n')
    );
  await channel.send({ embeds: [embed] });
  game.end();
  manager.delete(game.guildId);
}

async function handleSelectMenu(interaction) {
  const [type, guildId, extra] = interaction.customId.split(':');
  const game = manager.get(guildId);
  if (!game || game.phase === PHASE.ENDED) {
    return interaction.reply({ content: 'This game has already ended.', ephemeral: true });
  }
  const value = interaction.values[0];

  if (type === 'night_mafia') {
    if (game.phase !== PHASE.NIGHT) return interaction.reply({ content: 'Not the night phase anymore.', ephemeral: true });
    game.recordMafiaVote(interaction.user.id, value);
    return interaction.reply({ content: '🔪 Vote recorded.', ephemeral: true });
  }

  if (type === 'night_doctor') {
    if (game.phase !== PHASE.NIGHT) return interaction.reply({ content: 'Not the night phase anymore.', ephemeral: true });
    game.recordDoctorSave(value);
    return interaction.reply({ content: '💉 Save recorded.', ephemeral: true });
  }

  if (type === 'night_detective') {
    if (game.phase !== PHASE.NIGHT) return interaction.reply({ content: 'Not the night phase anymore.', ephemeral: true });
    game.recordDetectiveCheck(value);
    game.lastDetectiveId = extra; // the detective's own userId, embedded in the customId
    return interaction.reply({ content: '🔍 Investigation recorded.', ephemeral: true });
  }

  if (type === 'day_vote') {
    if (game.phase !== PHASE.DAY) return interaction.reply({ content: 'Voting is closed.', ephemeral: true });
    game.recordDayVote(interaction.user.id, value);
    return interaction.reply({ content: '🗳️ Vote recorded.', ephemeral: true });
  }
}

client.login(process.env.DISCORD_TOKEN);
