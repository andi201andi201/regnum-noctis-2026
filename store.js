import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { EMPTY_STATE } from "./data.js";

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
      return firebase.onValue(firebase.ref(firebase.db), snapshot => callback(normalise(snapshot.val())));
    },
    auth: {
      login: (email, password) => firebase.signInWithEmailAndPassword(firebase.auth, email, password),
      logout: () => firebase.signOut(firebase.auth),
      observe: callback => firebase.onAuthStateChanged(firebase.auth, callback)
    },
    async saveGame(game, id = null) {
      const gameRef = id ? firebase.ref(firebase.db, `games/${id}`) : firebase.push(firebase.ref(firebase.db, "games"));
      await firebase.set(gameRef, game);
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
    }
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
    auth: { login: async () => ({ user: { uid: "demo" } }), logout: async () => {}, observe: callback => { callback({ uid: "demo" }); return () => {}; } },
    async saveGame(game, id = null) { const state = read(); state.games[id || `demo-${Date.now()}`] = game; state.settings.updatedAt = Date.now(); write(state); },
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
    }
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
  return { settings: { ...EMPTY_STATE.settings, ...(value?.settings || {}) }, games: value?.games || {} };
}
