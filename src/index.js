require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GameManager, PHASE, ROLES } = require('./game/GameManager');
const { buildTargetSelectRows } = require('./game/selectMenus');

// ---- Tunable timers (ms). Discussion length is host-controlled, not timed. ----
const NIGHT_ACTION_MS = 90_000;
const DAY_VOTE_MS = 60_000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const manager = new GameManager();
// Tracks which guild's game a player is part of, so DM-based night-action
// interactions (DMs have no guildId of their own) can be routed correctly.
const playerGuild = new Map(); // userId -> guildId

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic gate: the game loop calls this and awaits it; a host command later
// resolves it by calling game[resolverProp](), letting the host fully control
// when discussion opens and when it ends.
function waitForHostSignal(game, resolverProp) {
  return new Promise((resolve) => {
    game[resolverProp] = () => {
      game[resolverProp] = null;
      resolve();
    };
  });
}

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
    return interaction.reply(
      `🎭 Mafia lobby created! <@${interaction.user.id}> is the **host** (overseeing only, not playing). Players use \`/mafia join\` to hop in (max 50). Host runs \`/mafia start mafia:<n> doctor:<n>\` when ready.`
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
    return interaction.reply(`Lobby (${game.players.size}/50): ${names}. Host: <@${game.hostId}>`);
  }

  if (sub === 'start') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host who created the lobby can start it.', ephemeral: true });
    }
    const mafiaCount = interaction.options.getInteger('mafia');
    const doctorCount = interaction.options.getInteger('doctor') ?? 0;
    game.start(mafiaCount, doctorCount); // throws with a clear message if counts don't fit
    const citizenCount = game.players.size - mafiaCount - doctorCount;
    await interaction.reply(
      `🌙 The game begins! ${game.players.size} players — ${mafiaCount} Mafia, ${doctorCount} Doctor(s), ${citizenCount} Citizen(s). Check your DMs for your role.`
    );
    await sendRoleDMs(game);
    runGameLoop(game).catch((e) => console.error('Game loop crashed:', e));
    return;
  }

  if (sub === 'discuss') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can open discussion.', ephemeral: true });
    }
    if (typeof game.discussStartResolver !== 'function') {
      return interaction.reply({ content: `Can't open discussion right now (current phase: ${game.phase}).`, ephemeral: true });
    }
    game.discussStartResolver();
    return interaction.reply('💬 Discussion is now open.');
  }

  if (sub === 'openvote') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can open voting.', ephemeral: true });
    }
    if (typeof game.discussEndResolver !== 'function') {
      return interaction.reply({ content: `Can't open voting right now (current phase: ${game.phase}).`, ephemeral: true });
    }
    game.discussEndResolver();
    return interaction.reply('🗳️ Discussion closed — voting is opening now.');
  }

  if (sub === 'end') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can end the game.', ephemeral: true });
    }
    game.end();
    manager.delete(interaction.guildId);
    return interaction.reply('🛑 Game ended by host.');
  }

  if (sub === 'transfer') {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the current host can transfer host control.', ephemeral: true });
    }
    const target = interaction.options.getUser('target');
    const targetIsPlayer = game.players.has(target.id);
    game.hostId = target.id;
    const note = targetIsPlayer
      ? " Heads up: they're also currently a player in this game — the host role doesn't remove them from play automatically."
      : '';
    return interaction.reply(
      `👑 <@${target.id}> is now the host and controls \`start\`, \`discuss\`, \`openvote\`, \`end\`, and \`transfer\`.${note}`
    );
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
          : 'Survive, and use the day discussion to help vote out the Mafia.';
      await user.send(`🎭 Your role is **${player.role}**.\n${flavor}`);
    } catch {
      // User has DMs closed - they simply won't receive night prompts.
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

    const nightResult = game.resolveNight(); // phase -> AWAITING_DISCUSSION
    if (nightResult.killedPlayer) {
      await channel.send(
        `☠️ **${nightResult.killedPlayer.username}** was found dead this morning. They were a **${nightResult.killedPlayer.role}**.`
      );
    } else {
      await channel.send('☀️ Everyone survived the night!');
    }

    let winner = game.checkWinCondition();
    if (winner) return announceWinner(channel, game, winner);

    // ---------------- Host-controlled discussion ----------------
    await channel.send(`⏸️ Host, run \`/mafia discuss\` whenever you'd like to open the floor for discussion.`);
    await waitForHostSignal(game, 'discussStartResolver');
    game.openDiscussion();
    await channel.send(
      `💬 **Discussion is open.** Alive: ${game.alivePlayers().map((p) => p.username).join(', ')}\nHost can run \`/mafia openvote\` any time to move to voting.`
    );

    await waitForHostSignal(game, 'discussEndResolver');
    game.openVoting();

    const rows = buildTargetSelectRows(`day_vote:${game.guildId}`, 'Vote to eliminate', game.alivePlayers(), true);
    await channel.send({
      content: `🗳️ **Voting is open for ${DAY_VOTE_MS / 1000}s!** Everyone alive, pick who to eliminate (or skip).`,
      components: rows,
    });
    await sleep(DAY_VOTE_MS);

    const dayResult = game.resolveDay(); // phase -> NIGHT, dayNumber++
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

  for (const m of mafia) {
    const targets = alive.filter((p) => p.role !== ROLES.MAFIA);
    await dmWithRows(m.id, `🔪 Choose tonight's target:`, buildTargetSelectRows(`night_mafia:${game.guildId}`, 'Choose a target', targets));
  }
  for (const d of doctors) {
    await dmWithRows(d.id, `💉 Choose someone to save tonight:`, buildTargetSelectRows(`night_doctor:${game.guildId}`, 'Choose who to save', alive));
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
  const [type, guildId] = interaction.customId.split(':');
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

  if (type === 'day_vote') {
    if (game.phase !== PHASE.VOTING) return interaction.reply({ content: 'Voting is closed.', ephemeral: true });
    game.recordDayVote(interaction.user.id, value);
    return interaction.reply({ content: '🗳️ Vote recorded.', ephemeral: true });
  }
}

client.login(process.env.DISCORD_TOKEN);
