import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { EMPTY_STATE, TEAMS, SONG_BATTLE, NOVITIUS_GAME, NOVITIUS_DEFAULT_QUESTIONS, buildSongBattle, songBattleScores, finalizeSongBattle, buildNovitiusGame, buildNovitiusReveal, finalizeNovitiusGame } from "./data.js?v=games-3";

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
    subscribeSongBattleParticipants(callback) { return firebase.onValue(firebase.ref(firebase.db, "songBattleParticipants"), snapshot => callback(snapshot.val() || {})); },
    subscribeSongBattleAdmin(callback) { return firebase.onValue(firebase.ref(firebase.db, "songBattleAdmin"), snapshot => callback(normaliseSongBattleAdmin(snapshot.val()))); },
    subscribeNovitiusAdmin(callback) { return firebase.onValue(firebase.ref(firebase.db, "novitiusAdmin"), snapshot => callback(normaliseNovitiusAdmin(snapshot.val()))); },
    subscribeNovitiusParticipants(callback) { return firebase.onValue(firebase.ref(firebase.db, "novitiusParticipants"), snapshot => callback(snapshot.val() || {})); },
    subscribeNovitiusAnswers(callback) { return firebase.onValue(firebase.ref(firebase.db, "novitiusAnswers"), snapshot => callback(snapshot.val() || {})); },
    async subscribeSongBattleTeam(teamId, callback) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      let answers = {}, participant = null;
      const emit = () => callback({ answers, participant, owned: participant?.claimantId === firebase.auth.currentUser?.uid });
      const stops = [
        firebase.onValue(firebase.ref(firebase.db, `songBattleAnswers/${teamId}`), snapshot => { answers = snapshot.val() || {}; emit(); }),
        firebase.onValue(firebase.ref(firebase.db, `songBattleParticipants/${teamId}`), snapshot => { participant = snapshot.val() || null; emit(); })
      ];
      return () => stops.forEach(stop => stop());
    },
    async subscribeNovitiusPlayer(callback) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const participantId = firebase.auth.currentUser.uid;
      let participant = null, answers = {};
      const emit = () => callback({ participantId, participant, answers });
      const stops = [
        firebase.onValue(firebase.ref(firebase.db, `novitiusParticipants/${participantId}`), snapshot => { participant = snapshot.val() || null; emit(); }),
        firebase.onValue(firebase.ref(firebase.db, `novitiusAnswers/${participantId}`), snapshot => { answers = snapshot.val() || {}; emit(); })
      ];
      return () => stops.forEach(stop => stop());
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
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const participantRef = firebase.ref(firebase.db, `songBattleParticipants/${profile.teamId}`);
      const claimantId = firebase.auth.currentUser.uid;
      const result = await firebase.runTransaction(participantRef, current => current || { claimantId, playerName: profile.name, joinedAt: Date.now() });
      const participant = result.snapshot.val();
      return { claimed: participant?.claimantId === claimantId, participant };
    },
    releaseSongBattleTeam(teamId) { return firebase.update(firebase.ref(firebase.db), { [`songBattleParticipants/${teamId}`]: null, [`songBattleAnswers/${teamId}`]: null }); },
    async submitSongBattleAnswer(songNumber, profile, title, artist) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`))).val();
      if (game?.status !== "running" || Number(game.currentSong) !== Number(songNumber) || !game.answersOpen) throw new Error("song-battle-closed");
      const participant = (await firebase.get(firebase.ref(firebase.db, `songBattleParticipants/${profile.teamId}`))).val();
      if (participant?.claimantId !== firebase.auth.currentUser.uid) throw new Error("song-battle-not-participant");
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
      const gameSnapshot = await firebase.get(firebase.ref(firebase.db, `games/${SONG_BATTLE.id}`));
      const game = gameSnapshot.val();
      const updates = { songBattleAdmin: admin };
      if (game?.revealedSongs?.[`song-${songNumber}`]) {
        const answers = (await firebase.get(firebase.ref(firebase.db, "songBattleAnswers"))).val() || {};
        updates[`games/${SONG_BATTLE.id}/publicReveals/song-${songNumber}`] = buildSongPublicReveal(answers, admin.evaluations, songNumber);
      }
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
      const game = finalizeSongBattle(gameSnapshot.val(), normaliseSongBattleAdmin(adminSnapshot.val()).evaluations);
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
        const [participantsSnapshot, answersSnapshot] = await Promise.all([firebase.get(firebase.ref(firebase.db, "novitiusParticipants")), firebase.get(firebase.ref(firebase.db, "novitiusAnswers"))]);
        const answers = answersSnapshot.val() || {};
        const questionAnswers = Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, values?.[`question-${number}`]]).filter(([, answer]) => answer));
        updates[`games/${NOVITIUS_GAME.id}/publicReveals/question-${number}`] = buildNovitiusReveal(clean, participantsSnapshot.val() || {}, questionAnswers);
      }
      return firebase.update(firebase.ref(firebase.db), updates);
    },
    async startNovitiusGame() {
      const [gameSnapshot, adminSnapshot] = await Promise.all([
        firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`)),
        firebase.get(firebase.ref(firebase.db, "novitiusAdmin"))
      ]);
      const game = buildNovitiusGame("running", gameSnapshot.val());
      const admin = normaliseNovitiusAdmin(adminSnapshot.val());
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${NOVITIUS_GAME.id}`]: game,
        novitiusParticipants: null,
        novitiusAnswers: null,
        novitiusAdmin: admin,
        "settings/updatedAt": firebase.serverTimestamp()
      });
    },
    async setNovitiusRegistration(open) {
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || Number(game.currentQuestion || 0) > 0) throw new Error("Die Anmeldung kann nach Frage 1 nicht mehr geändert werden.");
      return firebase.update(gameRef, { registrationOpen: !!open, participantsLocked: !open, controlUpdatedAt: firebase.serverTimestamp() });
    },
    async claimNovitiusParticipant(profile) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const participantId = firebase.auth.currentUser.uid;
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running" || !game.registrationOpen) throw new Error("novitius-registration-closed");
      const participant = { claimantId: participantId, playerName: profile.name, teamId: profile.teamId, joinedAt: Date.now() };
      await firebase.set(firebase.ref(firebase.db, `novitiusParticipants/${participantId}`), participant);
      return { participantId, participant };
    },
    removeNovitiusParticipant(participantId) { return firebase.update(firebase.ref(firebase.db), { [`novitiusParticipants/${participantId}`]: null, [`novitiusAnswers/${participantId}`]: null }); },
    async startNovitiusQuestion(number) {
      const questionNumber = Number(number);
      if (questionNumber < 1 || questionNumber > NOVITIUS_GAME.questionCount) throw new Error("Ungültige Frage.");
      const question = (await firebase.get(firebase.ref(firebase.db, `novitiusAdmin/questions/question-${questionNumber}`))).val();
      if (!question?.text) throw new Error("Diese Frage ist noch nicht vorbereitet.");
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running") throw new Error("Das Spiel läuft nicht.");
      if (game?.revealedQuestions?.[`question-${questionNumber}`]) throw new Error("Diese Frage wurde bereits aufgelöst und kann nicht erneut geöffnet werden.");
      await firebase.update(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`), {
        status: "running",
        registrationOpen: false,
        participantsLocked: true,
        currentQuestion: questionNumber,
        currentQuestionData: publicNovitiusQuestion(question),
        answersOpen: true,
        controlUpdatedAt: firebase.serverTimestamp()
      });
    },
    async setNovitiusAnswersOpen(open) {
      const gameRef = firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`);
      const game = (await firebase.get(gameRef)).val();
      if (game?.status !== "running" || !game.currentQuestion) throw new Error("Es läuft noch keine Frage.");
      if (open && game.revealedQuestions?.[`question-${game.currentQuestion}`]) throw new Error("Eine aufgelöste Frage kann nicht erneut geöffnet werden.");
      return firebase.update(gameRef, { answersOpen: !!open, controlUpdatedAt: firebase.serverTimestamp() });
    },
    async submitNovitiusAnswer(questionNumber, profile, value) {
      if (!firebase.auth.currentUser) await firebase.signInAnonymously(firebase.auth);
      const participantId = firebase.auth.currentUser.uid;
      const game = (await firebase.get(firebase.ref(firebase.db, `games/${NOVITIUS_GAME.id}`))).val();
      if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || !game.answersOpen) throw new Error("novitius-answers-closed");
      const participant = (await firebase.get(firebase.ref(firebase.db, `novitiusParticipants/${participantId}`))).val();
      if (!participant || participant.teamId !== profile.teamId) throw new Error("novitius-not-registered");
      const answer = { value, playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, updatedAt: Date.now() };
      await firebase.set(firebase.ref(firebase.db, `novitiusAnswers/${participantId}/question-${questionNumber}`), answer);
      return answer;
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
      const allAnswers = answersSnapshot.val() || {};
      const questionAnswers = Object.fromEntries(Object.entries(allAnswers).map(([id, values]) => [id, values?.[`question-${questionNumber}`]]).filter(([, answer]) => answer));
      const reveal = buildNovitiusReveal(questionSnapshot.val(), participantsSnapshot.val() || {}, questionAnswers);
      await firebase.update(firebase.ref(firebase.db), {
        [`games/${NOVITIUS_GAME.id}/revealedQuestions/question-${questionNumber}`]: true,
        [`games/${NOVITIUS_GAME.id}/publicReveals/question-${questionNumber}`]: reveal,
        [`games/${NOVITIUS_GAME.id}/controlUpdatedAt`]: firebase.serverTimestamp()
      });
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
    subscribeSongBattleParticipants(callback) { const listener = state => callback(state.songBattleParticipants || {}); listeners.add(listener); callback(read().songBattleParticipants || {}); return () => listeners.delete(listener); },
    subscribeSongBattleAdmin(callback) { const listener = state => callback(normaliseSongBattleAdmin(state.songBattleAdmin)); listeners.add(listener); callback(normaliseSongBattleAdmin(read().songBattleAdmin)); return () => listeners.delete(listener); },
    subscribeNovitiusAdmin(callback) { const listener = state => callback(normaliseNovitiusAdmin(state.novitiusAdmin)); listeners.add(listener); callback(normaliseNovitiusAdmin(read().novitiusAdmin)); return () => listeners.delete(listener); },
    subscribeNovitiusParticipants(callback) { const listener = state => callback(state.novitiusParticipants || {}); listeners.add(listener); callback(read().novitiusParticipants || {}); return () => listeners.delete(listener); },
    subscribeNovitiusAnswers(callback) { const listener = state => callback(state.novitiusAnswers || {}); listeners.add(listener); callback(read().novitiusAnswers || {}); return () => listeners.delete(listener); },
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
    async saveNovitiusQuestion(number, question) { const state = read(); state.novitiusAdmin = normaliseNovitiusAdmin(state.novitiusAdmin); const clean = cleanNovitiusQuestion(number, question); state.novitiusAdmin.questions[`question-${number}`] = clean; const game = state.games[NOVITIUS_GAME.id]; if (game?.revealedQuestions?.[`question-${number}`] && clean.correctValue !== "") { const questionAnswers = Object.fromEntries(Object.entries(state.novitiusAnswers || {}).map(([id, values]) => [id, values?.[`question-${number}`]]).filter(([, answer]) => answer)); (game.publicReveals ||= {})[`question-${number}`] = buildNovitiusReveal(clean, state.novitiusParticipants || {}, questionAnswers); } write(state); },
    async startNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = buildNovitiusGame("running", state.games[NOVITIUS_GAME.id]); state.novitiusParticipants = {}; state.novitiusAnswers = {}; state.novitiusAdmin = normaliseNovitiusAdmin(state.novitiusAdmin); state.settings.updatedAt = Date.now(); write(state); },
    async setNovitiusRegistration(open) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion || 0) > 0) throw new Error("Die Anmeldung kann nach Frage 1 nicht mehr geändert werden."); game.registrationOpen = !!open; game.participantsLocked = !open; game.controlUpdatedAt = Date.now(); write(state); },
    async claimNovitiusParticipant(profile) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || !game.registrationOpen) throw new Error("novitius-registration-closed"); const participantId = profile.id; const participant = { claimantId: participantId, playerName: profile.name, teamId: profile.teamId, joinedAt: Date.now() }; state.novitiusParticipants[participantId] = participant; write(state); return { participantId, participant }; },
    async removeNovitiusParticipant(participantId) { const state = read(); delete state.novitiusParticipants[participantId]; delete state.novitiusAnswers[participantId]; write(state); },
    async startNovitiusQuestion(number) { const state = read(); const questionNumber = Number(number); if (questionNumber < 1 || questionNumber > NOVITIUS_GAME.questionCount) throw new Error("Ungültige Frage."); const question = normaliseNovitiusAdmin(state.novitiusAdmin).questions[`question-${questionNumber}`]; if (!question?.text) throw new Error("Diese Frage ist noch nicht vorbereitet."); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running") throw new Error("Das Spiel läuft nicht."); if (game.revealedQuestions?.[`question-${questionNumber}`]) throw new Error("Diese Frage wurde bereits aufgelöst und kann nicht erneut geöffnet werden."); game.registrationOpen = false; game.participantsLocked = true; game.currentQuestion = questionNumber; game.currentQuestionData = publicNovitiusQuestion(question); game.answersOpen = true; game.controlUpdatedAt = Date.now(); write(state); },
    async setNovitiusAnswersOpen(open) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || !game.currentQuestion) throw new Error("Es läuft noch keine Frage."); if (open && game.revealedQuestions?.[`question-${game.currentQuestion}`]) throw new Error("Eine aufgelöste Frage kann nicht erneut geöffnet werden."); game.answersOpen = !!open; game.controlUpdatedAt = Date.now(); write(state); },
    async submitNovitiusAnswer(questionNumber, profile, value) { const state = read(); const participantId = profile.id; const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || !game.answersOpen) throw new Error("novitius-answers-closed"); const participant = state.novitiusParticipants?.[participantId]; if (!participant || participant.teamId !== profile.teamId) throw new Error("novitius-not-registered"); const answer = { value, playerName: participant.playerName, teamId: participant.teamId, claimantId: participantId, updatedAt: Date.now() }; ((state.novitiusAnswers[participantId] ||= {})[`question-${questionNumber}`]) = answer; write(state); return answer; },
    async revealNovitiusQuestion(questionNumber) { const state = read(); const game = state.games[NOVITIUS_GAME.id]; if (game?.status !== "running" || Number(game.currentQuestion) !== Number(questionNumber) || game.answersOpen) throw new Error("Antworten zuerst sperren."); const question = normaliseNovitiusAdmin(state.novitiusAdmin).questions[`question-${questionNumber}`]; const questionAnswers = Object.fromEntries(Object.entries(state.novitiusAnswers).map(([id, values]) => [id, values?.[`question-${questionNumber}`]]).filter(([, answer]) => answer)); const reveal = buildNovitiusReveal(question, state.novitiusParticipants, questionAnswers); (game.revealedQuestions ||= {})[`question-${questionNumber}`] = true; (game.publicReveals ||= {})[`question-${questionNumber}`] = reveal; game.controlUpdatedAt = Date.now(); write(state); },
    async finishNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = finalizeNovitiusGame(state.games[NOVITIUS_GAME.id], normaliseNovitiusAdmin(state.novitiusAdmin).questions, state.novitiusParticipants, state.novitiusAnswers); state.settings.updatedAt = Date.now(); write(state); },
    async resetNovitiusGame() { const state = read(); state.games[NOVITIUS_GAME.id] = buildNovitiusGame("not-started", state.games[NOVITIUS_GAME.id]); state.novitiusParticipants = {}; state.novitiusAnswers = {}; state.settings.updatedAt = Date.now(); write(state); },
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
    songBattleParticipants: value?.songBattleParticipants || {},
    songBattleAdmin: normaliseSongBattleAdmin(value?.songBattleAdmin),
    novitiusParticipants: value?.novitiusParticipants || {},
    novitiusAnswers: value?.novitiusAnswers || {},
    novitiusAdmin: normaliseNovitiusAdmin(value?.novitiusAdmin),
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

function normaliseNovitiusAdmin(value = null) {
  return { questions: Object.fromEntries(Object.entries(NOVITIUS_DEFAULT_QUESTIONS).map(([key, question]) => [key, { ...question, ...(value?.questions?.[key] || {}) }])) };
}

function cleanNovitiusQuestion(number, question) {
  const type = question.type === "time" ? "time" : "number";
  const correctValue = type === "time" ? String(question.correctValue || "") : question.correctValue === "" || question.correctValue === null || question.correctValue === undefined ? "" : Number(question.correctValue);
  const thresholds = Array.from({ length: 5 }, (_, index) => Math.max(0, Number(question.thresholds?.[index]) || 0));
  if (thresholds.some((value, index) => index > 0 && value < thresholds[index - 1])) throw new Error("Die Toleranzbereiche müssen von 5 bis 1 Punkt grösser werden.");
  return { number: Number(number), text: String(question.text || "").trim().slice(0, 180), type, unit: String(question.unit || "").trim().slice(0, 30), correctValue, thresholds, liveAnswer: !!question.liveAnswer };
}

function publicNovitiusQuestion(question) {
  return { number: Number(question.number), text: question.text, type: question.type, unit: question.unit || "", liveAnswer: !!question.liveAnswer };
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
  return { songNumber: Number(songNumber), teams, revealedAt: Date.now() };
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
    game: { name: "Das Orakel", round: oracle.question, resultText: `Lösung: ${correctAnswer}${oracle.unit ? ` ${oracle.unit}` : ""}`, points, source: "oracle", createdAt: Date.now(), updatedAt: Date.now() }
  };
}
