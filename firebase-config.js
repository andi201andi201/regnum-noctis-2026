// Öffentliche Web-App-Konfiguration aus der Firebase Console.
// databaseURL wird ausschliesslich aus der Realtime-Database-Console übernommen.
export const firebaseConfig = {
  apiKey: "AIzaSyD0VVB0sey7vRp7UIi-nMp2MIzvPn72ZkQ",
  authDomain: "regnum-noctis-2026.firebaseapp.com",
  databaseURL: "https://regnum-noctis-2026-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "regnum-noctis-2026",
  storageBucket: "regnum-noctis-2026.firebasestorage.app",
  messagingSenderId: "467646880462",
  appId: "1:467646880462:web:59d721891579c16ca98e9f",
  measurementId: "G-TLRF9E40NZ"
};

export const isFirebaseConfigured = !!firebaseConfig.databaseURL && !Object.values(firebaseConfig).some(value => value.includes("REPLACE_ME"));
