import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=participants-20261010-1";
import "./status.js?v=participants-20261010-1";
import { serverNow, setServerTimeOffset } from "./time.js?v=participants-20261010-1";
import { EMPTY_STATE, TEAMS, SONG_BATTLE, NOVITIUS_GAME, NOVITIUS_DEFAULT_QUESTIONS, buildSongBattle, songBattleScores, finalizeSongBattle, buildNovitiusGame, rebuildNovitiusReveals, finalizeNovitiusGame, scoreNovitiusAnswer } from "./data.js?v=participants-20261010-1";
import { HUNT_DEFAULT_TARGETS, HUNT_POINTS_PER_OBJECT, normaliseHuntTargets, huntTargetList } from "./hunt-data.js?v=participants-20261010-1";
import { GAME_CHALLENGES, GAME_CHALLENGE_ROTATIONS, buildGameChallenges, normaliseGameChallengesAdmin, cleanEstimateQuestion, cleanChallengeResult, cleanEstimateValue, buildChallengePublicRound, buildPublicEstimate, calculateGameChallenges, challengeEstimateQuestions, challengeTimerRemaining, emptyChallengeTimer } from "./challenges-data.js?v=participants-20261010-1";
import { BEER_PONG, buildBeerPong, normaliseBeerPongAdmin, cleanBeerPongResult, publicBeerPongMatch, evaluateBeerPongGroups, releaseBeerPongSemifinals, releaseBeerPongFinal, completeBeerPong, resetBeerPongKnockouts, resetBeerPongFinal } from "./beer-pong-data.js?v=participants-20261010-1";
import { BALLOON_MONSTER, buildBalloonMonster, normaliseBalloonMonsterAdmin, cleanBalloonSupply, cleanBalloonResult, announceBalloonTeam, undoBalloonDraw, emptyBalloonTimer, balloonTimerRemaining, publishBalloonResult, completeBalloonMonster } from "./balloon-monster-data.js?v=participants-20261010-1";

const STORAGE_KEY = "regnum-noctis-demo";
let firebase = null;
let storeInstance = null;
let storePromise = null;
let anonymousPromise = null;
let activeAdminOperation = null;

export async function getStore() {
  if (storeInstance) return storeInstance;
  if (!isFirebaseConfigured) throw new Error("Die Firebase-Datenbank-URL fehlt. Bitte die Konfiguration vervollständigen.");
  if (!storePromise) storePromise = initializeFirebaseStore();
  return storePromise;
}

async function initializeFirebaseStore() {
  if (!firebase) {
    const [{ initializeApp }, auth, database] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js")
    ]);
    const app = initializeApp(firebaseConfig);
    firebase = { auth: auth.getAuth(app), db: database.getDatabase(app, firebaseConfig.databaseURL), ...auth, ...database };
    fenceAdminWrites();
    await firebase.auth.authStateReady();
    await new Promise((resolve, reject) => firebase.onValue(firebase.ref(firebase.db, ".info/serverTimeOffset"), snapshot => { setServerTimeOffset(snapshot.val()); resolve(); }, reject));
    firebase.onValue(firebase.ref(firebase.db, ".info/connected"), snapshot => window.dispatchEvent(new CustomEvent("regnum-connection", { detail: { connected: snapshot.val() === true } })));
  }
  return (storeInstance = serialiseAdminActions(firebaseStore()));
}

async function ensureAnonymous() {
  await firebase.auth.authStateReady();
  if (firebase.auth.currentUser) {
    if (!firebase.auth.currentUser.isAnonymous) throw new Error("Bitte für die Teilnahme ein separates Browserfenster verwenden.");
    return firebase.auth.currentUser;
  }
  if (!anonymousPromise) anonymousPromise = firebase.signInAnonymously(firebase.auth).finally(() => { anonymousPromise = null; });
  return (await anonymousPromise).user;
}

async function ensurePlayer(profile) {
  const user = await ensureAnonymous();
  if (!TEAMS.some(team => team.id === profile?.teamId) || !String(profile?.name || "").trim()) throw new Error("Bitte Name und Reich wählen.");
  const playerRef = firebase.ref(firebase.db, `players/${user.uid}`);
  let player = (await firebase.get(playerRef)).val();
  if (!player) {
    if ((await firebase.get(firebase.ref(firebase.db, "settings/registrationOpen"))).val() === false) throw new Error("Der Beitritt ist pausiert. Bitte bei der Spielleitung melden.");
    try {
      const result = await firebase.runTransaction(playerRef, current => current ? undefined : { teamId: profile.teamId, playerName: profile.name.trim().slice(0, 32), joinedAt: firebase.serverTimestamp() }, { applyLocally: false });
      player = result.snapshot.val();
    } catch (error) {
      if ((await firebase.get(firebase.ref(firebase.db, "settings/registrationOpen"))).val() === false) throw new Error("Der Beitritt ist pausiert. Bitte bei der Spielleitung melden.");
      throw error;
    }
  }
  if (player?.teamId !== profile.teamId) throw new Error("Dieses Gerät ist bereits für ein anderes Reich angemeldet.");
  return { ...profile, id: user.uid, teamId: player.teamId, name: player.playerName, joinedAt: player.joinedAt };
}

// Eine gemeinsame Sperre serialisiert mehrpfadige Admin-Korrekturen auf allen Geräten.
function serialiseAdminActions(store) {
  const participantActions = new Set(["registerPlayer", "claimSongBattleTeam", "submitSongBattleAnswer", "claimNovitiusParticipant", "submitNovitiusAnswer", "claimHuntObject", "submitOracleAnswer"]);
  let queue = Promise.resolve();
  for (const [name, action] of Object.entries(store)) {
    if (typeof action !== "function" || name.startsWith("subscribe") || participantActions.has(name)) continue;
    store[name] = (...args) => {
      const operation = queue.then(() => withAdminOperation(() => action(...args)));
      queue = operation.catch(() => {});
      return operation;
    };
  }
  return store;
}

async function withAdminOperation(action) {
  const user = firebase.auth.currentUser;
  if (!user || user.isAnonymous || !(await firebase.get(firebase.ref(firebase.db, `admins/${user.uid}`))).val()) throw new Error("Keine Adminberechtigung.");
  const operationId = crypto.randomUUID(), lockRef = firebase.ref(firebase.db, "adminOperationLock");
  let stopLock;
  await new Promise((resolve, reject) => { stopLock = firebase.onValue(lockRef, () => resolve(), reject); });
  const result = await firebase.runTransaction(lockRef, current => {
    if (current && current.expiresAt > serverNow()) return;
    return { owner: user.uid, operationId, expiresAt: serverNow() + 90000 };
  }, { applyLocally: false });
  if (!result.committed) { stopLock(); throw new Error("Eine andere Adminaktion läuft gerade. Bitte kurz warten und erneut versuchen."); }
  activeAdminOperation = { owner: user.uid, operationId };
  const renewal = setInterval(() => {
    firebase.runTransaction(lockRef, current => current?.operationId === operationId ? { ...current, expiresAt: serverNow() + 90000 } : undefined, { applyLocally: false }).catch(reportStoreError);
  }, 30000);
  try { return await action(); }
  finally {
    activeAdminOperation = null;
    clearInterval(renewal);
    if (firebase.auth.currentUser?.uid === user.uid) await firebase.runTransaction(lockRef, current => !current || current.operationId === operationId ? null : undefined, { applyLocally: false }).catch(reportStoreError);
    stopLock();
  }
}

function referencePath(reference) {
  const parts = [];
  for (let current = reference; current?.key !== null; current = current.parent) parts.unshift(current.key);
  return parts.join("/");
}

