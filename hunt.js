import { TEAMS } from "./data.js?v=games-3";
import { getStore } from "./store.js?v=games-3";
import { getPlayerProfile } from "./player.js";
import { HUNT_POINTS_PER_OBJECT, HUNT_TARGETS } from "./hunt-data.js";

const $ = selector => document.querySelector(selector);
const DETECTION_HOLD_MS = 1200;
const DETECTION_INTERVAL_MS = 180;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

let detector = null, stream = null, animationFrame = null, currentState = null;
let lastDetectionAt = 0, detectedSince = null, detectedTargetId = null, completed = false;
const store = await getStore();

$("#startHunt").addEventListener("click", startCamera);
$("#cancelHunt").addEventListener("click", closeCamera);
$("#restartHunt").addEventListener("click", continueHunt);
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) closeCamera(); });
window.addEventListener("regnum-player-changed", () => currentState && renderHunt(currentState));
store.subscribe(state => { currentState = state; renderHunt(state); });
setInterval(() => currentState && renderHunt(currentState), 1000);

function renderHunt(state) {
  const hunt = state.settings.hunt || {};
  const running = hunt.active && hunt.endsAt > Date.now();
  if (!running) {
    $("#huntCard").classList.add("hidden");
    $("#huntLocked").classList.add("hidden");
    $("#huntIntro").classList.add("hidden");
    $("#huntCamera").classList.add("hidden");
    $("#huntSuccess").classList.add("hidden");
    $("#huntTimer").textContent = hunt.active ? "Zeit abgelaufen" : "Versiegelt";
    if (stream) stopCameraOnly();
    return;
  }
  $("#huntCard").classList.remove("hidden");
  $("#huntLocked").classList.add("hidden");
  if ($("#huntCamera").classList.contains("hidden") && $("#huntSuccess").classList.contains("hidden")) $("#huntIntro").classList.remove("hidden");
  const remaining = Math.max(0, hunt.endsAt - Date.now());
  $("#huntTimer").textContent = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  const profile = getPlayerProfile();
  const claimed = claimedTargets(state, profile?.teamId, hunt.roundId);
  $("#huntCount").textContent = `${claimed.size} / ${HUNT_TARGETS.length}`;
  $("#huntTargets").innerHTML = HUNT_TARGETS.map(target => `<div class="hunt-target ${claimed.has(target.id) ? "found" : ""}"><i>${claimed.has(target.id) ? "✓" : target.icon}</i><span>${target.name}</span></div>`).join("");
  $("#startHunt").disabled = claimed.size === HUNT_TARGETS.length;
  $("#startHunt").textContent = claimed.size === HUNT_TARGETS.length ? "Alle Zeichen gefunden" : "Kamera starten";
}

function claimedTargets(state, teamId, roundId) {
  return new Set(Object.values(state.games || {}).filter(game => game.source === "team-hunt" && game.roundId === roundId && game.teamId === teamId).map(game => game.targetId));
}

async function startCamera() {
  const hunt = currentState?.settings?.hunt || {};
  if (!hunt.active || hunt.endsAt <= Date.now()) return renderHunt(currentState);
  $("#startHunt").disabled = true;
  $("#huntIntro").classList.add("hidden");
  $("#huntCamera").classList.remove("hidden");
  setStatus("KI-Modell wird geladen …");
  try {
    detector ||= await createDetector();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unsupported");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const video = $("#huntVideo");
    video.srcObject = stream;
    await video.play();
    completed = false; detectedSince = null; detectedTargetId = null;
    setStatus("Sucht eines der noch fehlenden Zeichen …");
    animationFrame = requestAnimationFrame(scanFrame);
  } catch (error) {
    console.error(error);
    const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
    setStatus(denied ? "Kamerazugriff wurde nicht erlaubt. Bitte in den Browser-Einstellungen freigeben." : "Die Kamera oder Gegenstandserkennung konnte nicht gestartet werden.", true);
    $("#startHunt").disabled = false;
  }
}

async function createDetector() {
  const { FilesetResolver, ObjectDetector } = await import(MODULE_URL);
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "VIDEO", categoryAllowlist: HUNT_TARGETS.map(target => target.category), scoreThreshold: 0.55, maxResults: 4 });
}

function scanFrame(now) {
  const video = $("#huntVideo");
  if (!stream || completed) return;
  if (video.readyState >= 2 && now - lastDetectionAt >= DETECTION_INTERVAL_MS) {
    lastDetectionAt = now;
    const result = detector.detectForVideo(video, now);
    const hunt = currentState.settings.hunt;
    const profile = getPlayerProfile();
    const claimed = claimedTargets(currentState, profile?.teamId, hunt.roundId);
    const detection = result.detections?.find(item => item.categories?.some(category => HUNT_TARGETS.some(target => !claimed.has(target.id) && target.category === category.categoryName)));
    const target = detection && HUNT_TARGETS.find(item => !claimed.has(item.id) && detection.categories.some(category => category.categoryName === item.category));
    drawDetection(detection, target, video);
    updateHold(target, now);
  }
  animationFrame = requestAnimationFrame(scanFrame);
}

