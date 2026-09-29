import { TEAMS, sortedGames, formatTime } from "./data.js";
import { getStore } from "./store.js";

const $ = selector => document.querySelector(selector);
const store = await getStore();
let currentState = null, editingId = null;
const ADMIN_PASS_HASH = "a80ff0faa95c643a50fbb4252140f964cf050b07a179843c9baa7a2783559da4";

$("#scoreInputs").innerHTML = TEAMS.map(team => `<label class="score-field" style="--team:${team.color}"><span><i></i>${team.name}</span><input id="score-${team.id}" type="number" inputmode="numeric" value="0" step="1" required></label>`).join("");
if (store.demo) setAccess(sessionStorage.getItem("regnum-admin-unlocked") === "true");
else {
  $("#firebaseEmailField").classList.remove("hidden");
  $("#email").required = true;
  store.auth.observe(user => setAccess(!!user));
}
store.subscribe(state => { currentState = state; renderAdmin(state); });

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    if (store.demo) {
      if (await sha256($("#password").value) !== ADMIN_PASS_HASH) throw new Error("wrong-password");
      sessionStorage.setItem("regnum-admin-unlocked", "true");
      setAccess(true);
      $("#password").value = "";
    } else await store.auth.login($("#email").value, $("#password").value);
  } catch (error) {
    $("#loginError").textContent = error.message === "wrong-password" ? "Passwort ist falsch." : humanAuthError(error.code);
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  if (store.demo) {
    sessionStorage.removeItem("regnum-admin-unlocked");
    setAccess(false);
  } else await store.auth.logout();
});

document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", async () => { await store.setMode(button.dataset.mode); toast(`Modus auf „${button.textContent}“ gesetzt`); }));

$("#resultForm").addEventListener("submit", async event => {
  event.preventDefault();
  const existing = editingId ? currentState.games[editingId] : null;
  const game = { name: $("#gameName").value.trim(), round: $("#roundName").value.trim(), resultText: $("#resultText").value.trim(), points: Object.fromEntries(TEAMS.map(team => [team.id, Number($(`#score-${team.id}`).value) || 0])), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() };
  try { await store.saveGame(game, editingId); toast(editingId ? "Resultat korrigiert" : "Resultat gespeichert"); resetForm(); } catch (error) { $("#saveMessage").textContent = `Fehler: ${error.message}`; }
});
$("#cancelEdit").addEventListener("click", resetForm);

$("#adminResults").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (action === "edit") loadEdit(id);
  if (action === "delete" && confirm("Dieses Resultat wirklich löschen? Die Rangliste wird sofort neu berechnet.")) { await store.deleteGame(id); toast("Resultat gelöscht"); if (editingId === id) resetForm(); }
});

function renderAdmin(state) {
  const mode = state.settings.mode || "live";
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("#modeHelp").textContent = { live: "Rangliste und Resultate sind für alle sichtbar.", frozen: "Publikum sieht keine Punkte – Admin bleibt bedienbar.", final: "Die Siegeransicht wird öffentlich angezeigt." }[mode];
  const games = sortedGames(state.games);
  $("#adminResults").innerHTML = games.map(game => `<article class="admin-result"><div><span>${formatTime(game.createdAt, true)}</span><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(game.round || game.resultText || "")}</small></div><div class="admin-actions"><button data-action="edit" data-id="${game.id}">Bearbeiten</button><button class="danger" data-action="delete" data-id="${game.id}">Löschen</button></div></article>`).join("");
  $("#adminEmpty").classList.toggle("hidden", games.length > 0);
}

function loadEdit(id) { const game = currentState.games[id]; if (!game) return; editingId = id; $("#formTitle").textContent = "Resultat korrigieren"; $("#cancelEdit").classList.remove("hidden"); $("#gameName").value = game.name || ""; $("#roundName").value = game.round || ""; $("#resultText").value = game.resultText || ""; TEAMS.forEach(team => $(`#score-${team.id}`).value = Number(game.points?.[team.id] || 0)); $("#resultForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
function resetForm() { editingId = null; $("#resultForm").reset(); TEAMS.forEach(team => $(`#score-${team.id}`).value = 0); $("#formTitle").textContent = "Spielresultat erfassen"; $("#cancelEdit").classList.add("hidden"); $("#saveMessage").textContent = ""; }
function toast(message) { $("#toast").textContent = message; $("#toast").classList.add("show"); setTimeout(() => $("#toast").classList.remove("show"), 2200); }
function setAccess(granted) { $("#loginPanel").classList.toggle("hidden", granted); $("#adminContent").classList.toggle("hidden", !granted); $("#logoutBtn").classList.toggle("hidden", !granted); }
async function sha256(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function humanAuthError(code) { return ({ "auth/invalid-credential": "E-Mail oder Passwort ist falsch.", "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.", "auth/network-request-failed": "Keine Verbindung. Bitte Internet prüfen." })[code] || "Login fehlgeschlagen."; }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