function fenceAdminWrites() {
  const original = { set: firebase.set, update: firebase.update, remove: firebase.remove, runTransaction: firebase.runTransaction };
  const guardedUpdate = (reference, values) => {
    if (!activeAdminOperation) return original.update(reference, values);
    const prefix = referencePath(reference);
    const updates = Object.fromEntries(Object.entries(values).map(([path, value]) => [prefix ? `${prefix}/${path}` : path, value]));
    updates.adminOperationReceipt = { ...activeAdminOperation, updatedAt: firebase.serverTimestamp() };
    Object.entries(updates).forEach(([path, value]) => {
      if (/^games\/[^/]+$/.test(path) && value) updates[path] = { ...value, adminOperationId: activeAdminOperation.operationId };
    });
    const gameIds = new Set(Object.keys(updates).map(path => /^games\/([^/]+)\//.exec(path)?.[1]).filter(Boolean));
    gameIds.forEach(id => { if (!Object.hasOwn(updates, `games/${id}`)) updates[`games/${id}/adminOperationId`] = activeAdminOperation.operationId; });
    return original.update(firebase.ref(firebase.db), updates);
  };
  firebase.update = guardedUpdate;
  firebase.set = (reference, value) => activeAdminOperation ? guardedUpdate(firebase.ref(firebase.db), { [referencePath(reference)]: value }) : original.set(reference, value);
  firebase.remove = reference => activeAdminOperation ? guardedUpdate(firebase.ref(firebase.db), { [referencePath(reference)]: null }) : original.remove(reference);
  firebase.runTransaction = (reference, reducer, options) => {
    const operation = activeAdminOperation;
    if (!operation || referencePath(reference) === "adminOperationLock") return original.runTransaction(reference, reducer, options);
    return original.runTransaction(reference, current => {
      const value = reducer(current);
      return value && typeof value === "object" ? { ...value, adminOperationId: operation.operationId } : value;
    }, options);
  };
}

function reportStoreError(error) {
  window.dispatchEvent(new CustomEvent("regnum-store-error", { detail: error }));
}

function listen(path, callback, emptyValue = {}) {
  return firebase.onValue(firebase.ref(firebase.db, path), snapshot => callback(snapshot.val() ?? emptyValue), error => { callback(emptyValue); reportStoreError(error); });
}

function firebaseStore() {
  return {
    demo: false,
    subscribe(callback) {
      let state = normalise();
      const emit = () => callback(normalise(state));
      const stops = [
        listen("settings", value => { state.settings = value; emit(); }),
        listen("games", value => { state.games = value; emit(); }),
        listen("novitiusSubmissions", value => { state.novitiusSubmissions = value; emit(); })
      ];
      return () => stops.forEach(stop => stop());
    },
    subscribeOracleQuestions(callback) { return listen("oracleQuestions", callback); },
    subscribePlayers(callback) { return listen("players", callback); },
    subscribePlayer(callback) {
      let stopPlayer;
      const stopAuth = firebase.onAuthStateChanged(firebase.auth, user => {
        stopPlayer?.(); stopPlayer = null;
        if (user?.isAnonymous) stopPlayer = listen(`players/${user.uid}`, value => callback(value, user.uid), null);
        else callback(null, null);
      });
      return () => { stopAuth(); stopPlayer?.(); };
    },
    registerPlayer: ensurePlayer,
    setRegistrationOpen(open) {
      if (typeof open !== "boolean") throw new Error("Ungültiger Beitrittsstatus.");
      return firebase.update(firebase.ref(firebase.db, "settings"), { registrationOpen: open, updatedAt: firebase.serverTimestamp() });
    },
    async removePlayer(uid) {
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(uid) || (await firebase.get(firebase.ref(firebase.db, `admins/${uid}`))).val() === true) throw new Error("Ungültige Teilnehmer-ID.");
      const player = (await firebase.get(firebase.ref(firebase.db, `players/${uid}`))).val();
      if (!player) return { removed: false };
      const registrationOpen = (await firebase.get(firebase.ref(firebase.db, "settings/registrationOpen"))).val() !== false;
      let quizRegistrationOpen = null;
      // Die betroffene UID kann während der Bereinigung keine neuen Daten erzeugen.
      await firebase.update(firebase.ref(firebase.db, "settings"), { registrationOpen: false, participantCleanup: uid });
      try {
        const quiz = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
        if (quiz?.registrationOpen) {
          quizRegistrationOpen = true;
          await firebase.update(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`), { registrationOpen: false });
        }
        const paths = ["games", "songBattleParticipants", "songBattleAnswers", "songBattleAdmin", "novitiusParticipants", "novitiusAnswers", "novitiusSubmissions", "novitiusAdmin"];
        const state = Object.fromEntries(await Promise.all(paths.map(async path => [path, (await firebase.get(firebase.ref(firebase.db, path))).val() || {}])));
        const updates = { [`players/${uid}`]: null, "settings/updatedAt": firebase.serverTimestamp() };
        for (const [teamId, participant] of Object.entries(state.songBattleParticipants)) {
          if (participant.claimantId !== uid) continue;
          updates[`songBattleParticipants/${teamId}`] = null;
          updates[`songBattleAnswers/${teamId}`] = null;
          delete state.songBattleParticipants[teamId];
          delete state.songBattleAnswers[teamId];
          const admin = normaliseSongBattleAdmin(state.songBattleAdmin);
          Object.values(admin.evaluations).forEach(teams => { delete teams[teamId]; });
          admin.internalPoints = songBattleScores(admin.evaluations);
          updates.songBattleAdmin = admin;
          let game = state.games[SONG_BATTLE.id];
          if (game) {
            game = { ...game, publicReveals: Object.fromEntries(Object.keys(game.revealedSongs || {}).filter(key => game.revealedSongs[key]).map(key => [key, buildSongPublicReveal(state.songBattleAnswers, admin.evaluations, Number(key.replace("song-", "")))])) };
            updates[`games/${SONG_BATTLE.id}`] = game.status === "completed" ? Object.keys(state.songBattleParticipants).length ? finalizeSongBattle(game, admin.evaluations) : buildSongBattle("not-started", game) : game;
          }
        }
        updates[`novitiusParticipants/${uid}`] = null;
        updates[`novitiusAnswers/${uid}`] = null;
        for (const [key, submissions] of Object.entries(state.novitiusSubmissions)) if (submissions[uid]) updates[`novitiusSubmissions/${key}/${uid}`] = null;
        const quizParticipant = state.novitiusParticipants[uid];
        if (quizParticipant) {
          delete state.novitiusParticipants[uid]; delete state.novitiusAnswers[uid];
          let game = state.games[NOVITIUS_GAME.id];
          if (game) {
            const questions = normaliseNovitiusAdmin(state.novitiusAdmin).questions;
            game = { ...game, teamSizes: novitiusTeamSizes(state.novitiusParticipants), tieBreak: null };
            game.publicReveals = rebuildNovitiusReveals(questions, state.novitiusParticipants, state.novitiusAnswers, game.teamSizes, game.revealedQuestions || {});
            if (quizRegistrationOpen) game.registrationOpen = true;
            if (game.status === "completed") game = Object.keys(state.novitiusParticipants).length ? refinalizeNovitiusOrPending(game, questions, state.novitiusParticipants, state.novitiusAnswers) : buildNovitiusGame("not-started", game);
            updates[`games/${NOVITIUS_GAME.id}`] = game;
          }
        }
        for (const [id, game] of Object.entries(state.games)) if (game.source === "team-hunt" && game.claimantId === uid) updates[`games/${id}`] = null;
        await firebase.update(firebase.ref(firebase.db), updates);
        return { removed: true };
      } finally {
        const updates = { "settings/registrationOpen": registrationOpen, "settings/participantCleanup": null, "settings/updatedAt": firebase.serverTimestamp() };
        if (quizRegistrationOpen) updates[`games/${NOVITIUS_GAME.id}/registrationOpen`] = true;
        await firebase.update(firebase.ref(firebase.db), updates);
      }
    },
    subscribeSongBattleAnswers(callback) { return listen("songBattleAnswers", callback); },
    subscribeSongBattleParticipants(callback) { return listen("songBattleParticipants", callback); },
    subscribeSongBattleAdmin(callback) { return listen("songBattleAdmin", value => callback(normaliseSongBattleAdmin(value))); },
    subscribeNovitiusAdmin(callback) { return listen("novitiusAdmin", value => callback(normaliseNovitiusAdmin(value))); },
    subscribeNovitiusParticipants(callback) { return listen("novitiusParticipants", callback); },
    subscribeNovitiusAnswers(callback) { return listen("novitiusAnswers", callback); },
    subscribeGameChallengesAdmin(callback) { return listen("gameChallengesAdmin", value => callback(normaliseGameChallengesAdmin(value))); },
    subscribeBeerPongAdmin(callback) { return listen("beerPongAdmin", value => callback(normaliseBeerPongAdmin(value))); },
    subscribeBalloonMonsterAdmin(callback) { return listen("balloonMonsterAdmin", value => callback(normaliseBalloonMonsterAdmin(value))); },
    subscribeHuntAdmin(callback) { return listen("huntAdmin", value => callback({ targets: normaliseHuntTargets(value?.targets) })); },
    async subscribeSongBattleTeam(teamId, callback) {
      const user = await ensureAnonymous();
      let answers = {}, participant = null;
      let answersStop = null;
      const emit = () => callback({ answers, participant, owned: participant?.claimantId === user.uid });
      const participantStop = listen(`songBattleParticipants/${teamId}`, value => {
        participant = value;
        answersStop?.(); answersStop = null; answers = {};
        if (participant?.claimantId === user.uid) answersStop = listen(`songBattleAnswers/${teamId}`, value => { answers = value; emit(); });
        emit();
      }, null);
      return () => { participantStop(); answersStop?.(); };
    },
    async subscribeNovitiusPlayer(callback) {
      await ensureAnonymous();
      const participantId = firebase.auth.currentUser.uid;
      let participant = null, answers = {};
      const emit = () => callback({ participantId, participant, answers });
      const stops = [
        listen(`novitiusParticipants/${participantId}`, value => { participant = value; emit(); }, null),
        listen(`novitiusAnswers/${participantId}`, value => { answers = value; emit(); })
      ];
      return () => stops.forEach(stop => stop());
    },
    async saveOracleQuestion(question, id = null) { const questionRef = id ? firebase.ref(firebase.db, `oracleQuestions/${id}`) : firebase.push(firebase.ref(firebase.db, "oracleQuestions")); await firebase.set(questionRef, { ...question, updatedAt: serverNow() }); },
    deleteOracleQuestion(id) { return firebase.remove(firebase.ref(firebase.db, `oracleQuestions/${id}`)); },
    auth: {
      async login(email, password) {
        await firebase.setPersistence(firebase.auth, firebase.browserSessionPersistence);
        return firebase.signInWithEmailAndPassword(firebase.auth, email, password);
      },
      logout: () => firebase.signOut(firebase.auth),
      observe(callback) {
        let stop = null, generation = 0;
        const authStop = firebase.onAuthStateChanged(firebase.auth, user => {
          stop?.(); stop = null; const current = ++generation;
          callback(false, user);
          if (!user || user.isAnonymous || !user.providerData.some(provider => provider.providerId === "password")) return;
          stop = listen(`admins/${user.uid}`, allowed => { if (current === generation) callback(allowed === true, user); }, false);
        });
        return () => { generation++; stop?.(); authStop(); };
      }
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
      const game = buildSongBattle("running");
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${SONG_BATTLE.id}`]: game,
        songBattleAnswers: null,
        songBattleParticipants: null,
        songBattleAdmin: { evaluations: {}, internalPoints: Object.fromEntries(TEAMS.map(team => [team.id, 0])), evaluationUpdatedAt: 0 },
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async setSongBattleRound(songNumber) {
      const number = Number(songNumber);
      if (number < 1 || number > SONG_BATTLE.songCount) throw new Error("Ungültige Songnummer.");
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      if (game?.revealedSongs?.[`song-${number}`]) throw new Error("Dieser Song wurde bereits aufgelöst und kann nicht erneut geöffnet werden.");
      await firebase.update(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`), { status: "running", currentSong: number, answersOpen: true, controlUpdatedAt: firebase.serverTimestamp() });
    },
    async setSongBattleAnswersOpen(open) {
      const gameRef = firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`);
      const game = (await firebase.get(gameRef)).val();
      if (open && game?.revealedSongs?.[`song-${game.currentSong}`]) throw new Error("Ein aufgelöster Song kann nicht erneut geöffnet werden.");
      return firebase.update(gameRef, { answersOpen: !!open, controlUpdatedAt: firebase.serverTimestamp() });
    },
    async claimSongBattleTeam(profile) {
      profile = await ensurePlayer(profile);
      const participantRef = firebase.ref(firebase.db, `songBattleParticipants/${profile.teamId}`);
      const claimantId = firebase.auth.currentUser.uid;
      const result = await firebase.runTransaction(participantRef, current => current ? undefined : { claimantId, playerName: profile.name, joinedAt: firebase.serverTimestamp() }, { applyLocally: false });
      const participant = result.snapshot.val();
      return { claimed: participant?.claimantId === claimantId, participant };
    },
    releaseSongBattleTeam(teamId) { return firebase.update(firebase.ref(firebase.db), { [`songBattleParticipants/${teamId}`]: null, [`songBattleAnswers/${teamId}`]: null }); },
    async submitSongBattleAnswer(songNumber, profile, title, artist) {
      profile = await ensurePlayer(profile);
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || !game.answersOpen) throw new Error("song-battle-closed");
      const participant = (await firebase.get(firebase.ref(firebase.db, `songBattleParticipants/${profile.teamId}`))).val();
      if (participant?.claimantId !== firebase.auth.currentUser.uid) throw new Error("song-battle-not-participant");
      const cleanTitle = title.trim().slice(0, 120), cleanArtist = artist.trim().slice(0, 120);
      if (!cleanTitle && !cleanArtist) throw new Error("song-battle-empty");
      const answer = { songNumber: Number(songNumber), title: cleanTitle, artist: cleanArtist, playerName: participant.playerName, claimantId: firebase.auth.currentUser.uid, updatedAt: firebase.serverTimestamp() };
      await firebase.set(firebase.ref(firebase.db, `songBattleAnswers/${profile.teamId}/song-${songNumber}`), answer);
      return answer;
    },
    async saveSongBattleEvaluation(songNumber, teamId, field, value) {
      if (!['title', 'artist'].includes(field) || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültige Bewertung.");
      const adminSnapshot = await firebase.get(firebase.ref(firebase.db, "songBattleAdmin"));
      const admin = normaliseSongBattleAdmin(adminSnapshot.val());
      (((admin.evaluations[`song-${songNumber}`] ||= {})[teamId] ||= {}))[field] = value === true;
      admin.internalPoints = songBattleScores(admin.evaluations);
      admin.evaluationUpdatedAt = serverNow();
      const gameSnapshot = await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`));
      const game = gameSnapshot.val();
      const updates = { songBattleAdmin: admin };
      if (game?.revealedSongs?.[`song-${songNumber}`]) {
        const answers = (await firebase.get(firebase.ref(firebase.db, "songBattleAnswers"))).val() || {};
        updates[`games/${SONG_BATTLE.id}/publicReveals/song-${songNumber}`] = buildSongPublicReveal(answers, admin.evaluations, songNumber);
      }
      if (game?.status === "completed") updates[`games/${SONG_BATTLE.id}`] = finalizeSongBattle({ ...game, publicReveals: { ...game.publicReveals, [`song-${songNumber}`]: updates[`games/${SONG_BATTLE.id}/publicReveals/song-${songNumber}`] } }, admin.evaluations);
      if (updates[`games/${SONG_BATTLE.id}`]) delete updates[`games/${SONG_BATTLE.id}/publicReveals/song-${songNumber}`];
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async revealSongBattleSong(songNumber) {
      const [gameSnapshot, answersSnapshot, adminSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`)),
        firebase.get(firebase.ref(firebase.db, "songBattleAnswers")),
        firebase.get(firebase.ref(firebase.db, "songBattleAdmin"))
      ]);
      const game = gameSnapshot.val(), answers = answersSnapshot.val() || {}, admin = normaliseSongBattleAdmin(adminSnapshot.val());
      if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || game.answersOpen) throw new Error("Antworten zuerst sperren.");
      const reveal = buildSongPublicReveal(answers, admin.evaluations, songNumber, true);
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${SONG_BATTLE.id}/revealedSongs/song-${songNumber}`]: true,
        [`games/${SONG_BATTLE.id}/publicReveals/song-${songNumber}`]: reveal,
        [`games/${SONG_BATTLE.id}/controlUpdatedAt`]: firebase.serverTimestamp()
      });
    },
    async finishSongBattle() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`)),
        firebase.get(firebase.ref(firebase.db, "songBattleAdmin"))
      ]);
      const current = gameSnapshot.val();
      if (!["running", "completed"].includes(current?.status)) throw new Error("Song Battle ist nicht gestartet.");
      for (let number = 1; number <= SONG_BATTLE.songCount; number++) if (!current.revealedSongs?.[`song-${number}`]) throw new Error("Bitte zuerst alle sechs Songs sperren, bewerten und auflösen.");
      const game = finalizeSongBattle(current, normaliseSongBattleAdmin(adminSnapshot.val()).evaluations);
      await firebase.update(firebase.ref(firebase.db), { [`games/${SONG_BATTLE.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetSongBattle() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${SONG_BATTLE.id}`]: buildSongBattle("not-started", current),
        songBattleAnswers: null,
        songBattleParticipants: null,
        songBattleAdmin: null,
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async saveNovitiusQuestion(number, question) {
      const clean = cleanNovitiusQuestion(number, question);
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const game = (await firebase.get(gameRef)).val();
      const updates = { [`novitiusAdmin/questions/question-${number}`]: clean };
      if (game?.revealedQuestions?.[`question-${number}`] && clean.correctValue !== "") {
        const [adminSnapshot, participantsSnapshot, answersSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, "novitiusAdmin")), firebase.get(firebase.ref(firebase.db, "novitiusParticipants")), firebase.get(firebase.ref(firebase.db, "novitiusAnswers"))]);
        const questions = normaliseNovitiusAdmin(adminSnapshot.val()).questions, participants = participantsSnapshot.val() || {}, answers = answersSnapshot.val() || {};
        questions[`question-${number}`] = clean;
        const reveals = rebuildNovitiusReveals(questions, participants, answers, game.teamSizes || {}, game.revealedQuestions || {});
        Object.assign(updates, novitiusScoreUpdates(questions, answers, game.revealedQuestions || {}));
        if (game.status === "completed") updates[`games/${NOVITIUS_GAME.id}`] = refinalizeNovitiusOrPending({ ...game, publicReveals: reveals }, questions, participants, answers);
        else updates[`games/${NOVITIUS_GAME.id}/publicReveals`] = reveals;
      }
      return firebase.update(firebase.ref(firebase.db), updates);
    },
    async startNovitiusGame() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`)),
        firebase.get(firebase.ref(firebase.db, "novitiusAdmin"))
      ]);
      const game = buildNovitiusGame("running", null);
      const admin = normaliseNovitiusAdmin(adminSnapshot.val());
      admin.liveResult = null;
      admin.questions["question-10"].correctValue = "";
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${NOVITIUS_GAME.id}`]: game,
        novitiusParticipants: null,
        novitiusAnswers: null,
        novitiusSubmissions: null,
        novitiusAdmin: admin,
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async setNovitiusRegistration(open) {
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || Number(game.currentQuestion || 0) > 0) throw new Error("Die Anmeldung kann nach Frage 1 nicht mehr geändert werden.");
      if (!open) await firebase.update(gameRef, { registrationOpen: false, controlUpdatedAt: firebase.serverTimestamp() });
      const participants = (await firebase.get(firebase.ref(firebase.db, "novitiusParticipants"))).val() || {};
      return firebase.update(gameRef, { registrationOpen: !!open, participantsLocked: !open, teamSizes: open ? emptyTeamCounts() : novitiusTeamSizes(participants), controlUpdatedAt: firebase.serverTimestamp() });
    },
    async claimNovitiusParticipant(profile) {
      profile = await ensurePlayer(profile);
      const participantId = firebase.auth.currentUser.uid;
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running" || !game.registrationOpen) throw new Error("novitius-registration-closed");
      const participant = { claimantId: participantId, playerName: profile.name, teamId: profile.teamId, joinedAt: firebase.serverTimestamp() };
      const result = await firebase.runTransaction(firebase.ref(firebase.db, `novitiusParticipants/${participantId}`), current => current ? undefined : participant, { applyLocally: false });
      return { participantId, participant: result.snapshot.val() };
    },
    removeNovitiusParticipant(participantId) { return firebase.update(firebase.ref(firebase.db), { [`novitiusParticipants/${participantId}`]: null, [`novitiusAnswers/${participantId}`]: null }); },
    async startNovitiusQuestion(number) {
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const questionNumber = Number(number);
      if (questionNumber < 1 || questionNumber > NOVITIUS_GAME.questionCount) throw new Error("Ungültige Frage.");
      const question = (await firebase.get(firebase.ref(firebase.db, `novitiusAdmin/questions/question-${questionNumber}`))).val();
      if (!question?.text) throw new Error("Diese Frage ist noch nicht vorbereitet.");
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running") throw new Error("Das Spiel läuft nicht.");
      if (game?.revealedQuestions?.[`question-${questionNumber}`]) throw new Error("Diese Frage wurde bereits aufgelöst und kann nicht erneut geöffnet werden.");
      if (game?.questionStates?.[`question-${questionNumber}`] && game.questionStates[`question-${questionNumber}`] !== "locked") throw new Error("Diese Frage wurde bereits freigegeben.");
      if (questionNumber > 1 && !game?.revealedQuestions?.[`question-${questionNumber - 1}`]) throw new Error("Bitte zuerst die vorherige Frage auflösen.");
      await firebase.update(gameRef, { registrationOpen: false, controlUpdatedAt: firebase.serverTimestamp() });
      const participants = (await firebase.get(firebase.ref(firebase.db, "novitiusParticipants"))).val() || {};
      const teamSizes = game.participantsLocked ? { ...emptyTeamCounts(), ...(game.teamSizes || {}) } : novitiusTeamSizes(participants);
      if (!Object.values(teamSizes).some(Number)) throw new Error("Es ist noch niemand angemeldet.");
      await firebase.update(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`), {
        status: "running",
        registrationOpen: false,
        participantsLocked: true,
        teamSizes,
        currentQuestion: questionNumber,
        currentQuestionData: publicNovitiusQuestion(question),
        answersOpen: true,
        [`questionStates/question-${questionNumber}`]: "open",
        controlUpdatedAt: firebase.serverTimestamp()
      });
    },
    async setNovitiusAnswersOpen(open) {
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentQuestion) throw new Error("Es läuft noch keine Frage.");
      if (open && game.revealedQuestions?.[`question-${game.currentQuestion}`]) throw new Error("Eine aufgelöste Frage kann nicht erneut geöffnet werden.");
      if (open && game.questionStates?.[`question-${game.currentQuestion}`] === "closed") throw new Error("Eine geschlossene Frage kann nicht erneut geöffnet werden.");
      return firebase.update(gameRef, { answersOpen: !!open, [`questionStates/question-${game.currentQuestion}`]: open ? "open" : "closed", controlUpdatedAt: firebase.serverTimestamp() });
    },
    async submitNovitiusAnswer(questionNumber, profile, value) {
      profile = await ensurePlayer(profile);
      const participantId = firebase.auth.currentUser.uid;
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || !game.answersOpen) throw new Error("novitius-answers-closed");
      const participant = (await firebase.get(firebase.ref(firebase.db, `novitiusParticipants/${participantId}`))).val();
      if (!participant || participant.teamId !== profile.teamId) throw new Error("novitius-not-registered");
      const cleanValue = cleanNovitiusAnswerValue(game.currentQuestionData, value);
      const answer = { value: cleanValue, playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, createdAt: firebase.serverTimestamp(), updatedAt: firebase.serverTimestamp() };
      const answerPath = `novitiusAnswers/${participantId}/question-${questionNumber}`;
      try {
        await firebase.update(firebase.ref(firebase.db), {
          [answerPath]: answer,
          [`novitiusSubmissions/question-${questionNumber}/${participantId}`]: { teamId: participant.teamId, createdAt: firebase.serverTimestamp() }
        });
      } catch (error) {
        if ((await firebase.get(firebase.ref(firebase.db, answerPath))).exists()) throw new Error("novitius-answer-exists");
        throw error;
      }
      return (await firebase.get(firebase.ref(firebase.db, answerPath))).val();
    },
    async revealNovitiusQuestion(questionNumber) {
      const [gameSnapshot, questionSnapshot, participantsSnapshot, answersSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`)),
        firebase.get(firebase.ref(firebase.db, `novitiusAdmin/questions/question-${questionNumber}`)),
        firebase.get(firebase.ref(firebase.db, "novitiusParticipants")),
        firebase.get(firebase.ref(firebase.db, "novitiusAnswers"))
      ]);
      const game = gameSnapshot.val();
      if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || game.answersOpen) throw new Error("Antworten zuerst sperren.");
      const allAnswers = answersSnapshot.val() || {}, participants = participantsSnapshot.val() || {}, questions = normaliseNovitiusAdmin((await firebase.get(firebase.ref(firebase.db, "novitiusAdmin"))).val()).questions;
      const revealedQuestions = { ...(game.revealedQuestions || {}), [`question-${questionNumber}`]: true };
      const reveals = rebuildNovitiusReveals(questions, participants, allAnswers, game.teamSizes || {}, revealedQuestions);
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${NOVITIUS_GAME.id}/revealedQuestions/question-${questionNumber}`]: true,
        [`games/${NOVITIUS_GAME.id}/questionStates/question-${questionNumber}`]: "revealed",
        [`games/${NOVITIUS_GAME.id}/publicReveals`]: reveals,
        [`games/${NOVITIUS_GAME.id}/controlUpdatedAt`]: firebase.serverTimestamp(),
        ...novitiusScoreUpdates(questions, allAnswers, revealedQuestions)
      });
    },
    async correctNovitiusAnswer(participantId, questionNumber, value) {
      const [gameSnapshot, adminSnapshot, participantsSnapshot, answersSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`)), firebase.get(firebase.ref(firebase.db, "novitiusAdmin")), firebase.get(firebase.ref(firebase.db, "novitiusParticipants")), firebase.get(firebase.ref(firebase.db, "novitiusAnswers"))
      ]);
      const game = gameSnapshot.val(), participants = participantsSnapshot.val() || {}, participant = participants[participantId];
      if (!participant) throw new Error("Teilnehmende Person nicht gefunden.");
      const key = `question-${Number(questionNumber)}`, answers = answersSnapshot.val() || {};
      const questions = normaliseNovitiusAdmin(adminSnapshot.val()).questions;
      const previous = answers?.[participantId]?.[key] || {};
      const corrected = { ...previous, value: cleanNovitiusAnswerValue(questions[key], value), playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, correctedByAdmin: true, createdAt: previous.createdAt || serverNow(), updatedAt: serverNow() };
      if (game.revealedQuestions?.[key]) Object.assign(corrected, storedNovitiusScore(questions[key], corrected.value));
      ((answers[participantId] ||= {})[key]) = corrected;
      const reveals = rebuildNovitiusReveals(questions, participants, answers, game.teamSizes || {}, game.revealedQuestions || {});
      const updates = { [`novitiusAnswers/${participantId}/${key}`]: answers[participantId][key], [`novitiusSubmissions/${key}/${participantId}`]: { teamId: participant.teamId, createdAt: serverNow() }, "settings/updatedAt": firebase.serverTimestamp() };
      if (game.status === "completed") updates[`games/${NOVITIUS_GAME.id}`] = refinalizeNovitiusOrPending({ ...game, publicReveals: reveals }, questions, participants, answers);
      else updates[`games/${NOVITIUS_GAME.id}/publicReveals`] = reveals;
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async setNovitiusLiveResult(value) {
      if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") throw new Error("Bitte eine gültige ganze Zahl eingeben.");
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) throw new Error("Bitte eine gültige ganze Zahl eingeben.");
      return firebase.update(firebase.ref(firebase.db), { "novitiusAdmin/questions/question-10/correctValue": number, "novitiusAdmin/liveResult": number });
    },
    async saveNovitiusTieBreak(tieBreak) {
      const ranking = buildTieBreakRanking(tieBreak);
      return firebase.set(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}/tieBreak`), { question: String(tieBreak.question || "").trim().slice(0, 180), correctValue: Number(tieBreak.correctValue), answers: tieBreak.answers, ranking, resolvedAt: serverNow() });
    },
    async finishNovitiusGame() {
      const [gameSnapshot, adminSnapshot, participantsSnapshot, answersSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`)),
        firebase.get(firebase.ref(firebase.db, "novitiusAdmin")),
        firebase.get(firebase.ref(firebase.db, "novitiusParticipants")),
        firebase.get(firebase.ref(firebase.db, "novitiusAnswers"))
      ]);
      const game = finalizeNovitiusGame(gameSnapshot.val(), normaliseNovitiusAdmin(adminSnapshot.val()).questions, participantsSnapshot.val() || {}, answersSnapshot.val() || {});
      await firebase.update(firebase.ref(firebase.db), { [`games/${NOVITIUS_GAME.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetNovitiusGame() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${NOVITIUS_GAME.id}`]: buildNovitiusGame("not-started", current),
        novitiusParticipants: null,
        novitiusAnswers: null,
        novitiusSubmissions: null,
        "novitiusAdmin/liveResult": null,
        "novitiusAdmin/questions/question-10/correctValue": "",
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async startGameChallenges() {
      const admin = resetGameChallengesAdmin((await firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))).val());
      await firebase.update(firebase.ref(firebase.db), { [`games/${GAME_CHALLENGES.id}`]: buildGameChallenges("running"), gameChallengesAdmin: admin, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async startGameChallengeTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running") throw new Error("Game Challenges laufen nicht.");
      const remainingMs = game?.timer?.status === "idle" ? GAME_CHALLENGES.durationSeconds * 1000 : challengeTimerRemaining(game.timer), now = serverNow();
      if (remainingMs <= 0) throw new Error("Die Zeit ist abgelaufen. Bitte die Runde beenden oder den Timer zurücksetzen.");
      await firebase.update(gameRef, { phase: "running", timer: { status: "running", durationMs: GAME_CHALLENGES.durationSeconds * 1000, remainingMs, startedAt: now, endsAt: now + remainingMs }, updatedAt: firebase.serverTimestamp() });
    },
    async pauseGameChallengeTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || game?.timer?.status !== "running") throw new Error("Der Timer läuft nicht.");
      const remainingMs = challengeTimerRemaining(game.timer);
      await firebase.update(gameRef, { phase: "paused", timer: { ...game.timer, status: "paused", remainingMs, endsAt: 0 }, updatedAt: firebase.serverTimestamp() });
    },
    async resetGameChallengeTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running") throw new Error("Game Challenges laufen nicht.");
      await firebase.update(gameRef, { phase: "ready", timer: emptyChallengeTimer(), updatedAt: firebase.serverTimestamp() });
    },
    async endGameChallengeRound() {
      const gameRef = firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running") throw new Error("Game Challenges laufen nicht.");
      await firebase.update(gameRef, { phase: "results", timer: { ...emptyChallengeTimer(), status: "finished", remainingMs: 0 }, updatedAt: firebase.serverTimestamp() });
    },
    async saveGameChallengeRound(roundNumber, entries) {
      const admin = applyChallengeRoundEntries((await firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))).val(), roundNumber, entries);
      await firebase.set(firebase.ref(firebase.db, "gameChallengesAdmin"), admin);
    },
    async publishGameChallengeRound(roundNumber) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`)), firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))]);
      const game = gameSnapshot.val(); if (game?.status !== "running" && game?.status !== "completed") throw new Error("Game Challenges sind nicht gestartet.");
      const publicRound = buildChallengePublicRound(roundNumber, adminSnapshot.val());
      const updates = { [`games/${GAME_CHALLENGES.id}/roundPublished/round-${roundNumber}`]: true, [`games/${GAME_CHALLENGES.id}/publicRounds/round-${roundNumber}`]: publicRound, [`games/${GAME_CHALLENGES.id}/updatedAt`]: firebase.serverTimestamp(), "settings/updatedAt": firebase.serverTimestamp() };
      if (Number(game.currentRound) === Number(roundNumber)) updates[`games/${GAME_CHALLENGES.id}/phase`] = "published";
      const effectiveAdmin = publishedChallengesAdmin(game, adminSnapshot.val(), roundNumber);
      if (game.estimateRevealed) updates[`games/${GAME_CHALLENGES.id}/publicEstimate`] = buildPublicEstimate(effectiveAdmin);
      if (game.status === "completed") {
        const corrected = calculateGameChallenges({ ...game, publicRounds: { ...game.publicRounds, [`round-${roundNumber}`]: publicRound } }, effectiveAdmin);
        Object.keys(updates).filter(path => path.startsWith(`games/${GAME_CHALLENGES.id}/`)).forEach(path => delete updates[path]);
        updates[`games/${GAME_CHALLENGES.id}`] = corrected;
      }
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async nextGameChallengeRound() {
      const gameRef = firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`), game = (await firebase.get(gameRef)).val(), current = Number(game?.currentRound || 0);
      if (game?.status !== "running" || current >= GAME_CHALLENGES.roundCount) throw new Error("Keine weitere Runde verfügbar.");
      if (!game.roundPublished?.[`round-${current}`]) throw new Error("Bitte zuerst die aktuelle Runde veröffentlichen.");
      await firebase.update(gameRef, { currentRound: current + 1, phase: "ready", timer: emptyChallengeTimer(), updatedAt: firebase.serverTimestamp() });
    },
    async saveGameChallengeEstimateQuestion(questionId, question) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`)), firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))]);
      let game = gameSnapshot.val(), admin = normaliseGameChallengesAdmin(adminSnapshot.val());
      admin.estimateQuestions[questionId] = cleanEstimateQuestion(questionId, { ...admin.estimateQuestions[questionId], ...question, estimates: admin.estimateQuestions[questionId]?.estimates || {} }); admin.updatedAt = serverNow();
      await firebase.set(firebase.ref(firebase.db, "gameChallengesAdmin"), admin);
    },
    async revealGameChallengeEstimate() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`)), firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))]);
      const game = gameSnapshot.val();
      for (let round = 1; round <= GAME_CHALLENGES.roundCount; round += 1) if (!game?.roundPublished?.[`round-${round}`]) throw new Error("Die Schätz-Challenge darf erst nach allen fünf Runden aufgelöst werden.");
      const publicEstimate = buildPublicEstimate(adminSnapshot.val());
      const revealed = { ...game, estimateRevealed: true, publicEstimate };
      const published = game.status === "completed" ? calculateGameChallenges(revealed, publishedChallengesAdmin(revealed, adminSnapshot.val())) : revealed;
      await firebase.update(firebase.ref(firebase.db), { [`games/${GAME_CHALLENGES.id}`]: { ...published, updatedAt: firebase.serverTimestamp() }, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async finishGameChallenges() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`)), firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))]);
      const game = calculateGameChallenges(gameSnapshot.val(), publishedChallengesAdmin(gameSnapshot.val(), adminSnapshot.val()));
      await firebase.update(firebase.ref(firebase.db), { [`games/${GAME_CHALLENGES.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetGameChallenges() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${GAME_CHALLENGES.id}`)), firebase.get(firebase.ref(firebase.db, "gameChallengesAdmin"))]);
      await firebase.update(firebase.ref(firebase.db), { [`games/${GAME_CHALLENGES.id}`]: buildGameChallenges("not-started", gameSnapshot.val()), gameChallengesAdmin: resetGameChallengesAdmin(adminSnapshot.val()), "settings/updatedAt": firebase.serverTimestamp() });
    },
    async startBalloonMonster(supply) {
      const cleanSupply = cleanBalloonSupply(supply);
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${BALLOON_MONSTER.id}`]: buildBalloonMonster("running"),
        balloonMonsterAdmin: { supply: cleanSupply, drafts: {}, updatedAt: serverNow() },
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async drawBalloonMonsterTeam() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`);
      let selectedTeamId = "";
      const result = await firebase.runTransaction(gameRef, current => {
        if (current?.status !== "running") return;
        if (current.currentTeamId) return;
        const remaining = (current.remainingTeamIds || []).filter(id => TEAMS.some(team => team.id === id));
        if (!remaining.length) return;
        selectedTeamId = remaining.length === 1 ? remaining[0] : remaining[Math.floor(Math.random() * remaining.length)];
        return announceBalloonTeam(current, selectedTeamId, remaining.length === 1);
      });
      if (!result.committed) throw new Error("Auslosung nicht möglich. Prüfe, ob der vorherige Durchgang veröffentlicht wurde.");
      await firebase.update(firebase.ref(firebase.db, "settings"), { updatedAt: firebase.serverTimestamp() });
      return selectedTeamId;
    },
    async undoBalloonMonsterDraw() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = undoBalloonDraw((await firebase.get(gameRef)).val());
      await firebase.update(firebase.ref(firebase.db), { [`games/${BALLOON_MONSTER.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async startBalloonMonsterTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentTeamId || !["spinning", "selected", "timer"].includes(game.phase)) throw new Error("Bitte zuerst ein Reich auslosen.");
      const remainingMs = game.timer?.status === "paused" ? balloonTimerRemaining(game.timer) : BALLOON_MONSTER.timerSeconds * 1000;
      if (remainingMs <= 0) throw new Error("Die Zeit ist abgelaufen. Starte jetzt den Parcours oder setze den Timer zurück.");
      const now = serverNow();
      await firebase.update(gameRef, { phase: "timer", timer: { status: "running", durationMs: BALLOON_MONSTER.timerSeconds * 1000, remainingMs, startedAt: now, endsAt: now + remainingMs }, updatedAt: firebase.serverTimestamp() });
    },
    async pauseBalloonMonsterTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || game.timer?.status !== "running") throw new Error("Der Timer läuft nicht.");
      await firebase.update(gameRef, { timer: { ...game.timer, status: "paused", remainingMs: balloonTimerRemaining(game.timer), endsAt: 0 }, updatedAt: firebase.serverTimestamp() });
    },
    async resetBalloonMonsterTimer() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentTeamId) throw new Error("Kein aktiver Durchgang.");
      await firebase.update(gameRef, { phase: "selected", timer: emptyBalloonTimer(), updatedAt: firebase.serverTimestamp() });
    },
    async startBalloonMonsterCourse() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentTeamId || game.timer?.status !== "running" || balloonTimerRemaining(game.timer) > 0) throw new Error("Der 90-Sekunden-Timer muss zuerst abgelaufen sein.");
      await firebase.update(gameRef, { phase: "course", timer: { ...game.timer, status: "finished", remainingMs: 0, endsAt: 0 }, updatedAt: firebase.serverTimestamp() });
    },
    async finishBalloonMonsterCourse() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || game.phase !== "course") throw new Error("Der Parcours läuft nicht.");
      await firebase.update(gameRef, { phase: "entry", updatedAt: firebase.serverTimestamp() });
    },
    async abortBalloonMonsterRound() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentTeamId || game.publicResults?.[game.currentTeamId]) throw new Error("Dieser Durchgang kann nicht abgebrochen werden.");
      await firebase.update(firebase.ref(firebase.db), { [`games/${BALLOON_MONSTER.id}`]: undoBalloonDraw(game), [`balloonMonsterAdmin/drafts/${game.currentTeamId}`]: null, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async saveBalloonMonsterResult(teamId, balloons) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`)), firebase.get(firebase.ref(firebase.db, "balloonMonsterAdmin"))]);
      const game = gameSnapshot.val(), admin = normaliseBalloonMonsterAdmin(adminSnapshot.val());
      if (!TEAMS.some(team => team.id === teamId) || (game?.currentTeamId !== teamId && !game?.publicResults?.[teamId])) throw new Error("Dieses Reich kann gerade nicht bearbeitet werden.");
      const draft = cleanBalloonResult(balloons, admin.supply);
      await firebase.update(firebase.ref(firebase.db), { [`balloonMonsterAdmin/drafts/${teamId}`]: draft, "balloonMonsterAdmin/updatedAt": firebase.serverTimestamp() });
    },
    async publishBalloonMonsterResult(teamId) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`)), firebase.get(firebase.ref(firebase.db, "balloonMonsterAdmin"))]);
      const game = publishBalloonResult(gameSnapshot.val(), adminSnapshot.val(), teamId);
      await firebase.update(firebase.ref(firebase.db), { [`games/${BALLOON_MONSTER.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async prepareNextBalloonMonsterTeam() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || game.phase !== "result" || !game.publicResults?.[game.currentTeamId]) throw new Error("Bitte zuerst das aktuelle Ergebnis veröffentlichen.");
      if (!(game.remainingTeamIds || []).length) throw new Error("Alle fünf Reiche haben gespielt. Schliesse jetzt das Spiel ab.");
      await firebase.update(gameRef, { phase: "wheel", currentTeamId: "", spin: null, timer: emptyBalloonTimer(), updatedAt: firebase.serverTimestamp() });
    },
    async finishBalloonMonster() {
      const gameRef = firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`), game = completeBalloonMonster((await firebase.get(gameRef)).val());
      await firebase.update(firebase.ref(firebase.db), { [`games/${BALLOON_MONSTER.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetBalloonMonster() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${BALLOON_MONSTER.id}`))).val();
      await firebase.update(firebase.ref(firebase.db), { [`games/${BALLOON_MONSTER.id}`]: buildBalloonMonster("not-started", current), balloonMonsterAdmin: null, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async startBeerPong() {
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: buildBeerPong("running"), beerPongAdmin: normaliseBeerPongAdmin(), "settings/mode": "live", "settings/updatedAt": firebase.serverTimestamp() });
    },
    async startBeerPongMatch(matchId) {
      const gameRef = firebase.ref(firebase.db, `games/${BEER_PONG.id}`), game = (await firebase.get(gameRef)).val(), match = game?.matches?.[matchId];
      validateBeerPongMatchStart(game, match);
      const now = serverNow(), timed = match.stage !== "final";
      const updates = { [`games/${BEER_PONG.id}/matches/${matchId}/status`]: "running", [`games/${BEER_PONG.id}/matches/${matchId}/startedAt`]: now, [`games/${BEER_PONG.id}/matches/${matchId}/endsAt`]: timed ? now + 6 * 60000 : 0 };
      if (match.stage === "group") updates[`games/${BEER_PONG.id}/currentRound`] = Number(match.round);
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async setBeerPongRound(roundNumber) {
      const round = Number(roundNumber), game = (await firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`))).val();
      if (game?.status !== "running" || game.phase !== "groups" || ![1, 2, 3].includes(round)) throw new Error("Diese Gruppenrunde kann nicht aufgeschaltet werden.");
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}/currentRound`]: round, [`games/${BEER_PONG.id}/updatedAt`]: firebase.serverTimestamp(), "settings/updatedAt": firebase.serverTimestamp() });
    },
    async saveBeerPongMatch(matchId, result) {
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`))).val(), match = game?.matches?.[matchId];
      if (!match) throw new Error("Match nicht gefunden.");
      const clean = cleanBeerPongResult(match, result);
      await firebase.update(firebase.ref(firebase.db), { [`beerPongAdmin/drafts/${matchId}`]: clean, "beerPongAdmin/updatedAt": firebase.serverTimestamp() });
    },
    async publishBeerPongMatch(matchId) {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const admin = normaliseBeerPongAdmin(adminSnapshot.val()), game = publishBeerPongDraft(beerPongAdminGame(gameSnapshot.val(), admin), admin, matchId);
      const updates = { [`games/${BEER_PONG.id}`]: game, [`beerPongAdmin/drafts/${matchId}`]: null, "settings/updatedAt": firebase.serverTimestamp() };
      if (matchId === "final" && !game.finalReveal) {
        updates["beerPongAdmin/finalResult"] = game.matches.final;
        updates["beerPongAdmin/finalGame"] = game.status === "completed" ? game : null;
        updates[`games/${BEER_PONG.id}`] = concealBeerPongFinal(game);
      }
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async saveBeerPongTieBreakRanks(ranks) {
      const clean = cleanBeerPongTieBreakRanks(ranks);
      await firebase.update(firebase.ref(firebase.db), { "beerPongAdmin/tieBreakRanks": clean, "beerPongAdmin/updatedAt": firebase.serverTimestamp() });
    },
    async evaluateBeerPongGroups() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const game = evaluateBeerPongGroups(gameSnapshot.val(), normaliseBeerPongAdmin(adminSnapshot.val()).tieBreakRanks);
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() });
    },
    async releaseBeerPongSemifinals() { const gameRef = firebase.ref(firebase.db, `games/${BEER_PONG.id}`), game = releaseBeerPongSemifinals((await firebase.get(gameRef)).val()); await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() }); },
    async releaseBeerPongFinal() { const gameRef = firebase.ref(firebase.db, `games/${BEER_PONG.id}`), game = releaseBeerPongFinal((await firebase.get(gameRef)).val()); await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: game, "settings/updatedAt": firebase.serverTimestamp() }); },
    async finishBeerPong() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const game = completeBeerPong(beerPongAdminGame(gameSnapshot.val(), adminSnapshot.val()));
      const updates = { [`games/${BEER_PONG.id}`]: game.finalReveal ? game : concealBeerPongFinal(game), "settings/updatedAt": firebase.serverTimestamp() };
      if (!game.finalReveal) { updates["beerPongAdmin/finalGame"] = game; updates["beerPongAdmin/finalResult"] = game.matches.final; }
      await firebase.update(firebase.ref(firebase.db), updates);
    },
    async resetBeerPongFinal() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const admin = normaliseBeerPongAdmin(adminSnapshot.val()); delete admin.drafts.final; admin.finalGame = null; admin.finalResult = null;
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: resetBeerPongFinal(gameSnapshot.val()), beerPongAdmin: admin, "settings/mode": "live", "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetBeerPongKnockouts() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const admin = normaliseBeerPongAdmin(adminSnapshot.val()); Object.keys(admin.drafts).filter(id => id.startsWith("semi-") || id === "final").forEach(id => delete admin.drafts[id]); admin.finalGame = null; admin.finalResult = null;
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: resetBeerPongKnockouts(gameSnapshot.val()), beerPongAdmin: admin, "settings/mode": "live", "settings/updatedAt": firebase.serverTimestamp() });
    },
    async revealRegnumWinner() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`)), firebase.get(firebase.ref(firebase.db, "beerPongAdmin"))]);
      const game = beerPongAdminGame(gameSnapshot.val(), adminSnapshot.val());
      if (game?.status !== "completed") throw new Error("Das Beer-Pong-Turnier ist noch nicht abgeschlossen.");
      const finalGame = completeBeerPong(game);
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: { ...finalGame, finalReveal: true, updatedAt: firebase.serverTimestamp() }, "beerPongAdmin/finalGame": null, "beerPongAdmin/finalResult": null, "settings/mode": "final", "settings/updatedAt": firebase.serverTimestamp() });
    },
    async resetBeerPong() {
      const current = (await firebase.get(firebase.ref(firebase.db, `games/${BEER_PONG.id}`))).val();
      await firebase.update(firebase.ref(firebase.db), { [`games/${BEER_PONG.id}`]: buildBeerPong("not-started", current), beerPongAdmin: null, "settings/mode": "live", "settings/updatedAt": firebase.serverTimestamp() });
    },
    deleteGame: id => firebase.remove(firebase.ref(firebase.db, `games/${id}`)),
    setMode: mode => firebase.update(firebase.ref(firebase.db, "settings"), { mode, updatedAt: firebase.serverTimestamp() }),
    async saveHuntTarget(targetId, target) {
      const clean = cleanHuntTarget(targetId, target);
      return firebase.set(firebase.ref(firebase.db, `huntAdmin/targets/${targetId}`), clean);
    },
    async startHunt() {
      const current = (await firebase.get(firebase.ref(firebase.db, "settings/hunt"))).val();
      if (current?.roundId) throw new Error("Bitte die bisherige Nachtjagd zuerst zurücksetzen.");
      const admin = (await firebase.get(firebase.ref(firebase.db, "huntAdmin/targets"))).val();
      const targets = huntTargetList(admin).map(publicHuntTarget);
      if (!targets.length) throw new Error("Mindestens ein Gegenstand muss aktiv sein.");
      const startedAt = serverNow(), roundId = startedAt.toString(36);
      await firebase.update(firebase.ref(firebase.db), {
        "huntAdmin/targets": normaliseHuntTargets(admin),
        "settings/hunt": { active: true, roundId, startedAt, stoppedAt: 0, targetCount: targets.length, targets: Object.fromEntries(targets.map(target => [target.id, target])) },
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    stopHunt() { return firebase.update(firebase.ref(firebase.db), { "settings/hunt/active": false, "settings/hunt/stoppedAt": firebase.serverTimestamp(), "settings/updatedAt": firebase.serverTimestamp() }); },
    async resetHunt() {
      const games = (await firebase.get(firebase.ref(firebase.db, "games"))).val() || {};
      const updates = { "settings/hunt": { active: false, roundId: "", startedAt: 0, stoppedAt: 0, targetCount: 10, targets: {} }, "settings/updatedAt": firebase.serverTimestamp() };
      Object.entries(games).filter(([, game]) => game?.source === "team-hunt" || game?.source === "ballon-game" || game?.source === "oracle").forEach(([id]) => { updates[`games/${id}`] = null; });
      updates["games/ballon-game"] = null;
      return firebase.update(firebase.ref(firebase.db), updates);
    },
    async claimHuntObject(roundId, target, profile) {
      profile = await ensurePlayer(profile);
      const gameId = `hunt-${roundId}-${profile.teamId}-${target.id}`;
      const gameRef = firebase.ref(firebase.db, `games/${gameId}`);
      let created = false;
      const result = await firebase.runTransaction(gameRef, current => {
        if (current) return;
        created = true;
        return { ...huntGame(roundId, target, profile, firebase.auth.currentUser.uid), createdAt: firebase.serverTimestamp(), updatedAt: firebase.serverTimestamp() };
      }, { applyLocally: false });
      return { awarded: created && result.committed, find: result.snapshot.val() };
    },
    async addHuntFind(roundId, targetId, teamId, playerName) {
      const hunt = (await firebase.get(firebase.ref(firebase.db, "settings/hunt"))).val();
      const target = hunt?.targets?.[targetId];
      if (!hunt?.roundId || hunt.roundId !== roundId || !target || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültiger Nachtjagd-Fund.");
      const gameId = `hunt-${roundId}-${teamId}-${targetId}`;
      const gameRef = firebase.ref(firebase.db, `games/${gameId}`);
      let created = false;
      const profile = { id: "admin", name: String(playerName || "Spielleitung").trim().slice(0, 32) || "Spielleitung", teamId };
      const result = await firebase.runTransaction(gameRef, current => { if (current) return; created = true; return huntGame(roundId, target, profile, firebase.auth.currentUser?.uid || "admin", true); });
      if (created && result.committed) await firebase.update(firebase.ref(firebase.db, "settings"), { updatedAt: firebase.serverTimestamp() });
      return { awarded: created && result.committed, find: result.snapshot.val() };
    },
    async removeHuntFind(roundId, targetId, teamId) {
      await firebase.update(firebase.ref(firebase.db), { [`games/hunt-${roundId}-${teamId}-${targetId}`]: null, "settings/updatedAt": firebase.serverTimestamp() });
    },
    startOracle({ question, answer, unit, minutes, maxPoints = 5 }) {
      const startedAt = serverNow();
      const roundId = startedAt.toString(36);
      const updates = {};
      updates["settings/oracle"] = { active: true, revealed: false, roundId, question, unit, maxPoints, startedAt, endsAt: startedAt + minutes * 60000, results: {} };
      updates[`oracleSecrets/${roundId}`] = { answer };
      return firebase.update(firebase.ref(firebase.db), updates);
    },
    async submitOracleAnswer(roundId, profile, value) {
      profile = await ensurePlayer(profile);
      const answerRef = firebase.ref(firebase.db, `oracleAnswers/${roundId}/${profile.teamId}`);
      let created = false;
      const result = await firebase.runTransaction(answerRef, current => {
        if (current) return;
        created = true;
        return { value, playerName: profile.name, claimantId: firebase.auth.currentUser.uid, createdAt: firebase.serverTimestamp() };
      }, { applyLocally: false });
      return { accepted: created && result.committed, answer: result.snapshot.val()?.value };
    },
    async finishOracle(state) {
      const oracle = state.settings.oracle;
      const secret = (await firebase.get(firebase.ref(firebase.db, `oracleSecrets/${oracle.roundId}`))).val();
      if (!secret || !Number.isFinite(Number(secret.answer))) throw new Error("oracle-secret-missing");
      const answers = (await firebase.get(firebase.ref(firebase.db, `oracleAnswers/${oracle.roundId}`))).val() || {};
      const result = buildOracleResult({ ...state, oracleAnswers: { [oracle.roundId]: answers } }, Number(secret.answer));
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

export function beerPongAdminGame(game, admin = {}) {
  if (!game || game.finalReveal) return game;
  if (admin.finalGame) return admin.finalGame;
  return admin.finalResult ? { ...game, matches: { ...game.matches, final: admin.finalResult } } : game;
}

function concealBeerPongFinal(game) {
  const hidden = structuredClone(game);
  const final = hidden.matches?.final;
  if (final) {
    ["cupsHitA", "cupsHitB", "winnerId", "decidedBy", "publishedAt", "savedAt"].forEach(field => delete final[field]);
    final.published = false;
    final.resultPending = true;
  }
  hidden.points = emptyTeamCounts(); hidden.ranking = []; hidden.placements = {};
  hidden.winnerIds = []; hidden.resultText = ""; hidden.finalReveal = false;
  return hidden;
}

function publishedChallengesAdmin(game, drafts, roundOverride = null) {
  const admin = normaliseGameChallengesAdmin(drafts);
  const effective = { ...admin, results: {}, estimateQuestions: game.publicEstimate?.questions ? structuredClone(game.publicEstimate.questions) : structuredClone(admin.estimateQuestions) };
  Object.values(effective.estimateQuestions).forEach(question => { question.enabled = true; });
  const rounds = { ...(game.publicRounds || {}) };
  if (roundOverride !== null) rounds[`round-${roundOverride}`] = buildChallengePublicRound(roundOverride, admin);
  Object.values(rounds).forEach(round => Object.entries(round.teams || {}).forEach(([teamId, result]) => {
    if (result.stationId !== "estimate") ((effective.results[result.stationId] ||= {})[teamId]) = result.value;
    else if (Number(round.round) === Number(roundOverride)) Object.entries(effective.estimateQuestions).forEach(([id, question]) => { question.estimates[teamId] = admin.estimateQuestions[id]?.estimates?.[teamId]; });
  }));
  return effective;
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
    subscribeSongBattleParticipants(callback) { const listener = state => callback(state.songBattleParticipants || {}); listeners.add(listener); callback(read().songBattleParticipants || {}); return () => listeners.delete(listener); },
    subscribeSongBattleAdmin(callback) { const listener = state => callback(normaliseSongBattleAdmin(state.songBattleAdmin)); listeners.add(listener); callback(normaliseSongBattleAdmin(read().songBattleAdmin)); return () => listeners.delete(listener); },
    subscribeNovitiusAdmin(callback) { const listener = state => callback(normaliseNovitiusAdmin(state.novitiusAdmin)); listeners.add(listener); callback(normaliseNovitiusAdmin(read().novitiusAdmin)); return () => listeners.delete(listener); },
    subscribeNovitiusParticipants(callback) { const listener = state => callback(state.novitiusParticipants || {}); listeners.add(listener); callback(read().novitiusParticipants || {}); return () => listeners.delete(listener); },
    subscribeNovitiusAnswers(callback) { const listener = state => callback(state.novitiusAnswers || {}); listeners.add(listener); callback(read().novitiusAnswers || {}); return () => listeners.delete(listener); },
    subscribeGameChallengesAdmin(callback) { const listener = state => callback(normaliseGameChallengesAdmin(state.gameChallengesAdmin)); listeners.add(listener); callback(normaliseGameChallengesAdmin(read().gameChallengesAdmin)); return () => listeners.delete(listener); },
    subscribeBeerPongAdmin(callback) { const listener = state => callback(normaliseBeerPongAdmin(state.beerPongAdmin)); listeners.add(listener); callback(normaliseBeerPongAdmin(read().beerPongAdmin)); return () => listeners.delete(listener); },
    subscribeBalloonMonsterAdmin(callback) { const listener = state => callback(normaliseBalloonMonsterAdmin(state.balloonMonsterAdmin)); listeners.add(listener); callback(normaliseBalloonMonsterAdmin(read().balloonMonsterAdmin)); return () => listeners.delete(listener); },
    subscribeHuntAdmin(callback) { const listener = state => callback({ targets: normaliseHuntTargets(state.huntAdmin?.targets) }); listeners.add(listener); listener(read()); return () => listeners.delete(listener); },
    async subscribeSongBattleTeam(teamId, callback) { const listener = state => { const participant = state.songBattleParticipants?.[teamId] || null; callback({ answers: state.songBattleAnswers?.[teamId] || {}, participant, owned: participant?.claimantId === getLocalProfileId() }); }; listeners.add(listener); listener(read()); return () => listeners.delete(listener); },
    async subscribeNovitiusPlayer(callback) { const participantId = getLocalProfileId(); const listener = state => callback({ participantId, participant: state.novitiusParticipants?.[participantId] || null, answers: state.novitiusAnswers?.[participantId] || {} }); listeners.add(listener); listener(read()); return () => listeners.delete(listener); },
    async saveOracleQuestion(question, id = null) { const state = read(); state.oracleQuestions[id || `question-${Date.now()}`] = { ...question, updatedAt: Date.now() }; write(state); },
    async deleteOracleQuestion(id) { const state = read(); delete state.oracleQuestions[id]; write(state); },
    auth: { login: async () => ({ user: { uid: "demo" } }), logout: async () => {}, observe: callback => { callback({ uid: "demo" }); return () => {}; } },
    async saveGame(game, id = null) { const state = read(); state.games[id || `demo-${Date.now()}`] = game; state.settings.updatedAt = Date.now(); write(state); },
    async startSongBattle() { const state = read(); state.games[SONG_BATTLE.id] = buildSongBattle("running", state.games[SONG_BATTLE.id]); state.songBattleAnswers = {}; state.songBattleParticipants = {}; state.songBattleAdmin = normaliseSongBattleAdmin(); state.settings.updatedAt = Date.now(); write(state); },
    async setSongBattleRound(songNumber) { const state = read(); const game = state.games[SONG_BATTLE.id]; const number = Number(songNumber); if (game?.status !== "running" || number < 1 || number > SONG_BATTLE.songCount) throw new Error("Ungültige Songrunde."); if (game.revealedSongs?.[`song-${number}`]) throw new Error("Dieser Song wurde bereits aufgelöst und kann nicht erneut geöffnet werden."); game.currentSong = number; game.answersOpen = true; game.controlUpdatedAt = Date.now(); write(state); },
    async setSongBattleAnswersOpen(open) { const state = read(); const game = state.games[SONG_BATTLE.id]; if (game?.status !== "running") throw new Error("Song Battle läuft nicht."); if (open && game.revealedSongs?.[`song-${game.currentSong}`]) throw new Error("Ein aufgelöster Song kann nicht erneut geöffnet werden."); game.answersOpen = !!open; game.controlUpdatedAt = Date.now(); write(state); },
    async claimSongBattleTeam(profile) { const state = read(); const current = state.songBattleParticipants[profile.teamId]; if (!current) state.songBattleParticipants[profile.teamId] = { claimantId: profile.id, playerName: profile.name, joinedAt: Date.now() }; write(state); const participant = state.songBattleParticipants[profile.teamId]; return { claimed: participant.claimantId === profile.id, participant }; },
    async releaseSongBattleTeam(teamId) { const state = read(); delete state.songBattleParticipants[teamId]; delete state.songBattleAnswers[teamId]; write(state); },
    async submitSongBattleAnswer(songNumber, profile, title, artist) { const state = read(); const game = state.games[SONG_BATTLE.id]; if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || !game.answersOpen) throw new Error("song-battle-closed"); if (state.songBattleParticipants?.[profile.teamId]?.claimantId !== profile.id) throw new Error("song-battle-not-participant"); const cleanTitle = title.trim().slice(0, 120), cleanArtist = artist.trim().slice(0, 120); if (!cleanTitle && !cleanArtist) throw new Error("song-battle-empty"); const answer = { songNumber: Number(songNumber), title: cleanTitle, artist: cleanArtist, playerName: profile.name, claimantId: profile.id, updatedAt: Date.now() }; ((state.songBattleAnswers[profile.teamId] ||= {})[`song-${songNumber}`]) = answer; write(state); return answer; },
    async saveSongBattleEvaluation(songNumber, teamId, field, value) { const state = read(); if (!['title', 'artist'].includes(field) || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültige Bewertung."); const admin = state.songBattleAdmin = normaliseSongBattleAdmin(state.songBattleAdmin); (((admin.evaluations[`song-${songNumber}`] ||= {})[teamId] ||= {}))[field] = value === true; admin.internalPoints = songBattleScores(admin.evaluations); admin.evaluationUpdatedAt = Date.now(); if (state.games[SONG_BATTLE.id]?.revealedSongs?.[`song-${songNumber}`]) state.games[SONG_BATTLE.id].publicReveals[`song-${songNumber}`] = buildSongPublicReveal(state.songBattleAnswers, admin.evaluations, songNumber); write(state); },
    async revealSongBattleSong(songNumber) { const state = read(); const game = state.games[SONG_BATTLE.id]; if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || game.answersOpen) throw new Error("Antworten zuerst sperren."); const key = `song-${songNumber}`; (game.revealedSongs ||= {})[key] = true; (game.publicReveals ||= {})[key] = buildSongPublicReveal(state.songBattleAnswers, state.songBattleAdmin.evaluations, songNumber, true); game.controlUpdatedAt = Date.now(); write(state); },
    async finishSongBattle() { const state = read(); state.games[SONG_BATTLE.id] = finalizeSongBattle(state.games[SONG_BATTLE.id], normaliseSongBattleAdmin(state.songBattleAdmin).evaluations); state.settings.updatedAt = Date.now(); write(state); },
    async resetSongBattle() { const state = read(); state.games[SONG_BATTLE.id] = buildSongBattle("not-started", state.games[SONG_BATTLE.id]); state.songBattleAnswers = {}; state.songBattleParticipants = {}; state.songBattleAdmin = normaliseSongBattleAdmin(); state.settings.updatedAt = Date.now(); write(state); },
    async saveNovitiusQuestion(number, question) { const state = read(); state.novitiusAdmin = normaliseNovitiusAdmin(state.novitiusAdmin); const clean = cleanNovitiusQuestion(number, question); state.novitiusAdmin.questions[`question-${number}`] = clean; const game = state.games[NOVITIUS_GAME.id]; if (game?.revealedQuestions?.[`question-${number}`] && clean.correctValue !== "") { applyStoredNovitiusScores(state.novitiusAdmin.questions, state.novitiusAnswers, game.revealedQuestions); game.publicReveals = rebuildNovitiusReveals(state.novitiusAdmin.questions, state.novitiusParticipants, state.novitiusAnswers, game.teamSizes, game.revealedQuestions); if (game.status === "completed") state.games[NOVITIUS_GAME.id] = refinalizeNovitiusOrPending(game, state.novitiusAdmin.questions, state.novitiusParticipants, state.novitiusAnswers); } write(state); },
    async startNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = buildNovitiusGame("running", null); state.novitiusParticipants = {}; state.novitiusAnswers = {}; state.novitiusSubmissions = {}; state.novitiusAdmin = normaliseNovitiusAdmin(state.novitiusAdmin); state.novitiusAdmin.liveResult = null; state.novitiusAdmin.questions["question-10"].correctValue = ""; state.settings.updatedAt = Date.now(); write(state); },
    async setNovitiusRegistration(open) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion || 0) > 0) throw new Error("Die Anmeldung kann nach Frage 1 nicht mehr geändert werden."); game.registrationOpen = !!open; game.participantsLocked = !open; game.teamSizes = open ? emptyTeamCounts() : novitiusTeamSizes(state.novitiusParticipants); game.controlUpdatedAt = Date.now(); write(state); },
    async claimNovitiusParticipant(profile) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || !game.registrationOpen) throw new Error("novitius-registration-closed"); const participantId = profile.id; state.novitiusParticipants[participantId] ||= { claimantId: participantId, playerName: profile.name, teamId: profile.teamId, joinedAt: Date.now() }; write(state); return { participantId, participant: state.novitiusParticipants[participantId] }; },
    async removeNovitiusParticipant(participantId) { const state = read(); delete state.novitiusParticipants[participantId]; delete state.novitiusAnswers[participantId]; write(state); },
    async startNovitiusQuestion(number) { const state = read(); const questionNumber = Number(number); if (questionNumber < 1 || questionNumber > NOVITIUS_GAME.questionCount) throw new Error("Ungültige Frage."); const question = normaliseNovitiusAdmin(state.novitiusAdmin).questions[`question-${questionNumber}`]; if (!question?.text) throw new Error("Diese Frage ist noch nicht vorbereitet."); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running") throw new Error("Das Spiel läuft nicht."); if (game.revealedQuestions?.[`question-${questionNumber}`]) throw new Error("Diese Frage wurde bereits aufgelöst und kann nicht erneut geöffnet werden."); if (game.questionStates?.[`question-${questionNumber}`] && game.questionStates[`question-${questionNumber}`] !== "locked") throw new Error("Diese Frage wurde bereits freigegeben."); if (questionNumber > 1 && !game.revealedQuestions?.[`question-${questionNumber - 1}`]) throw new Error("Bitte zuerst die vorherige Frage auflösen."); if (!game.participantsLocked) game.teamSizes = novitiusTeamSizes(state.novitiusParticipants); if (!Object.values(game.teamSizes || {}).some(Number)) throw new Error("Es ist noch niemand angemeldet."); game.registrationOpen = false; game.participantsLocked = true; game.currentQuestion = questionNumber; game.currentQuestionData = publicNovitiusQuestion(question); game.answersOpen = true; (game.questionStates ||= {})[`question-${questionNumber}`] = "open"; game.controlUpdatedAt = Date.now(); write(state); },
    async setNovitiusAnswersOpen(open) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || !game.currentQuestion) throw new Error("Es läuft noch keine Frage."); if (open && game.revealedQuestions?.[`question-${game.currentQuestion}`]) throw new Error("Eine aufgelöste Frage kann nicht erneut geöffnet werden."); if (open && game.questionStates?.[`question-${game.currentQuestion}`] === "closed") throw new Error("Eine geschlossene Frage kann nicht erneut geöffnet werden."); game.answersOpen = !!open; (game.questionStates ||= {})[`question-${game.currentQuestion}`] = open ? "open" : "closed"; game.controlUpdatedAt = Date.now(); write(state); },
    async submitNovitiusAnswer(questionNumber, profile, value) { const state = read(); const participantId = profile.id; const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || !game.answersOpen) throw new Error("novitius-answers-closed"); const participant = state.novitiusParticipants?.[participantId]; if (!participant || participant.teamId !== profile.teamId) throw new Error("novitius-not-registered"); const key = `question-${questionNumber}`; if (state.novitiusAnswers?.[participantId]?.[key]) throw new Error("novitius-answer-exists"); const answer = { value: cleanNovitiusAnswerValue(game.currentQuestionData, value), playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, createdAt: Date.now(), updatedAt: Date.now() }; ((state.novitiusAnswers[participantId] ||= {})[key]) = answer; ((state.novitiusSubmissions[key] ||= {})[participantId]) = { teamId: participant.teamId, createdAt: Date.now() }; write(state); return answer; },
    async revealNovitiusQuestion(questionNumber) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || game.answersOpen) throw new Error("Antworten zuerst sperren."); const questions = normaliseNovitiusAdmin(state.novitiusAdmin).questions; const key = `question-${questionNumber}`; if (questions[key].correctValue === "" || questions[key].correctValue === null || questions[key].correctValue === undefined) throw new Error("Bitte zuerst Simons korrekte Antwort eintragen."); (game.revealedQuestions ||= {})[key] = true; (game.questionStates ||= {})[key] = "revealed"; applyStoredNovitiusScores(questions, state.novitiusAnswers, game.revealedQuestions); game.publicReveals = rebuildNovitiusReveals(questions, state.novitiusParticipants, state.novitiusAnswers, game.teamSizes, game.revealedQuestions); game.controlUpdatedAt = Date.now(); write(state); },
    async correctNovitiusAnswer(participantId, questionNumber, value) { const state = read(); const participant = state.novitiusParticipants?.[participantId]; if (!participant) throw new Error("Teilnehmende Person nicht gefunden."); const key = `question-${questionNumber}`, questions = normaliseNovitiusAdmin(state.novitiusAdmin).questions, game = state.games[NOVITIUS_GAME.id], previous = state.novitiusAnswers?.[participantId]?.[key] || {}; const corrected = { ...previous, value: cleanNovitiusAnswerValue(questions[key], value), playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, correctedByAdmin: true, createdAt: previous.createdAt || Date.now(), updatedAt: Date.now() }; if (game.revealedQuestions?.[key]) Object.assign(corrected, storedNovitiusScore(questions[key], corrected.value)); ((state.novitiusAnswers[participantId] ||= {})[key]) = corrected; ((state.novitiusSubmissions[key] ||= {})[participantId]) = { teamId: participant.teamId, createdAt: Date.now() }; game.publicReveals = rebuildNovitiusReveals(questions, state.novitiusParticipants, state.novitiusAnswers, game.teamSizes, game.revealedQuestions); if (game.status === "completed") state.games[NOVITIUS_GAME.id] = refinalizeNovitiusOrPending(game, questions, state.novitiusParticipants, state.novitiusAnswers); state.settings.updatedAt = Date.now(); write(state); },
    async setNovitiusLiveResult(value) { const state = read(), number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error("Bitte eine gültige ganze Zahl eingeben."); state.novitiusAdmin.liveResult = number; state.novitiusAdmin.questions["question-10"].correctValue = number; write(state); },
    async saveNovitiusTieBreak(tieBreak) { const state = read(); state.games[NOVITIUS_GAME.id].tieBreak = { question: String(tieBreak.question || "").trim().slice(0, 180), correctValue: Number(tieBreak.correctValue), answers: tieBreak.answers, ranking: buildTieBreakRanking(tieBreak), resolvedAt: Date.now() }; write(state); },
    async finishNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = finalizeNovitiusGame(state.games[NOVITIUS_GAME.id], normaliseNovitiusAdmin(state.novitiusAdmin).questions, state.novitiusParticipants, state.novitiusAnswers); state.settings.updatedAt = Date.now(); write(state); },
    async resetNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = buildNovitiusGame("not-started", state.games[NOVITIUS_GAME.id]); state.novitiusParticipants = {}; state.novitiusAnswers = {}; state.novitiusSubmissions = {}; state.novitiusAdmin.liveResult = null; state.novitiusAdmin.questions["question-10"].correctValue = ""; state.settings.updatedAt = Date.now(); write(state); },
    async startGameChallenges() { const state = read(); state.games[GAME_CHALLENGES.id] = buildGameChallenges("running"); state.gameChallengesAdmin = resetGameChallengesAdmin(state.gameChallengesAdmin); state.settings.updatedAt = Date.now(); write(state); },
    async startGameChallengeTimer() { const state = read(), game = state.games[GAME_CHALLENGES.id]; if (game?.status !== "running") throw new Error("Game Challenges laufen nicht."); const remainingMs = game.timer?.status === "idle" ? GAME_CHALLENGES.durationSeconds * 1000 : challengeTimerRemaining(game.timer), now = Date.now(); if (remainingMs <= 0) throw new Error("Die Zeit ist abgelaufen. Bitte die Runde beenden oder den Timer zurücksetzen."); game.phase = "running"; game.timer = { status: "running", durationMs: GAME_CHALLENGES.durationSeconds * 1000, remainingMs, startedAt: now, endsAt: now + remainingMs }; game.updatedAt = now; write(state); },
    async pauseGameChallengeTimer() { const state = read(), game = state.games[GAME_CHALLENGES.id]; if (game?.status !== "running" || game.timer?.status !== "running") throw new Error("Der Timer läuft nicht."); game.timer = { ...game.timer, status: "paused", remainingMs: challengeTimerRemaining(game.timer), endsAt: 0 }; game.phase = "paused"; game.updatedAt = Date.now(); write(state); },
    async resetGameChallengeTimer() { const state = read(), game = state.games[GAME_CHALLENGES.id]; if (game?.status !== "running") throw new Error("Game Challenges laufen nicht."); game.phase = "ready"; game.timer = emptyChallengeTimer(); game.updatedAt = Date.now(); write(state); },
    async endGameChallengeRound() { const state = read(), game = state.games[GAME_CHALLENGES.id]; if (game?.status !== "running") throw new Error("Game Challenges laufen nicht."); game.phase = "results"; game.timer = { ...emptyChallengeTimer(), status: "finished", remainingMs: 0 }; game.updatedAt = Date.now(); write(state); },
    async saveGameChallengeRound(roundNumber, entries) { const state = read(); let game = state.games[GAME_CHALLENGES.id]; state.gameChallengesAdmin = applyChallengeRoundEntries(state.gameChallengesAdmin, roundNumber, entries); if (game?.roundPublished?.[`round-${roundNumber}`]) (game.publicRounds ||= {})[`round-${roundNumber}`] = buildChallengePublicRound(roundNumber, state.gameChallengesAdmin); if (game?.estimateRevealed) game.publicEstimate = buildPublicEstimate(state.gameChallengesAdmin); if (game?.status === "completed") state.games[GAME_CHALLENGES.id] = calculateGameChallenges(game, state.gameChallengesAdmin); state.settings.updatedAt = Date.now(); write(state); },
    async publishGameChallengeRound(roundNumber) { const state = read(), game = state.games[GAME_CHALLENGES.id]; if (game?.status !== "running" && game?.status !== "completed") throw new Error("Game Challenges sind nicht gestartet."); (game.roundPublished ||= {})[`round-${roundNumber}`] = true; (game.publicRounds ||= {})[`round-${roundNumber}`] = buildChallengePublicRound(roundNumber, state.gameChallengesAdmin); if (Number(game.currentRound) === Number(roundNumber)) game.phase = "published"; game.updatedAt = Date.now(); write(state); },
    async nextGameChallengeRound() { const state = read(), game = state.games[GAME_CHALLENGES.id], current = Number(game?.currentRound || 0); if (game?.status !== "running" || current >= GAME_CHALLENGES.roundCount) throw new Error("Keine weitere Runde verfügbar."); if (!game.roundPublished?.[`round-${current}`]) throw new Error("Bitte zuerst die aktuelle Runde veröffentlichen."); game.currentRound = current + 1; game.phase = "ready"; game.timer = emptyChallengeTimer(); game.updatedAt = Date.now(); write(state); },
    async saveGameChallengeEstimateQuestion(questionId, question) { const state = read(); let game = state.games[GAME_CHALLENGES.id], admin = state.gameChallengesAdmin = normaliseGameChallengesAdmin(state.gameChallengesAdmin); admin.estimateQuestions[questionId] = cleanEstimateQuestion(questionId, { ...admin.estimateQuestions[questionId], ...question, estimates: admin.estimateQuestions[questionId]?.estimates || {} }); admin.updatedAt = Date.now(); if (game?.estimateRevealed) game.publicEstimate = buildPublicEstimate(admin); if (game?.status === "completed") state.games[GAME_CHALLENGES.id] = calculateGameChallenges(game, admin); write(state); },
    async revealGameChallengeEstimate() { const state = read(), game = state.games[GAME_CHALLENGES.id]; for (let round = 1; round <= GAME_CHALLENGES.roundCount; round += 1) if (!game?.roundPublished?.[`round-${round}`]) throw new Error("Die Schätz-Challenge darf erst nach allen fünf Runden aufgelöst werden."); game.estimateRevealed = true; game.publicEstimate = buildPublicEstimate(state.gameChallengesAdmin); game.updatedAt = Date.now(); write(state); },
    async finishGameChallenges() { const state = read(); state.games[GAME_CHALLENGES.id] = calculateGameChallenges(state.games[GAME_CHALLENGES.id], state.gameChallengesAdmin); state.settings.updatedAt = Date.now(); write(state); },
    async resetGameChallenges() { const state = read(); state.games[GAME_CHALLENGES.id] = buildGameChallenges("not-started", state.games[GAME_CHALLENGES.id]); state.gameChallengesAdmin = resetGameChallengesAdmin(state.gameChallengesAdmin); state.settings.updatedAt = Date.now(); write(state); },
    async startBalloonMonster(supply) { const state = read(); state.games[BALLOON_MONSTER.id] = buildBalloonMonster("running"); state.balloonMonsterAdmin = { supply: cleanBalloonSupply(supply), drafts: {}, updatedAt: Date.now() }; state.settings.updatedAt = Date.now(); write(state); },
    async drawBalloonMonsterTeam() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || game.currentTeamId || !(game.remainingTeamIds || []).length) throw new Error("Auslosung nicht möglich. Prüfe, ob der vorherige Durchgang veröffentlicht wurde."); const remaining = game.remainingTeamIds, teamId = remaining.length === 1 ? remaining[0] : remaining[Math.floor(Math.random() * remaining.length)]; state.games[BALLOON_MONSTER.id] = announceBalloonTeam(game, teamId, remaining.length === 1); state.settings.updatedAt = Date.now(); write(state); return teamId; },
    async undoBalloonMonsterDraw() { const state = read(); state.games[BALLOON_MONSTER.id] = undoBalloonDraw(state.games[BALLOON_MONSTER.id]); state.settings.updatedAt = Date.now(); write(state); },
    async startBalloonMonsterTimer() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || !game.currentTeamId || !["spinning", "selected", "timer"].includes(game.phase)) throw new Error("Bitte zuerst ein Reich auslosen."); const remainingMs = game.timer?.status === "paused" ? balloonTimerRemaining(game.timer) : BALLOON_MONSTER.timerSeconds * 1000; if (remainingMs <= 0) throw new Error("Die Zeit ist abgelaufen. Starte jetzt den Parcours oder setze den Timer zurück."); const now = Date.now(); game.phase = "timer"; game.timer = { status: "running", durationMs: BALLOON_MONSTER.timerSeconds * 1000, remainingMs, startedAt: now, endsAt: now + remainingMs }; game.updatedAt = now; write(state); },
    async pauseBalloonMonsterTimer() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || game.timer?.status !== "running") throw new Error("Der Timer läuft nicht."); game.timer = { ...game.timer, status: "paused", remainingMs: balloonTimerRemaining(game.timer), endsAt: 0 }; game.updatedAt = Date.now(); write(state); },
    async resetBalloonMonsterTimer() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || !game.currentTeamId) throw new Error("Kein aktiver Durchgang."); game.phase = "selected"; game.timer = emptyBalloonTimer(); game.updatedAt = Date.now(); write(state); },
    async startBalloonMonsterCourse() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || !game.currentTeamId || game.timer?.status !== "running" || balloonTimerRemaining(game.timer) > 0) throw new Error("Der 90-Sekunden-Timer muss zuerst abgelaufen sein."); game.phase = "course"; game.timer = { ...game.timer, status: "finished", remainingMs: 0, endsAt: 0 }; game.updatedAt = Date.now(); write(state); },
    async finishBalloonMonsterCourse() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || game.phase !== "course") throw new Error("Der Parcours läuft nicht."); game.phase = "entry"; game.updatedAt = Date.now(); write(state); },
    async abortBalloonMonsterRound() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || !game.currentTeamId || game.publicResults?.[game.currentTeamId]) throw new Error("Dieser Durchgang kann nicht abgebrochen werden."); const teamId = game.currentTeamId; state.games[BALLOON_MONSTER.id] = undoBalloonDraw(game); state.balloonMonsterAdmin = normaliseBalloonMonsterAdmin(state.balloonMonsterAdmin); delete state.balloonMonsterAdmin.drafts[teamId]; state.settings.updatedAt = Date.now(); write(state); },
    async saveBalloonMonsterResult(teamId, balloons) { const state = read(), game = state.games[BALLOON_MONSTER.id], admin = state.balloonMonsterAdmin = normaliseBalloonMonsterAdmin(state.balloonMonsterAdmin); if (!TEAMS.some(team => team.id === teamId) || (game?.currentTeamId !== teamId && !game?.publicResults?.[teamId])) throw new Error("Dieses Reich kann gerade nicht bearbeitet werden."); admin.drafts[teamId] = cleanBalloonResult(balloons, admin.supply); admin.updatedAt = Date.now(); write(state); },
    async publishBalloonMonsterResult(teamId) { const state = read(); state.games[BALLOON_MONSTER.id] = publishBalloonResult(state.games[BALLOON_MONSTER.id], state.balloonMonsterAdmin, teamId); state.settings.updatedAt = Date.now(); write(state); },
    async prepareNextBalloonMonsterTeam() { const state = read(), game = state.games[BALLOON_MONSTER.id]; if (game?.status !== "running" || game.phase !== "result" || !game.publicResults?.[game.currentTeamId]) throw new Error("Bitte zuerst das aktuelle Ergebnis veröffentlichen."); if (!(game.remainingTeamIds || []).length) throw new Error("Alle fünf Reiche haben gespielt. Schliesse jetzt das Spiel ab."); game.phase = "wheel"; game.currentTeamId = ""; game.spin = null; game.timer = emptyBalloonTimer(); game.updatedAt = Date.now(); write(state); },
    async finishBalloonMonster() { const state = read(); state.games[BALLOON_MONSTER.id] = completeBalloonMonster(state.games[BALLOON_MONSTER.id]); state.settings.updatedAt = Date.now(); write(state); },
    async resetBalloonMonster() { const state = read(); state.games[BALLOON_MONSTER.id] = buildBalloonMonster("not-started", state.games[BALLOON_MONSTER.id]); state.balloonMonsterAdmin = normaliseBalloonMonsterAdmin(); state.settings.updatedAt = Date.now(); write(state); },
    async startBeerPong() { const state = read(); state.games[BEER_PONG.id] = buildBeerPong("running"); state.beerPongAdmin = normaliseBeerPongAdmin(); state.settings.mode = "live"; state.settings.updatedAt = Date.now(); write(state); },
    async startBeerPongMatch(matchId) { const state = read(), game = state.games[BEER_PONG.id], match = game?.matches?.[matchId]; validateBeerPongMatchStart(game, match); const now = Date.now(); match.status = "running"; match.startedAt = now; match.endsAt = match.stage === "final" ? 0 : now + 6 * 60000; if (match.stage === "group") game.currentRound = Number(match.round); write(state); },
    async setBeerPongRound(roundNumber) { const state = read(), game = state.games[BEER_PONG.id], round = Number(roundNumber); if (game?.status !== "running" || game.phase !== "groups" || ![1, 2, 3].includes(round)) throw new Error("Diese Gruppenrunde kann nicht aufgeschaltet werden."); game.currentRound = round; game.updatedAt = Date.now(); state.settings.updatedAt = Date.now(); write(state); },
    async saveBeerPongMatch(matchId, result) { const state = read(), match = state.games[BEER_PONG.id]?.matches?.[matchId]; if (!match) throw new Error("Match nicht gefunden."); state.beerPongAdmin = normaliseBeerPongAdmin(state.beerPongAdmin); state.beerPongAdmin.drafts[matchId] = cleanBeerPongResult(match, result); state.beerPongAdmin.updatedAt = Date.now(); write(state); },
    async publishBeerPongMatch(matchId) { const state = read(); state.beerPongAdmin = normaliseBeerPongAdmin(state.beerPongAdmin); state.games[BEER_PONG.id] = publishBeerPongDraft(state.games[BEER_PONG.id], state.beerPongAdmin, matchId); delete state.beerPongAdmin.drafts[matchId]; state.settings.updatedAt = Date.now(); write(state); },
    async saveBeerPongTieBreakRanks(ranks) { const state = read(); state.beerPongAdmin = normaliseBeerPongAdmin(state.beerPongAdmin); state.beerPongAdmin.tieBreakRanks = cleanBeerPongTieBreakRanks(ranks); state.beerPongAdmin.updatedAt = Date.now(); write(state); },
    async evaluateBeerPongGroups() { const state = read(); state.games[BEER_PONG.id] = evaluateBeerPongGroups(state.games[BEER_PONG.id], normaliseBeerPongAdmin(state.beerPongAdmin).tieBreakRanks); state.settings.updatedAt = Date.now(); write(state); },
    async releaseBeerPongSemifinals() { const state = read(); state.games[BEER_PONG.id] = releaseBeerPongSemifinals(state.games[BEER_PONG.id]); state.settings.updatedAt = Date.now(); write(state); },
    async releaseBeerPongFinal() { const state = read(); state.games[BEER_PONG.id] = releaseBeerPongFinal(state.games[BEER_PONG.id]); state.settings.updatedAt = Date.now(); write(state); },
    async finishBeerPong() { const state = read(); state.games[BEER_PONG.id] = completeBeerPong(state.games[BEER_PONG.id]); state.settings.updatedAt = Date.now(); write(state); },
    async resetBeerPongFinal() { const state = read(); state.games[BEER_PONG.id] = resetBeerPongFinal(state.games[BEER_PONG.id]); state.beerPongAdmin = normaliseBeerPongAdmin(state.beerPongAdmin); delete state.beerPongAdmin.drafts.final; state.settings.mode = "live"; state.settings.updatedAt = Date.now(); write(state); },
    async resetBeerPongKnockouts() { const state = read(); state.games[BEER_PONG.id] = resetBeerPongKnockouts(state.games[BEER_PONG.id]); state.beerPongAdmin = normaliseBeerPongAdmin(state.beerPongAdmin); Object.keys(state.beerPongAdmin.drafts).filter(id => id.startsWith("semi-") || id === "final").forEach(id => delete state.beerPongAdmin.drafts[id]); state.settings.mode = "live"; state.settings.updatedAt = Date.now(); write(state); },
    async revealRegnumWinner() { const state = read(), game = state.games[BEER_PONG.id]; if (game?.status !== "completed") throw new Error("Das Beer-Pong-Turnier ist noch nicht abgeschlossen."); game.finalReveal = true; state.settings.mode = "final"; state.settings.updatedAt = Date.now(); write(state); },
    async resetBeerPong() { const state = read(); state.games[BEER_PONG.id] = buildBeerPong("not-started", state.games[BEER_PONG.id]); state.beerPongAdmin = normaliseBeerPongAdmin(); state.settings.mode = "live"; state.settings.updatedAt = Date.now(); write(state); },
    async deleteGame(id) { const state = read(); delete state.games[id]; state.settings.updatedAt = Date.now(); write(state); },
    async setMode(mode) { const state = read(); state.settings = { ...state.settings, mode, updatedAt: Date.now() }; write(state); },
    async saveHuntTarget(targetId, target) { const state = read(); state.huntAdmin ||= { targets: {} }; state.huntAdmin.targets = normaliseHuntTargets(state.huntAdmin.targets); state.huntAdmin.targets[targetId] = cleanHuntTarget(targetId, target); write(state); },
    async startHunt() { const state = read(); if (state.settings.hunt?.roundId) throw new Error("Bitte die bisherige Nachtjagd zuerst zurücksetzen."); state.huntAdmin ||= { targets: {} }; state.huntAdmin.targets = normaliseHuntTargets(state.huntAdmin.targets); const targets = huntTargetList(state.huntAdmin.targets).map(publicHuntTarget); if (!targets.length) throw new Error("Mindestens ein Gegenstand muss aktiv sein."); const startedAt = Date.now(); state.settings.hunt = { active: true, roundId: startedAt.toString(36), startedAt, stoppedAt: 0, targetCount: targets.length, targets: Object.fromEntries(targets.map(target => [target.id, target])) }; state.settings.updatedAt = Date.now(); write(state); },
    async stopHunt() { const state = read(); state.settings.hunt = { ...(state.settings.hunt || {}), active: false, stoppedAt: Date.now() }; state.settings.updatedAt = Date.now(); write(state); },
    async resetHunt() { const state = read(); Object.entries(state.games).filter(([, game]) => game?.source === "team-hunt" || game?.source === "ballon-game" || game?.source === "oracle").forEach(([id]) => delete state.games[id]); delete state.games["ballon-game"]; state.settings.hunt = { active: false, roundId: "", startedAt: 0, stoppedAt: 0, targetCount: 10, targets: {} }; state.settings.updatedAt = Date.now(); write(state); },
    async claimHuntObject(roundId, target, profile) {
      const state = read();
      const hunt = state.settings.hunt || {};
      if (!hunt.active || hunt.roundId !== roundId || !hunt.targets?.[target.id]) throw new Error("hunt-closed");
      const id = `hunt-${roundId}-${profile.teamId}-${target.id}`;
      if (state.games[id]) return { awarded: false, find: state.games[id] };
      state.games[id] = huntGame(roundId, target, profile, profile.id);
      state.settings.updatedAt = Date.now();
      write(state);
      return { awarded: true, find: state.games[id] };
    },
    async addHuntFind(roundId, targetId, teamId, playerName) { const state = read(); const hunt = state.settings.hunt || {}, target = hunt.targets?.[targetId]; if (!hunt.roundId || hunt.roundId !== roundId || !target || !TEAMS.some(team => team.id === teamId)) throw new Error("Ungültiger Nachtjagd-Fund."); const id = `hunt-${roundId}-${teamId}-${targetId}`; if (state.games[id]) return { awarded: false, find: state.games[id] }; state.games[id] = huntGame(roundId, target, { id: "admin", name: String(playerName || "Spielleitung").trim().slice(0, 32) || "Spielleitung", teamId }, "admin", true); state.settings.updatedAt = Date.now(); write(state); return { awarded: true, find: state.games[id] }; },
    async removeHuntFind(roundId, targetId, teamId) { const state = read(); delete state.games[`hunt-${roundId}-${teamId}-${targetId}`]; state.settings.updatedAt = Date.now(); write(state); },
    async startOracle({ question, answer, unit, minutes, maxPoints = 5 }) { const state = read(); const startedAt = Date.now(); state.settings.oracle = { active: true, revealed: false, roundId: startedAt.toString(36), question, answer, unit, maxPoints, startedAt, endsAt: startedAt + minutes * 60000, results: {} }; write(state); },
    async submitOracleAnswer(roundId, profile, value) { const state = read(); const oracle = state.settings.oracle || {}; if (!oracle.active || oracle.roundId !== roundId || oracle.endsAt <= Date.now()) throw new Error("oracle-closed"); const round = state.oracleAnswers[roundId] ||= {}; if (round[profile.teamId]) return { accepted: false, answer: round[profile.teamId].value }; round[profile.teamId] = { value, playerName: profile.name, claimantId: profile.id, createdAt: Date.now() }; write(state); return { accepted: true, answer: value }; },
    async finishOracle(state) { const latest = read(); const result = buildOracleResult(state || latest); latest.games[`oracle-${result.roundId}`] = result.game; latest.settings.oracle = { ...latest.settings.oracle, active: false, revealed: true, results: result.results }; latest.settings.updatedAt = Date.now(); write(latest); },
    async hideOracle() { const state = read(); state.settings.oracle = { ...state.settings.oracle, active: false, revealed: false }; write(state); }
  };
}

