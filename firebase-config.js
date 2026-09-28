// Firebase Console → Projekteinstellungen → Deine Apps → Web-App
// Diese Platzhalter durch deine echten Werte ersetzen.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

export const isFirebaseConfigured = !Object.values(firebaseConfig).some(value => value.includes("REPLACE_ME"));
