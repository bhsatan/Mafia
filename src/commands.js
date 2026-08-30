const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('mafia')
    .setDescription('Play Mafia with your server')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create a new Mafia lobby (you become the host, not a player)')
    )
    .addSubcommand((sub) => sub.setName('join').setDescription('Join the open lobby as a player'))
    .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the lobby before the game starts'))
    .addSubcommand((sub) => sub.setName('players').setDescription('List everyone currently in the lobby'))
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Host only: choose Mafia/Doctor counts and start the game')
        .addIntegerOption((opt) =>
          opt.setName('mafia').setDescription('How many Mafia players').setRequired(true).setMinValue(1)
        )
        .addIntegerOption((opt) =>
          opt.setName('doctor').setDescription('How many Doctors (default 0)').setRequired(false).setMinValue(0)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('discuss').setDescription('Host only: open the discussion phase after the night result')
    )
    .addSubcommand((sub) =>
      sub.setName('openvote').setDescription('Host only: end discussion and open voting')
    )
    .addSubcommand((sub) => sub.setName('end').setDescription('End the current game (host only)'))
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Host only: hand host control to another person')
        .addUserOption((opt) => opt.setName('target').setDescription('Who should become host').setRequired(true))
    ),
].map((c) => c.toJSON());

module.exports = { commands };