function huntGame(roundId, target, profile, claimantId, manual = false) {
  const points = Object.fromEntries(TEAMS.map(team => [team.id, team.id === profile.teamId ? HUNT_POINTS_PER_OBJECT : 0]));
  return {
    name: `Nachtjagd · Gegenstand ${target.number}`,
    round: "Die zehn Zeichen",
    resultText: `Gegenstand ${target.number} gefunden von ${profile.name}`,
    points,
    source: "team-hunt",
    roundId,
    targetId: target.id,
    targetNumber: Number(target.number),
    claimantId,
    playerName: profile.name,
    teamId: profile.teamId,
    manual: !!manual,
    awardedPoints: HUNT_POINTS_PER_OBJECT,
    createdAt: serverNow(),
    updatedAt: serverNow()
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
    songBattleParticipants: value?.songBattleParticipants || {},
    songBattleAdmin: normaliseSongBattleAdmin(value?.songBattleAdmin),
    novitiusParticipants: value?.novitiusParticipants || {},
    novitiusAnswers: value?.novitiusAnswers || {},
    novitiusSubmissions: value?.novitiusSubmissions || {},
    novitiusAdmin: normaliseNovitiusAdmin(value?.novitiusAdmin),
    gameChallengesAdmin: normaliseGameChallengesAdmin(value?.gameChallengesAdmin),
    balloonMonsterAdmin: normaliseBalloonMonsterAdmin(value?.balloonMonsterAdmin),
    beerPongAdmin: normaliseBeerPongAdmin(value?.beerPongAdmin),
    huntAdmin: { targets: normaliseHuntTargets(value?.huntAdmin?.targets) },
    oracleAnswers: value?.oracleAnswers || {},
    oracleQuestions: value?.oracleQuestions || {}
  };
}

