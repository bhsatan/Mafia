const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * Discord select menus max out at 25 options, and a message can hold at most
 * 5 action rows. This splits a target list into up to 5 menus so games with
 * many alive players (this bot supports up to 50) still work.
 */
function buildTargetSelectRows(customIdPrefix, placeholder, targets, includeSkip = false) {
  const options = targets.map((t) => ({ label: t.username, value: t.id }));
  if (includeSkip) options.push({ label: 'Skip / no action', value: 'skip' });

  const chunks = [];
  for (let i = 0; i < options.length; i += 25) chunks.push(options.slice(i, i + 25));

  return chunks.slice(0, 5).map((chunk, idx) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${customIdPrefix}:${idx}`)
        .setPlaceholder(chunks.length > 1 ? `${placeholder} (group ${idx + 1})` : placeholder)
        .addOptions(chunk)
    )
  );
}

module.exports = { buildTargetSelectRows };
