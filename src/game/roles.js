// Role identities used by the game.
const ROLES = {
  MAFIA: 'Mafia',
  DOCTOR: 'Doctor',
  DETECTIVE: 'Detective',
  VILLAGER: 'Villager',
};

/**
 * Build a role list for the given number of players.
 * Scales team sizes so large games (up to 50 players) stay balanced:
 * - Mafia is roughly 20% of players (min 1)
 * - 1 Doctor per 8 players (min 1 if 5+ players)
 * - 1 Detective per 8 players (min 1 if 5+ players)
 * - Everyone else is a Villager
 */
function buildRoleList(playerCount) {
  if (playerCount < 4) {
    throw new Error('Mafia requires at least 4 players.');
  }
  if (playerCount > 50) {
    throw new Error('This bot supports a maximum of 50 players.');
  }

  const mafiaCount = Math.max(1, Math.round(playerCount * 0.2));
  const doctorCount = playerCount >= 5 ? Math.max(1, Math.floor(playerCount / 8)) : 0;
  const detectiveCount = playerCount >= 5 ? Math.max(1, Math.floor(playerCount / 8)) : 0;

  const specialCount = mafiaCount + doctorCount + detectiveCount;
  const villagerCount = Math.max(0, playerCount - specialCount);

  const roles = [
    ...Array(mafiaCount).fill(ROLES.MAFIA),
    ...Array(doctorCount).fill(ROLES.DOCTOR),
    ...Array(detectiveCount).fill(ROLES.DETECTIVE),
    ...Array(villagerCount).fill(ROLES.VILLAGER),
  ];

  return roles;
}

// Fisher-Yates shuffle
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Assigns a shuffled role to each player ID.
 * @param {string[]} playerIds
 * @returns {Map<string,string>} playerId -> role
 */
function assignRoles(playerIds) {
  const roles = shuffle(buildRoleList(playerIds.length));
  const shuffledPlayers = shuffle(playerIds);
  const assignment = new Map();
  shuffledPlayers.forEach((id, i) => assignment.set(id, roles[i]));
  return assignment;
}

module.exports = { ROLES, buildRoleList, assignRoles, shuffle };