function resetGameChallengesAdmin(value = null) {
  const admin = normaliseGameChallengesAdmin(value);
  admin.results = {};
  Object.values(admin.estimateQuestions).forEach(question => { question.estimates = {}; });
  admin.updatedAt = serverNow();
  return admin;
}

function applyChallengeRoundEntries(value, roundNumber, entries = {}) {
  const admin = normaliseGameChallengesAdmin(value), assignments = GAME_CHALLENGE_ROTATIONS[`round-${Number(roundNumber)}`];
  if (!assignments) throw new Error("Ungültige Runde.");
  const activeQuestions = challengeEstimateQuestions(admin);
  TEAMS.forEach(team => {
    const stationId = assignments[team.id], entry = entries[team.id] || {};
    if (stationId === "estimate") {
      activeQuestions.forEach(question => { admin.estimateQuestions[question.id].estimates[team.id] = cleanEstimateValue(entry.estimates?.[question.id]); });
    } else {
      ((admin.results[stationId] ||= {}))[team.id] = cleanChallengeResult(stationId, entry.value);
    }
  });
  admin.updatedAt = serverNow();
  return admin;
}

function validateBeerPongMatchStart(game, match) {
  if (game?.status !== "running") throw new Error("Das Beer-Pong-Turnier läuft nicht.");
  if (!match) throw new Error("Match nicht gefunden.");
  if (match.published || match.status === "completed") throw new Error("Dieses Match ist bereits abgeschlossen. Korrekturen direkt beim Resultat erfassen.");
  const expectedPhase = match.stage === "group" ? "groups" : match.stage === "semifinal" ? "semifinals" : "final";
  if (game.phase !== expectedPhase) throw new Error("Dieses Match ist in der aktuellen Turnierphase noch nicht freigegeben.");
}

