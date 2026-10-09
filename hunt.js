import { TEAMS, formatTime } from "./data.js?v=novitius-2";
import { getStore } from "./store.js?v=novitius-2";
import { getPlayerProfile } from "./player.js";
import { HUNT_POINTS_PER_OBJECT, huntFinds, huntProgress } from "./hunt-data.js?v=novitius-2";

const $ = selector => document.querySelector(selector);
const DETECTION_HOLD_MS = 950;
const DETECTION_INTERVAL_MS = 180;
const WRONG_MESSAGE_MS = 1400;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";
const CATEGORY_NAMES = { bottle: "Flasche", cup: "Becher/Tasse", chair: "Stuhl", backpack: "Rucksack", book: "Buch", "cell phone": "Handy", toothbrush: "Zahnbürste", spoon: "Löffel", umbrella: "Regenschirm", clock: "Uhr" };

let detector = null, stream = null, animationFrame = null, currentState = null, selectedTarget = null;
let lastDetectionAt = 0, detectedSince = null, completed = false, wrongUntil = 0;
const store = await getStore();

$("#huntMissionGrid").addEventListener("click", event => {
  const button = event.target.closest("button[data-scan-target]");
  if (button) startCamera(button.dataset.scanTarget);
});
$("#closeHuntScanner").addEventListener("click", closeCamera);
$("#closeHuntFeedback").addEventListener("click", () => { $("#huntFeedback").classList.add("hidden"); render(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) closeCamera(); });
window.addEventListener("regnum-player-changed", render);
store.subscribe(state => { currentState = state; render(); });

function render() {
  const hunt = currentState?.settings?.hunt || {};
  const profile = getPlayerProfile();
  const team = TEAMS.find(item => item.id === profile?.teamId);
  $("#huntNoProfile").classList.toggle("hidden", !!team);
  $("#huntNotStarted").classList.toggle("hidden", !team || !!hunt.roundId);
  $("#huntMissionGrid").classList.toggle("hidden", !team || !hunt.roundId);
  $(".hunt-history-section").classList.toggle("hidden", !team || !hunt.roundId);
  if (team) $("#huntPlayerBadge").innerHTML = `${team.marker} ${escapeHtml(profile.name)} · ${team.name}`;
  if (!team || !hunt.roundId) return;

  const targets = Object.values(hunt.targets || {}).sort((a, b) => Number(a.number) - Number(b.number));
  const found = huntProgress(currentState.games, hunt.roundId, team.id);
  const total = Number(hunt.targetCount || targets.length);
  $("#huntPageCount").textContent = `${found.size} / ${total}`;
  $("#huntPageProgressBar").style.width = `${total ? found.size / total * 100 : 0}%`;
  $("#huntEndedNotice").classList.toggle("hidden", !!hunt.active);
  $("#huntMissionGrid").innerHTML = targets.map(target => {
    const isFound = found.has(target.id);
    return `<article class="hunt-mission-card ${isFound ? "found" : ""}"><div class="hunt-mission-number"><span>${isFound ? "✓" : String(target.number).padStart(2, "0")}</span><small>Gegenstand ${target.number}</small></div><blockquote>${isFound ? "Dieser Gegenstand wurde von eurem Reich gefunden." : `„${escapeHtml(target.clue)}“`}</blockquote>${isFound ? '<div class="hunt-found-seal">✓ Gegenstand gefunden</div>' : `<button class="hunt-scan-button" type="button" data-scan-target="${target.id}" ${hunt.active ? "" : "disabled"}>${hunt.active ? "Scannen" : "Jagd beendet"}</button>`}</article>`;
  }).join("");

  const finds = huntFinds(currentState.games, hunt.roundId, team.id).sort((a, b) => b.createdAt - a.createdAt);
  $("#huntTeamHistory").innerHTML = finds.length ? finds.map(find => `<div><time>${formatTime(find.createdAt)}</time><span>Gegenstand ${find.targetNumber} gefunden von <strong>${escapeHtml(find.playerName)}</strong></span><b>+${Number(find.awardedPoints || 1)}</b></div>`).join("") : '<p class="empty-state">Noch keine Gegenstände gefunden.</p>';
  if (!hunt.active && stream) closeCamera();
}

async function startCamera(targetId) {
  const hunt = currentState?.settings?.hunt || {};
  const profile = getPlayerProfile();
  selectedTarget = hunt.targets?.[targetId];
  if (!hunt.active || !selectedTarget || !profile) return render();
  if (huntProgress(currentState.games, hunt.roundId, profile.teamId).has(targetId)) return showAlreadyFound();
  $("#scannerObjectNumber").textContent = `Gegenstand ${selectedTarget.number}`;
  $("#scannerClue").textContent = selectedTarget.clue;
  $("#huntScanner").classList.remove("hidden");
  setStatus("KI-Erkennung wird geladen …");
  try {
    detector ||= await createDetector(hunt);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unsupported");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const video = $("#huntVideo"); video.srcObject = stream; await video.play();
    completed = false; detectedSince = null; wrongUntil = 0;
    setStatus("Halte den gesuchten Gegenstand vor die Kamera …");
    animationFrame = requestAnimationFrame(scanFrame);
  } catch (error) {
    console.error(error);
    const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
    setStatus(denied ? "Kamerazugriff wurde nicht erlaubt. Bitte in den Browser-Einstellungen freigeben." : "Kamera oder Gegenstandserkennung konnte nicht gestartet werden.", true);
  }
}

