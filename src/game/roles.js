// Role identities used by the game. Detective was removed per host-controlled
// design: the host explicitly sets Mafia and Doctor counts, everyone else is
// a Citizen.
const ROLES = {
  MAFIA: 'Mafia',
  DOCTOR: 'Doctor',
  CITIZEN: 'Citizen',
};

/**
 * Build a role list from host-chosen counts.
 * @param {number} playerCount
 * @param {number} mafiaCount
 * @param {number} doctorCount
 */
function buildRoleList(playerCount, mafiaCount, doctorCount) {
  if (playerCount < 3) {
    throw new Error('Need at least 3 players to start.');
  }
  if (playerCount > 50) {
    throw new Error('This bot supports a maximum of 50 players.');
  }
  if (!Number.isInteger(mafiaCount) || mafiaCount < 1) {
    throw new Error('Mafia count must be a whole number of at least 1.');
  }
  if (!Number.isInteger(doctorCount) || doctorCount < 0) {
    throw new Error('Doctor count must be a whole number of 0 or more.');
  }
  if (mafiaCount + doctorCount >= playerCount) {
    throw new Error('Mafia + Doctor counts must leave at least 1 player as a Citizen.');
  }

  const citizenCount = playerCount - mafiaCount - doctorCount;

  return [
    ...Array(mafiaCount).fill(ROLES.MAFIA),
    ...Array(doctorCount).fill(ROLES.DOCTOR),
    ...Array(citizenCount).fill(ROLES.CITIZEN),
  ];
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
 * Assigns a shuffled role to each player ID, using host-chosen Mafia/Doctor counts.
 * @param {string[]} playerIds
 * @param {number} mafiaCount
 * @param {number} doctorCount
 * @returns {Map<string,string>} playerId -> role
 */
function assignRoles(playerIds, mafiaCount, doctorCount) {
  const roles = shuffle(buildRoleList(playerIds.length, mafiaCount, doctorCount));
  const shuffledPlayers = shuffle(playerIds);
  const assignment = new Map();
  shuffledPlayers.forEach((id, i) => assignment.set(id, roles[i]));
  return assignment;
}

module.exports = { ROLES, buildRoleList, assignRoles, shuffle };
