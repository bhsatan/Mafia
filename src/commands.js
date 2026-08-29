const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('mafia')
    .setDescription('Play Mafia with your server')
    .addSubcommand((sub) => sub.setName('create').setDescription('Create a new Mafia lobby in this channel'))
    .addSubcommand((sub) => sub.setName('join').setDescription('Join the open lobby'))
    .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the lobby before the game starts'))
    .addSubcommand((sub) => sub.setName('players').setDescription('List everyone currently in the lobby'))
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start the game (host only, needs at least 4 players)')
    )
    .addSubcommand((sub) => sub.setName('end').setDescription('End the current game (host only)'))
    .addSubcommand((sub) =>
      sub.setName('skip').setDescription('Host only: skip ahead to voting immediately during discussion')
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Host only: hand host control to another player')
        .addUserOption((opt) => opt.setName('target').setDescription('Who should become host').setRequired(true))
    ),
].map((c) => c.toJSON());

module.exports = { commands };
