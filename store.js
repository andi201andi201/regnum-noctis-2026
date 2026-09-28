import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { EMPTY_STATE } from "./data.js";

const STORAGE_KEY = "regnum-noctis-demo";
let firebase = null;

export async function getStore() {
  if (!isFirebaseConfigured) return localStore();
  if (!firebase) {
    const [{ initializeApp }, auth, database] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js")
    ]);
    const app = initializeApp(firebaseConfig);
    firebase = { auth: auth.getAuth(app), db: database.getDatabase(app), ...auth, ...database };
  }
  return firebaseStore();
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
    deleteGame: id => firebase.remove(firebase.ref(firebase.db, `games/${id}`)),
    setMode: mode => firebase.update(firebase.ref(firebase.db, "settings"), { mode, updatedAt: firebase.serverTimestamp() })
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
    async deleteGame(id) { const state = read(); delete state.games[id]; state.settings.updatedAt = Date.now(); write(state); },
    async setMode(mode) { const state = read(); state.settings = { ...state.settings, mode, updatedAt: Date.now() }; write(state); }
  };
}

function normalise(value) {
  return { settings: { ...EMPTY_STATE.settings, ...(value?.settings || {}) }, games: value?.games || {} };
}