function publishBeerPongDraft(gameValue, adminValue, matchId) {
  let game = { ...(gameValue || {}), matches: { ...(gameValue?.matches || {}) } };
  const admin = normaliseBeerPongAdmin(adminValue), original = game.matches?.[matchId], draft = admin.drafts?.[matchId];
  if (!original) throw new Error("Match nicht gefunden.");
  if (!draft) throw new Error("Bitte das Resultat zuerst speichern und kontrollieren.");
  const correction = !!original.published;
  if (correction && original.stage === "group") {
    if (game.semifinalsReleased) {
      const knockouts = Object.values(game.matches).filter(match => match.stage === "semifinal" || match.stage === "final");
      if (knockouts.some(match => match.status !== "pending" || match.published)) throw new Error("Die KO-Phase enthält bereits Resultate. Bitte zuerst die KO-Phase zurücksetzen.");
      game = resetBeerPongKnockouts(game);
    } else if (game.groupEvaluated) {
      game.groupEvaluated = false; game.groupRanking = []; game.groupStandings = [];
    }
  }
  if (correction && original.stage === "semifinal" && game.finalReleased) {
    const final = game.matches.final;
    if (final?.status !== "pending" || final?.published) throw new Error("Das Finale wurde bereits gestartet. Bitte zuerst das Finale zurücksetzen.");
    game = resetBeerPongFinal(game);
  }
  const match = game.matches?.[matchId] || original;
  game.matches[matchId] = publicBeerPongMatch(match, draft);
  if (match.stage === "final" && game.status === "completed") game = completeBeerPong(game);
  game.updatedAt = serverNow();
  return game;
}