function updateHold(target, now) {
  if (!target) {
    detectedSince = null; detectedTargetId = null;
    $("#huntProgress").style.width = "0%";
    setStatus("Sucht eines der noch fehlenden Zeichen …");
    return;
  }
  if (detectedTargetId !== target.id) { detectedTargetId = target.id; detectedSince = now; }
  const progress = Math.min(100, (now - detectedSince) / DETECTION_HOLD_MS * 100);
  $("#huntProgress").style.width = `${progress}%`;
  setStatus(progress < 100 ? `${target.name} erkannt – ruhig halten …` : `${target.name} bestätigt!`);
  if (progress >= 100) finishObject(target);
}

function drawDetection(detection, target, video) {
  const canvas = $("#huntOverlay"), ctx = canvas.getContext("2d");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!detection?.boundingBox || !target) return;
  const box = detection.boundingBox;
  ctx.strokeStyle = "#d9b665"; ctx.lineWidth = Math.max(4, canvas.width / 220); ctx.shadowColor = "#d9b665"; ctx.shadowBlur = 18;
  ctx.strokeRect(box.originX, box.originY, box.width, box.height); ctx.shadowBlur = 0; ctx.fillStyle = "rgba(8,9,13,.82)";
  ctx.fillRect(box.originX, Math.max(0, box.originY - 35), Math.max(145, target.name.length * 13), 35);
  ctx.fillStyle = "#f1eadb"; ctx.font = `600 ${Math.max(17, canvas.width / 45)}px Inter, sans-serif`;
  ctx.fillText(target.name.toUpperCase(), box.originX + 10, Math.max(25, box.originY - 10));
}

async function finishObject(target) {
  completed = true; stopCameraOnly();
  $("#huntCamera").classList.add("hidden"); $("#huntSuccess").classList.remove("hidden");
  $("#huntSuccessTitle").textContent = `${target.name} erkannt`;
  const profile = getPlayerProfile(), team = TEAMS.find(item => item.id === profile?.teamId);
  if (!profile || !team) { $("#huntSuccessText").textContent = "Name und Reich fehlen. Bitte wähle dein Reich erneut."; $("#huntProof").textContent = "Keine Punkte gutgeschrieben"; return; }
  $("#huntSuccessText").textContent = `Die Punkte für ${team.name} werden gutgeschrieben …`; $("#huntProof").textContent = "Wird gespeichert";
  const points = Object.fromEntries(TEAMS.map(item => [item.id, item.id === team.id ? HUNT_POINTS_PER_OBJECT : 0]));
  try {
    const claim = await store.claimHuntObject(currentState.settings.hunt.roundId, target, profile, points);
    $("#huntSuccessText").textContent = claim.awarded ? `+${HUNT_POINTS_PER_OBJECT} Punkte wurden ${team.name} gutgeschrieben.` : `${target.name} wurde für ${team.name} bereits gefunden.`;
    $("#huntProof").textContent = claim.awarded ? `${profile.name} · ${team.name} · +${HUNT_POINTS_PER_OBJECT}` : "Bereits gewertet";
  } catch (error) {
    console.error(error);
    $("#huntSuccessText").textContent = error.message === "hunt-closed" ? "Die Zeit der Nachtjagd ist abgelaufen." : "Der Fund wurde erkannt, konnte aber nicht gespeichert werden.";
    $("#huntProof").textContent = "Keine Wertung";
  }
}

function closeCamera() { stopCameraOnly(); $("#huntCamera").classList.add("hidden"); $("#huntIntro").classList.remove("hidden"); $("#huntProgress").style.width = "0%"; renderHunt(currentState); }
function continueHunt() { $("#huntSuccess").classList.add("hidden"); $("#huntIntro").classList.remove("hidden"); $("#huntProgress").style.width = "0%"; renderHunt(currentState); }
function stopCameraOnly() { if (animationFrame) cancelAnimationFrame(animationFrame); animationFrame = null; stream?.getTracks().forEach(track => track.stop()); stream = null; $("#huntVideo").srcObject = null; clearCanvas(); }
function clearCanvas() { const canvas = $("#huntOverlay"); canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }
function setStatus(message, isError = false) { $("#huntStatus").textContent = message; $("#huntStatus").classList.toggle("error", isError); }