async function createDetector(hunt) {
  const { FilesetResolver, ObjectDetector } = await import(MODULE_URL);
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const categories = [...new Set(Object.values(hunt.targets || {}).map(target => target.category).filter(Boolean))];
  return ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "VIDEO", categoryAllowlist: categories, scoreThreshold: 0.55, maxResults: 4 });
}

function scanFrame(now) {
  const video = $("#huntVideo");
  if (!stream || completed) return;
  if (video.readyState >= 2 && now - lastDetectionAt >= DETECTION_INTERVAL_MS) {
    lastDetectionAt = now;
    const detections = detector.detectForVideo(video, now).detections || [];
    const correctDetection = detections.find(detection => detection.categories?.some(category => category.categoryName === selectedTarget?.category));
    const detection = correctDetection || detections[0] || null;
    drawDetection(detection, !!correctDetection, video);
    if (correctDetection) updateCorrectHold(now);
    else if (detection && now > wrongUntil) showWrongScan(now);
    else if (!detection && now > wrongUntil) { detectedSince = null; $("#huntProgress").style.width = "0%"; setStatus("Halte den gesuchten Gegenstand vor die Kamera …"); }
  }
  animationFrame = requestAnimationFrame(scanFrame);
}

function updateCorrectHold(now) {
  if (detectedSince === null) detectedSince = now;
  const progress = Math.min(100, (now - detectedSince) / DETECTION_HOLD_MS * 100);
  $("#huntProgress").style.width = `${progress}%`;
  setStatus(progress < 100 ? "Mögliches Zeichen erkannt – ruhig halten …" : "Zeichen bestätigt!");
  if (progress >= 100) finishObject();
}

function showWrongScan(now) {
  detectedSince = null; wrongUntil = now + WRONG_MESSAGE_MS; $("#huntProgress").style.width = "0%";
  setStatus("✕ Das ist nicht der gesuchte Gegenstand. Weitersuchen!", true);
}

function drawDetection(detection, correct, video) {
  const canvas = $("#huntOverlay"), ctx = canvas.getContext("2d");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!detection?.boundingBox) return;
  const box = detection.boundingBox; ctx.strokeStyle = correct ? "#d9b665" : "#bd4d57"; ctx.lineWidth = Math.max(4, canvas.width / 220); ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 16; ctx.strokeRect(box.originX, box.originY, box.width, box.height);
}

async function finishObject() {
  completed = true; stopCameraOnly(); $("#huntScanner").classList.add("hidden");
  const hunt = currentState.settings.hunt, profile = getPlayerProfile(), team = TEAMS.find(item => item.id === profile?.teamId);
  try {
    const claim = await store.claimHuntObject(hunt.roundId, selectedTarget, profile);
    if (!claim.awarded) return showAlreadyFound();
    showFeedback("✓", "Richtig", `${CATEGORY_NAMES[selectedTarget.category] || "Gegenstand"} erkannt!`, `+${HUNT_POINTS_PER_OBJECT} Punkt für ${team.name}`);
  } catch (error) {
    showFeedback("✕", "Nicht gespeichert", "Die Nachtjagd ist beendet.", "Dieser Fund konnte nicht mehr gewertet werden.", true);
  }
}

function showAlreadyFound() {
  closeCamera();
  showFeedback("✓", "Bereits gefunden", "Dieser Gegenstand wurde von eurem Reich bereits gefunden.", "Keine weiteren Punkte.");
}

function showFeedback(icon, kicker, title, text, error = false) {
  $("#huntFeedbackIcon").textContent = icon; $("#huntFeedbackKicker").textContent = kicker; $("#huntFeedbackTitle").textContent = title; $("#huntFeedbackText").textContent = text;
  $("#huntFeedback").classList.toggle("error", error); $("#huntFeedback").classList.remove("hidden");
}

function closeCamera() { stopCameraOnly(); $("#huntScanner").classList.add("hidden"); $("#huntProgress").style.width = "0%"; }
function stopCameraOnly() { if (animationFrame) cancelAnimationFrame(animationFrame); animationFrame = null; stream?.getTracks().forEach(track => track.stop()); stream = null; const video = $("#huntVideo"); if (video) video.srcObject = null; clearCanvas(); }
function clearCanvas() { const canvas = $("#huntOverlay"); canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }
function setStatus(message, isError = false) { if (Date.now() < wrongUntil && !isError) return; $("#huntStatus").textContent = message; $("#huntStatus").classList.toggle("error", isError); }
function escapeHtml(value = "") { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