function cleanBeerPongTieBreakRanks(value = {}) {
  const clean = {};
  TEAMS.forEach(team => { const rank = Number(value[team.id]); if (Number.isInteger(rank) && rank > 0) clean[team.id] = rank; });
  return clean;
}

function cleanHuntTarget(targetId, target) {
  const base = HUNT_DEFAULT_TARGETS[targetId];
  if (!base) throw new Error("Unbekannter Gegenstand.");
  const clue = String(target?.clue || "").trim().slice(0, 220);
  const category = String(target?.category || "").trim().slice(0, 60);
  const internalName = String(target?.internalName || "").trim().slice(0, 80);
  if (!clue || !category || !internalName) throw new Error("Hinweis, Erkennungsziel und interner Name sind erforderlich.");
  return { id: targetId, number: base.number, clue, category, internalName, enabled: target?.enabled !== false };
}

function publicHuntTarget(target) {
  return { id: target.id, number: Number(target.number), clue: target.clue, category: target.category };
}

function normaliseSongBattleAdmin(value = null) {
  return {
    evaluations: value?.evaluations || {},
    internalPoints: { ...Object.fromEntries(TEAMS.map(team => [team.id, 0])), ...(value?.internalPoints || {}) },
    evaluationUpdatedAt: Number(value?.evaluationUpdatedAt || 0)
  };
}

