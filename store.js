import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { EMPTY_STATE, TEAMS, SONG_BATTLE, buildSongBattle, songBattleScores, finalizeSongBattle } from "./data.js?v=song-1";

const STORAGE_KEY = "regnum-noctis-demo";
let firebase = null;
let storeInstance = null;

export async function getStore() {
  if (storeInstance) return storeInstance;
  if (!isFirebaseConfigured) return (storeInstance = localStore());
  if (!firebase) {
    const [{ initializeApp }, auth, database] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js")
    ]);
    const app = initializeApp(firebaseConfig);
    firebase = { auth: auth.getAuth(app), db: database.getDatabase(app), ...auth, ...database };
  }
  return (storeInstance = firebaseStore());
}

function firebaseStore() {
  return {
    demo: false,
    subscribe(callback) {
      let state = normalise();
      const emit = () => callback(normalise(state));
      const stops = [
        firebase.onValue(firebase.ref(firebase.db, "settings"), snapshot => { state.settings = snapshot.val() || {}; emit(); }),
        firebase.onValue(firebase.ref(firebase.db, "games"), snapshot => { state.games = snapshot.val() || {}; emit(); }),
        firebase.onValue(firebase.ref(firebase.db, "oracleAnswers"), snapshot => { state.oracleAnswers = snapshot.val() || {}; emit(); })
      ];
      return () => stops.forEach(stop => stop());
    },
    subscribeOracleQuestions(callback) { return firebase.onValue(firebase.ref(firebase.db, "oracleQuestions"), snapshot => callback(snapshot.val() || {})); },
    subscribeSongBattleAnswers(callback) { return firebase.onValue(firebase.ref(firebase.db, "songBattleAnswers"), snapshot => callback(snapshot.val() || {})); },
    subscribeSongBattleAdmin(callback) { return firebase.onValue(firebase.ref(firebase.db, "songBattleAdmin"), snapshot => callback(normaliseSongBattleAdmin(snapshot.val()))); },
    async subscribeSongBattleTeam(teamId, callback) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      return firebase.onValue(firebase.ref(firebase.db, `songBattleAnswers/${teamId}`), snapshot => callback(snapshot.val() || {}));
    },
    async saveOracleQuestion(question, id = null) { const questionRef = id ? firebase.ref(firebase.db, `oracleQuestions/${id}`) : firebase.push(firebase.ref(firebase.db, "oracleQuestions")); await firebase.set(questionRef, { ...question, updatedAt: Date.now() }); },
    deleteOracleQuestion(id) { return firebase.remove(firebase.ref(firebase.db, `oracleQuestions/${id}`)); },
    auth: {
      login: (email, password) => firebase.signInWithEmailAndPassword(firebase.auth, email, password),
      logout: () => firebase.signOut(firebase.auth),
      observe: callback => firebase.onAuthStateChanged(firebase.auth, callback)
    },
    async saveGame(game, id = null) {
      const gameRef = id ? firebase.ref(firebase.db, `games/${id}`) : firebase.push(firebase.ref(firebase.db, "games"));
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${gameRef.key}`]: game,
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async startSongBattle() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      const game = buildSongBattle("running", current);
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${SONG_BATTLE.id}`]: game,
        songBattleAnswers: null,
        songBattleAdmin: { evaluations: {}, internalPoints: Object.fromEntries(TEAMS.map(team => [team.id, 0])), evaluationUpdatedAt: 0 },
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async setSongBattleRound(songNumber) {
      const number = Number(songNumber);
      if (number < 1 || number > SONG_BATTLE.songCount) throw new Error("Ungültige Songnummer.");
      await firebase.update(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`), { status: "running", currentSong: number, answersOpen: true, controlUpdatedAt: firebase.serverTimestamp() });
    },
    setSongBattleAnswersOpen(open) { return firebase.update(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`), { answersOpen: !!open, controlUpdatedAt: firebase.serverTimestamp() }); },
    async submitSongBattleAnswer(songNumber, profile, title, artist) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || !game.answersOpen) throw new Error("song-battle-closed");
      const cleanTitle = title.trim().slice(0, 120), cleanArtist = artist.trim().slice(0, 120);
      if (!cleanTitle && !cleanArtist) throw new Error("song-battle-empty");
      const answer = { songNumber: Number(songNumber), title: cleanTitle, artist: cleanArtist, playerName: profile.name, claimantId: firebase.auth.currentUser.uid, updatedAt: Date.now() };
      await firebase.set(firebase.ref(firebase.db, `songBattleAnswers/${profile.teamId}/song-${songNumber}`), answer);
      return answer;
    },
    async saveSongBattleEvaluation(songNumber, teamId, field, value) {
      if (!['title', 'artist'].includes(field) || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültige Bewertung.");
      const adminSnapshot = await firebase.get(firebase.ref(firebase.db, "songBattleAdmin"));
      const admin = normaliseSongBattleAdmin(adminSnapshot.val());
      (((admin.evaluations[`song-${songNumber}`] ||= {})[teamId] ||= {}))[field] = value === true;
      admin.internalPoints = songBattleScores(admin.evaluations);
      admin.evaluationUpdatedAt = Date.now();
      await firebase.set(firebase.ref(firebase.db, "songBattleAdmin"), admin);
    },
    async finishSongBattle(ranking) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`)),
        firebase.get(firebase.ref(firebase.db, "songBattleAdmin"))
      ]);
      const game = finalizeSongBattle(gameSnapshot.val(), normaliseSongBattleAdmin(adminSnapshot.val()).evaluations, ranking);
      await firebase.update(firebase.ref(firebase.db), { [`games/${SONG_BATTLE.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetSongBattle() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${SONG_BATTLE.id}`]: buildSongBattle("not-started", current),
        songBattleAnswers: null,
        songBattleAdmin: null,
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async claimChallenge(challengeId, profile, points) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const uid = firebase.auth.currentUser.uid;
      const gameId = `challenge-${challengeId}-${uid}`;
      const gameRef = firebase.ref(firebase.db, `games/${gameId}`);
      let created = false;
      const result = await firebase.runTransaction(gameRef, current => {
        if (current) return;
        created = true;
        return challengeGame(challengeId, profile, points, uid);
      });
      return { awarded: created && result.committed, teamId: result.snapshot.val()?.teamId || profile.teamId };
    },
    deleteGame: id => firebase.remove(firebase.ref(firebase.db, `games/${id}`)),
    setMode: mode => firebase.update(firebase.ref(firebase.db, "settings"), { mode, updatedAt: firebase.serverTimestamp() }),
    startHunt(minutes) {
      const startedAt = Date.now();
      return firebase.set(firebase.ref(firebase.db, "settings/hunt"), { active: true, roundId: startedAt.toString(36), startedAt, endsAt: startedAt + minutes * 60000 });
    },
    stopHunt() { return firebase.update(firebase.ref(firebase.db, "settings/hunt"), { active: false }); },
    async claimHuntObject(roundId, target, profile, points) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const gameId = `hunt-${roundId}-${profile.teamId}-${target.id}`;
      const gameRef = firebase.ref(firebase.db, `games/${gameId}`);
      let created = false;
      const result = await firebase.runTransaction(gameRef, current => {
        if (current) return;
        created = true;
        return huntGame(roundId, target, profile, points, firebase.auth.currentUser.uid);
      });
      return { awarded: created && result.committed, teamId: result.snapshot.val()?.teamId || profile.teamId };
    },
    startOracle({ question, answer, unit, minutes, maxPoints = 5 }) {
      const startedAt = Date.now();
      const roundId = startedAt.toString(36);
      const updates = {};
      updates["settings/oracle"] = { active: true, revealed: false, roundId, question, unit, maxPoints, startedAt, endsAt: startedAt + minutes * 60000, results: {} };
      updates[`oracleSecrets/${roundId}`] = { answer };
      return firebase.update(firebase.ref(firebase.db), updates);
    },
    async submitOracleAnswer(roundId, profile, value) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const answerRef = firebase.ref(firebase.db, `oracleAnswers/${roundId}/${profile.teamId}`);
      let created = false;
      const result = await firebase.runTransaction(answerRef, current => {
        if (current) return;
        created = true;
        return { value, playerName: profile.name, claimantId: firebase.auth.currentUser.uid, createdAt: Date.now() };
      });
      return { accepted: created && result.committed, answer: result.snapshot.val()?.value };
    },
    async finishOracle(state) {
      const oracle = state.settings.oracle;
      const secret = (await firebase.get(firebase.ref(firebase.db, `oracleSecrets/${oracle.roundId}`))).val();
      if (!secret || !Number.isFinite(Number(secret.answer))) throw new Error("oracle-secret-missing");
      const result = buildOracleResult(state, Number(secret.answer));
      const updates = {};
      updates[`games/oracle-${result.roundId}`] = result.game;
      updates["settings/oracle/active"] = false;
      updates["settings/oracle/revealed"] = true;
      updates["settings/oracle/results"] = result.results;
      updates["settings/oracle/answer"] = Number(secret.answer);
      updates[`oracleSecrets/${result.roundId}`] = null;
      updates["settings/updatedAt"] = firebase.serverTimestamp();
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    hideOracle() { return firebase.update(firebase.ref(firebase.db, "settings/oracle"), { active: false, revealed: false }); }
  };
}

function localStore() {
  const listeners = new Set();
  const read = () => normalise(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  const write = state => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); listeners.forEach(fn => fn(state)); };
  window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) listeners.forEach(fn => fn(read())); });
  return {
    demo: true,
    subscribe(callback) { listeners.add(callback); callback(read()); return () => listeners.delete(callback); },
    subscribeOracleQuestions(callback) { const listener = state => callback(state.oracleQuestions || {}); listeners.add(listener); callback(read().oracleQuestions || {}); return () => listeners.delete(listener); },
    subscribeSongBattleAnswers(callback) { const listener = state => callback(state.songBattleAnswers || {}); listeners.add(listener); callback(read().songBattleAnswers || {}); return () => listeners.delete(listener); },
    subscribeSongBattleAdmin(callback) { const listener = state => callback(normaliseSongBattleAdmin(state.songBattleAdmin)); listeners.add(listener); callback(normaliseSongBattleAdmin(read().songBattleAdmin)); return () => listeners.delete(listener); },
    async subscribeSongBattleTeam(teamId, callback) { const listener = state => callback(state.songBattleAnswers?.[teamId] || {}); listeners.add(listener); callback(read().songBattleAnswers?.[teamId] || {}); return () => listeners.delete(listener); },
    async saveOracleQuestion(question, id = null) { const state = read(); state.oracleQuestions[id || `question-${Date.now()}`] = { ...question, updatedAt: Date.now() }; write(state); },
    async deleteOracleQuestion(id) { const state = read(); delete state.oracleQuestions[id]; write(state); },
    auth: { login: async () => ({ user: { uid: "demo" } }), logout: async () => {}, observe: callback => { callback({ uid: "demo" }); return () => {}; } },
    async saveGame(game, id = null) { const state = read(); state.games[id || `demo-${Date.now()}`] = game; state.settings.updatedAt = Date.now(); write(state); },
    async startSongBattle() { const state = read(); state.games[SONG_BATTLE.id] = buildSongBattle("running", state.games[SONG_BATTLE.id]); state.songBattleAnswers = {}; state.songBattleAdmin = normaliseSongBattleAdmin(); state.settings.updatedAt = Date.now(); write(state); },
    async setSongBattleRound(songNumber) { const state = read(); const game = state.games[SONG_BATTLE.id]; const number = Number(songNumber); if (game?.status !== "running" || number < 1 || number > SONG_BATTLE.songCount) throw new Error("Ungültige Songrunde."); game.currentSong = number; game.answersOpen = true; game.controlUpdatedAt = Date.now(); write(state); },
    async setSongBattleAnswersOpen(open) { const state = read(); const game = state.games[SONG_BATTLE.id]; if (game?.status !== "running") throw new Error("Song Battle läuft nicht."); game.answersOpen = !!open; game.controlUpdatedAt = Date.now(); write(state); },
    async submitSongBattleAnswer(songNumber, profile, title, artist) { const state = read(); const game = state.games[SONG_BATTLE.id]; if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || !game.answersOpen) throw new Error("song-battle-closed"); const cleanTitle = title.trim().slice(0, 120), cleanArtist = artist.trim().slice(0, 120); if (!cleanTitle && !cleanArtist) throw new Error("song-battle-empty"); const answer = { songNumber: Number(songNumber), title: cleanTitle, artist: cleanArtist, playerName: profile.name, claimantId: profile.id, updatedAt: Date.now() }; ((state.songBattleAnswers[profile.teamId] ||= {})[`song-${songNumber}`]) = answer; write(state); return answer; },
    async saveSongBattleEvaluation(songNumber, teamId, field, value) { const state = read(); if (!['title', 'artist'].includes(field) || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültige Bewertung."); const admin = state.songBattleAdmin = normaliseSongBattleAdmin(state.songBattleAdmin); (((admin.evaluations[`song-${songNumber}`] ||= {})[teamId] ||= {}))[field] = value === true; admin.internalPoints = songBattleScores(admin.evaluations); admin.evaluationUpdatedAt = Date.now(); write(state); },
    async finishSongBattle(ranking) { const state = read(); state.games[SONG_BATTLE.id] = finalizeSongBattle(state.games[SONG_BATTLE.id], normaliseSongBattleAdmin(state.songBattleAdmin).evaluations, ranking); state.settings.updatedAt = Date.now(); write(state); },
    async resetSongBattle() { const state = read(); state.games[SONG_BATTLE.id] = buildSongBattle("not-started", state.games[SONG_BATTLE.id]); state.songBattleAnswers = {}; state.songBattleAdmin = normaliseSongBattleAdmin(); state.settings.updatedAt = Date.now(); write(state); },
    async claimChallenge(challengeId, profile, points) {
      const state = read();
      const id = `challenge-${challengeId}-${profile.id}`;
      if (state.games[id]) return { awarded: false, teamId: state.games[id].teamId };
      state.games[id] = challengeGame(challengeId, profile, points, profile.id);
      state.settings.updatedAt = Date.now();
      write(state);
      return { awarded: true, teamId: profile.teamId };
    },
    async deleteGame(id) { const state = read(); delete state.games[id]; state.settings.updatedAt = Date.now(); write(state); },
    async setMode(mode) { const state = read(); state.settings = { ...state.settings, mode, updatedAt: Date.now() }; write(state); },
    async startHunt(minutes) { const state = read(); const startedAt = Date.now(); state.settings.hunt = { active: true, roundId: startedAt.toString(36), startedAt, endsAt: startedAt + minutes * 60000 }; write(state); },
    async stopHunt() { const state = read(); state.settings.hunt = { ...(state.settings.hunt || {}), active: false }; write(state); },
    async claimHuntObject(roundId, target, profile, points) {
      const state = read();
      const hunt = state.settings.hunt || {};
      if (!hunt.active || hunt.roundId !== roundId || hunt.endsAt <= Date.now()) throw new Error("hunt-closed");
      const id = `hunt-${roundId}-${profile.teamId}-${target.id}`;
      if (state.games[id]) return { awarded: false, teamId: state.games[id].teamId };
      state.games[id] = huntGame(roundId, target, profile, points, profile.id);
      state.settings.updatedAt = Date.now();
      write(state);
      return { awarded: true, teamId: profile.teamId };
    },
    async startOracle({ question, answer, unit, minutes, maxPoints = 5 }) { const state = read(); const startedAt = Date.now(); state.settings.oracle = { active: true, revealed: false, roundId: startedAt.toString(36), question, answer, unit, maxPoints, startedAt, endsAt: startedAt + minutes * 60000, results: {} }; write(state); },
    async submitOracleAnswer(roundId, profile, value) { const state = read(); const oracle = state.settings.oracle || {}; if (!oracle.active || oracle.roundId !== roundId || oracle.endsAt <= Date.now()) throw new Error("oracle-closed"); const round = state.oracleAnswers[roundId] ||= {}; if (round[profile.teamId]) return { accepted: false, answer: round[profile.teamId].value }; round[profile.teamId] = { value, playerName: profile.name, claimantId: profile.id, createdAt: Date.now() }; write(state); return { accepted: true, answer: value }; },
    async finishOracle(state) { const latest = read(); const result = buildOracleResult(state || latest); latest.games[`oracle-${result.roundId}`] = result.game; latest.settings.oracle = { ...latest.settings.oracle, active: false, revealed: true, results: result.results }; latest.settings.updatedAt = Date.now(); write(latest); },
    async hideOracle() { const state = read(); state.settings.oracle = { ...state.settings.oracle, active: false, revealed: false }; write(state); }
  };
}

function challengeGame(challengeId, profile, points, claimantId) {
  return {
    name: `Nachtjagd: ${challengeId === "bottle" ? "Flasche" : challengeId}`,
    round: "Zusatzauftrag",
    resultText: `${profile.name} · ${profile.teamId}`,
    points,
    source: "challenge",
    challengeId,
    claimantId,
    playerName: profile.name,
    teamId: profile.teamId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function huntGame(roundId, target, profile, points, claimantId) {
  return {
    name: `Nachtjagd: ${target.name}`,
    round: "Die zehn Zeichen",
    resultText: `${profile.name} fand ${target.name} für ${profile.teamId}`,
    points,
    source: "team-hunt",
    roundId,
    targetId: target.id,
    claimantId,
    playerName: profile.name,
    teamId: profile.teamId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function normalise(value) {
  return {
    settings: {
      ...EMPTY_STATE.settings,
      ...(value?.settings || {}),
      hunt: { ...EMPTY_STATE.settings.hunt, ...(value?.settings?.hunt || {}) },
      oracle: { ...EMPTY_STATE.settings.oracle, ...(value?.settings?.oracle || {}) }
    },
    games: value?.games || {},
    songBattleAnswers: value?.songBattleAnswers || {},
    songBattleAdmin: normaliseSongBattleAdmin(value?.songBattleAdmin),
    oracleAnswers: value?.oracleAnswers || {},
    oracleQuestions: value?.oracleQuestions || {}
  };
}

function normaliseSongBattleAdmin(value = null) {
  return {
    evaluations: value?.evaluations || {},
    internalPoints: { ...Object.fromEntries(TEAMS.map(team => [team.id, 0])), ...(value?.internalPoints || {}) },
    evaluationUpdatedAt: Number(value?.evaluationUpdatedAt || 0)
  };
}

function buildOracleResult(state, answerOverride = null) {
  const oracle = state.settings.oracle;
  const correctAnswer = answerOverride ?? Number(oracle.answer);
  const answers = state.oracleAnswers?.[oracle.roundId] || {};
  const entries = TEAMS.filter(team => answers[team.id]).map(team => ({ team, value: Number(answers[team.id].value), error: Math.abs(Number(answers[team.id].value) - correctAnswer) }));
  const errors = [...new Set(entries.map(entry => entry.error))].sort((a, b) => a - b);
  const maxPoints = Math.max(1, Number(oracle.maxPoints) || 5);
  const scale = [1, .8, .6, .4, .2].map(factor => Math.max(1, Math.round(maxPoints * factor)));
  const points = Object.fromEntries(TEAMS.map(team => [team.id, 0]));
  const results = {};
  entries.forEach(entry => {
    const awarded = scale[Math.min(errors.indexOf(entry.error), scale.length - 1)];
    points[entry.team.id] = awarded;
    results[entry.team.id] = { value: entry.value, error: entry.error, points: awarded };
  });
  return {
    roundId: oracle.roundId,
    results,
    game: { name: "Das Orakel", round: oracle.question, resultText: `Lösung: ${correctAnswer}${oracle.unit ? ` ${oracle.unit}` : ""}`, points, source: "oracle", createdAt: Date.now(), updatedAt: Date.now() }
  };
}
