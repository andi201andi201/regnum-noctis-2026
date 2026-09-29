const $ = selector => document.querySelector(selector);

const TARGET = "bottle";
const REQUIRED_HOLD_MS = 1500;
const DETECTION_INTERVAL_MS = 180;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

let detector = null;
let stream = null;
let animationFrame = null;
let lastDetectionAt = 0;
let detectedSince = null;
let completed = false;

$("#startHunt").addEventListener("click", startHunt);
$("#cancelHunt").addEventListener("click", stopHunt);
$("#restartHunt").addEventListener("click", resetHunt);
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopHunt(); });

async function startHunt() {
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
    completed = false;
    detectedSince = null;
    setStatus("Sucht eine Flasche …");
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
  return ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    categoryAllowlist: [TARGET],
    scoreThreshold: 0.55,
    maxResults: 2
  });
}

function scanFrame(now) {
  const video = $("#huntVideo");
  if (!stream || completed) return;
  if (video.readyState >= 2 && now - lastDetectionAt >= DETECTION_INTERVAL_MS) {
    lastDetectionAt = now;
    const result = detector.detectForVideo(video, now);
    const detection = result.detections?.find(item => item.categories?.some(category => category.categoryName === TARGET));
    drawDetection(detection, video);
    updateHold(detection, now);
  }
  animationFrame = requestAnimationFrame(scanFrame);
}

function updateHold(detection, now) {
  if (!detection) {
    detectedSince = null;
    $("#huntProgress").style.width = "0%";
    setStatus("Sucht eine Flasche …");
    return;
  }
  detectedSince ??= now;
  const elapsed = now - detectedSince;
  const progress = Math.min(100, elapsed / REQUIRED_HOLD_MS * 100);
  $("#huntProgress").style.width = `${progress}%`;
  setStatus(progress < 100 ? "Flasche erkannt – ruhig halten …" : "Flasche bestätigt!");
  if (progress >= 100) finishHunt();
}

function drawDetection(detection, video) {
  const canvas = $("#huntOverlay");
  const ctx = canvas.getContext("2d");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!detection?.boundingBox) return;
  const box = detection.boundingBox;
  ctx.strokeStyle = "#d9b665";
  ctx.lineWidth = Math.max(4, canvas.width / 220);
  ctx.shadowColor = "#d9b665";
  ctx.shadowBlur = 18;
  ctx.strokeRect(box.originX, box.originY, box.width, box.height);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(8,9,13,.82)";
  ctx.fillRect(box.originX, Math.max(0, box.originY - 35), 145, 35);
  ctx.fillStyle = "#f1eadb";
  ctx.font = `600 ${Math.max(17, canvas.width / 45)}px Inter, sans-serif`;
  ctx.fillText("FLASCHE", box.originX + 10, Math.max(25, box.originY - 10));
}

function finishHunt() {
  completed = true;
  const proof = createProofCode();
  stopCameraOnly();
  $("#huntCamera").classList.add("hidden");
  $("#huntSuccess").classList.remove("hidden");
  $("#huntProof").textContent = `Nachtbeweis ${proof} · ${new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
}

function stopHunt() {
  stopCameraOnly();
  $("#huntCamera").classList.add("hidden");
  $("#huntIntro").classList.remove("hidden");
  $("#startHunt").disabled = false;
  $("#huntProgress").style.width = "0%";
}

function resetHunt() {
  $("#huntSuccess").classList.add("hidden");
  $("#huntIntro").classList.remove("hidden");
  $("#startHunt").disabled = false;
  $("#huntProgress").style.width = "0%";
}

function stopCameraOnly() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $("#huntVideo").srcObject = null;
  clearCanvas();
}

function clearCanvas() { const canvas = $("#huntOverlay"); canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }
function setStatus(message, isError = false) { $("#huntStatus").textContent = message; $("#huntStatus").classList.toggle("error", isError); }
function createProofCode() { const values = new Uint16Array(2); crypto.getRandomValues(values); return [...values].map(value => value.toString(36).toUpperCase().slice(-2).padStart(2, "0")).join("-"); }