function normaliseNovitiusAdmin(value = null) {
  return { questions: Object.fromEntries(Object.entries(NOVITIUS_DEFAULT_QUESTIONS).map(([key, question]) => [key, { ...question, ...(value?.questions?.[key] || {}) }])), liveResult: value?.liveResult ?? null };
}

function cleanNovitiusQuestion(number, question) {
  const type = question.type === "time" ? "time" : "number";
  const scoreMode = type === "time" ? "time" : question.scoreMode === "percentage" ? "percentage" : "absolute";
  const correctValue = type === "time" ? String(question.correctValue || "") : question.correctValue === "" || question.correctValue === null || question.correctValue === undefined ? "" : Number(question.correctValue);
  const thresholds = Array.from({ length: 3 }, (_, index) => Math.max(0, Number(question.thresholds?.[index]) || 0));
  if (thresholds.some((value, index) => index > 0 && value < thresholds[index - 1])) throw new Error("Die Toleranzbereiche müssen von 3 bis 1 Punkt grösser werden.");
  return { number: Number(number), text: String(question.text || "").trim().slice(0, 180), type, unit: String(question.unit || "").trim().slice(0, 30), correctValue, thresholds, scoreMode, liveAnswer: !!question.liveAnswer };
}

function publicNovitiusQuestion(question) {
  return { number: Number(question.number), text: question.text, type: question.type, unit: question.unit || "", liveAnswer: !!question.liveAnswer };
}

