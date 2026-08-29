const { ROLES, assignRoles, shuffle } = require('./roles');

const PHASE = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  ENDED: 'ended',
};

class Game {
  constructor(guildId, channelId, hostId) {
    this.guildId = guildId;
    this.channelId = channelId;
    this.hostId = hostId;
    this.phase = PHASE.LOBBY;
    this.dayNumber = 0;
    this.players = new Map(); // userId -> { id, username, role, alive }
    this.nightActions = { mafiaVotes: new Map(), doctorSave: null, detectiveCheck: null };
    this.dayVotes = new Map(); // voterId -> targetId
    this.log = [];
  }

  addPlayer(id, username) {
    if (this.phase !== PHASE.LOBBY) throw new Error('Game already started.');
    if (this.players.size >= 50) throw new Error('Lobby is full (max 50 players).');
    if (this.players.has(id)) throw new Error('You already joined.');
    this.players.set(id, { id, username, role: null, alive: true });
  }

  removePlayer(id) {
    if (this.phase !== PHASE.LOBBY) throw new Error('Cannot leave after the game has started.');
    this.players.delete(id);
  }

  alivePlayers() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  aliveByRole(role) {
    return this.alivePlayers().filter((p) => p.role === role);
  }

  start() {
    if (this.phase !== PHASE.LOBBY) throw new Error('Game already started.');
    const ids = [...this.players.keys()];
    const assignment = assignRoles(ids);
    for (const [id, role] of assignment.entries()) {
      this.players.get(id).role = role;
    }
    this.phase = PHASE.NIGHT;
    this.dayNumber = 1;
    return this;
  }

  // ---- Night phase ----
  recordMafiaVote(voterId, targetId) {
    this.nightActions.mafiaVotes.set(voterId, targetId);
  }

  recordDoctorSave(targetId) {
    this.nightActions.doctorSave = targetId;
  }

  recordDetectiveCheck(targetId) {
    this.nightActions.detectiveCheck = targetId;
  }

  /** Tally mafia votes (majority, random tiebreak), apply doctor save, kill if unsaved. */
  resolveNight() {
    const tally = new Map();
    for (const target of this.nightActions.mafiaVotes.values()) {
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    let killedId = null;
    if (tally.size > 0) {
      const max = Math.max(...tally.values());
      const topTargets = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
      killedId = shuffle(topTargets)[0];
    }

    const saved = killedId && killedId === this.nightActions.doctorSave;
    let killedPlayer = null;
    if (killedId && !saved) {
      killedPlayer = this.players.get(killedId);
      if (killedPlayer) killedPlayer.alive = false;
    }

    const investigateResult = this.nightActions.detectiveCheck
      ? {
          targetId: this.nightActions.detectiveCheck,
          isMafia: this.players.get(this.nightActions.detectiveCheck)?.role === ROLES.MAFIA,
        }
      : null;

    this.log.push({ day: this.dayNumber, type: 'night', killedId: saved ? null : killedId, saved });
    this.nightActions = { mafiaVotes: new Map(), doctorSave: null, detectiveCheck: null };
    this.phase = PHASE.DAY;

    return { killedPlayer: saved ? null : killedPlayer, saved: Boolean(saved && killedId), investigateResult };
  }

  // ---- Day phase ----
  recordDayVote(voterId, targetId) {
    this.dayVotes.set(voterId, targetId);
  }

  resolveDay() {
    const tally = new Map();
    for (const target of this.dayVotes.values()) {
      if (target === 'skip') continue;
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    let eliminatedId = null;
    let tied = false;
    if (tally.size > 0) {
      const max = Math.max(...tally.values());
      const topTargets = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
      if (topTargets.length === 1) {
        eliminatedId = topTargets[0];
      } else {
        tied = true;
      }
    }

    let eliminatedPlayer = null;
    if (eliminatedId) {
      eliminatedPlayer = this.players.get(eliminatedId);
      if (eliminatedPlayer) eliminatedPlayer.alive = false;
    }

    this.log.push({ day: this.dayNumber, type: 'day', eliminatedId, tied });
    this.dayVotes = new Map();
    this.dayNumber += 1;
    this.phase = PHASE.NIGHT;

    return { eliminatedPlayer, tied };
  }

  /** Returns 'mafia', 'town', or null if the game continues. */
  checkWinCondition() {
    const alive = this.alivePlayers();
    const aliveMafia = alive.filter((p) => p.role === ROLES.MAFIA).length;
    const aliveTown = alive.length - aliveMafia;
    if (aliveMafia === 0) return 'town';
    if (aliveMafia >= aliveTown) return 'mafia';
    return null;
  }

  end() {
    this.phase = PHASE.ENDED;
  }
}

class GameManager {
  constructor() {
    this.games = new Map(); // guildId -> Game
  }

  create(guildId, channelId, hostId) {
    if (this.games.has(guildId) && this.games.get(guildId).phase !== PHASE.ENDED) {
      throw new Error('A game is already active in this server. End it first with /mafia end.');
    }
    const game = new Game(guildId, channelId, hostId);
    this.games.set(guildId, game);
    return game;
  }

  get(guildId) {
    return this.games.get(guildId);
  }

  delete(guildId) {
    this.games.delete(guildId);
  }
}

module.exports = { GameManager, PHASE, ROLES };