function cleanNovitiusAnswerValue(question, value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") throw new Error("Bitte eine gültige Antwort eingeben.");
  if (question?.type === "time") {
    const clean = String(value || "");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) throw new Error("Bitte eine gültige Uhrzeit im Format HH:MM eingeben.");
    return clean;
  }
  const clean = Number(value);
  if (!Number.isInteger(clean) || clean < 0) throw new Error("Bitte eine gültige ganze Zahl eingeben.");
  return clean;
}

function storedNovitiusScore(question, value) {
  const result = scoreNovitiusAnswer(question, value);
  return { points: result.points, deviation: Number.isFinite(result.deviation) ? result.deviation : null, scoredAt: serverNow() };
}

function applyStoredNovitiusScores(questions = {}, answers = {}, revealedQuestions = {}) {
  Object.entries(answers || {}).forEach(([, participantAnswers]) => {
    Object.entries(participantAnswers || {}).forEach(([key, answer]) => {
      if (revealedQuestions?.[key] && questions?.[key] && answer) Object.assign(answer, storedNovitiusScore(questions[key], answer.value));
    });
  });
  return answers;
}

function novitiusScoreUpdates(questions = {}, answers = {}, revealedQuestions = {}) {
  const updates = {};
  Object.entries(answers || {}).forEach(([participantId, participantAnswers]) => {
    Object.entries(participantAnswers || {}).forEach(([key, answer]) => {
      if (!revealedQuestions?.[key] || !questions?.[key] || !answer) return;
      const score = storedNovitiusScore(questions[key], answer.value);
      updates[`novitiusAnswers/${participantId}/${key}/points`] = score.points;
      updates[`novitiusAnswers/${participantId}/${key}/deviation`] = score.deviation;
      updates[`novitiusAnswers/${participantId}/${key}/scoredAt`] = score.scoredAt;
    });
  });
  return updates;
}

function emptyTeamCounts() {
  return Object.fromEntries(TEAMS.map(team => [team.id, 0]));
}

function novitiusTeamSizes(participants = {}) {
  const counts = emptyTeamCounts();
  Object.values(participants || {}).forEach(participant => { if (Object.hasOwn(counts, participant?.teamId)) counts[participant.teamId] += 1; });
  return counts;
}

function buildTieBreakRanking(tieBreak = {}) {
  const question = String(tieBreak.question || "").trim();
  const correct = Number(tieBreak.correctValue);
  const teamIds = [...new Set(tieBreak.teamIds || Object.keys(tieBreak.answers || {}))].filter(id => TEAMS.some(team => team.id === id));
  if (!question || !Number.isFinite(correct) || teamIds.length < 2) throw new Error("Bitte Stechfrage, Lösung und alle betroffenen Reiche erfassen.");
  const ranked = teamIds.map(id => ({ id, value: Number(tieBreak.answers?.[id]) })).map(item => ({ ...item, deviation: Math.abs(item.value - correct) }));
  if (ranked.some(item => !Number.isFinite(item.value))) throw new Error("Bitte für jedes betroffene Reich eine Antwort eintragen.");
  ranked.sort((a, b) => a.deviation - b.deviation || a.id.localeCompare(b.id));
  if (ranked.some((item, index) => index > 0 && item.deviation === ranked[index - 1].deviation)) throw new Error("Auch die Stechfrage ist unentschieden. Bitte eine weitere Stechfrage verwenden.");
  return ranked.map(item => item.id);
}

function refinalizeNovitiusOrPending(game, questions, participants, answers) {
  try { return finalizeNovitiusGame(game, questions, participants, answers); }
  catch (error) {
    if (!String(error.message).startsWith("Gleichstand – Stechfrage erforderlich")) throw error;
    return { ...game, status: "running", points: emptyTeamCounts(), ranking: [], placements: {}, winnerIds: [], resultText: "", tieBreak: null, updatedAt: serverNow() };
  }
}

function buildSongPublicReveal(answers, evaluations, songNumber, validate = false) {
  const key = `song-${songNumber}`;
  const teams = {};
  TEAMS.forEach(team => {
    const answer = answers?.[team.id]?.[key] || null;
    const evaluation = evaluations?.[key]?.[team.id] || {};
    if (validate && answer && (typeof evaluation.title !== "boolean" || typeof evaluation.artist !== "boolean")) throw new Error(`${team.name}: Antwort zuerst vollständig bewerten.`);
    teams[team.id] = {
      submitted: !!answer,
      title: answer?.title || "",
      artist: answer?.artist || "",
      titleCorrect: answer ? evaluation.title === true : false,
      artistCorrect: answer ? evaluation.artist === true : false
    };
  });
  return { songNumber: Number(songNumber), teams, revealedAt: serverNow() };
}

function getLocalProfileId() {
  try { return JSON.parse(localStorage.getItem("regnum-noctis-player") || "null")?.id || null; }
  catch { return null; }
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
    game: { name: "Das Orakel", round: oracle.question, resultText: `Lösung: ${correctAnswer}${oracle.unit ? ` ${oracle.unit}` : ""}`, points, source: "oracle", createdAt: serverNow(), updatedAt: serverNow() }
  };
}
