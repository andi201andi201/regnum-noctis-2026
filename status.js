let lastStoreError = "";
let errorTimeout = null;

if (typeof window.regnumConnectionState !== "boolean") window.regnumConnectionState = null;

export function setConnectionStatus(connected) {
  window.regnumConnectionState = connected === true ? true : connected === false ? false : null;
  renderConnectionStatus();
  // Page modules may set their initial label after the first Firebase event.
  setTimeout(renderConnectionStatus, 0);
}

export function renderConnectionStatus() {
  const connected = window.regnumConnectionState;
  const label = lastStoreError ? "Live-Daten nicht verfügbar" : connected === true ? "Live verbunden" : connected === false ? "Offline · wartet auf Verbindung" : "Verbindung wird hergestellt";
  document.querySelectorAll("#connectionText, #displayConnection").forEach(element => {
    element.textContent = label;
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    const indicator = element.closest(".live-pill")?.querySelector("i");
    if (indicator) indicator.style.background = connected === true && !lastStoreError ? "" : "#c18a32";
  });

  const needsNotice = !!document.querySelector("#loginPanel, #huntScanner");
  let notice = document.querySelector("#regnumConnectionNotice");
  if (!notice && needsNotice && document.body) {
    notice = document.createElement("div");
    notice.id = "regnumConnectionNotice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.setAttribute("aria-atomic", "true");
    notice.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:200;box-sizing:border-box;max-width:92vw;width:560px;padding:10px 14px;border:1px solid #c18a3266;border-radius:9px;background:#171923;color:#f4ead0;font:inherit;font-size:.78rem;text-align:center;box-shadow:0 4px 18px #0006";
    document.body.append(notice);
  }
  if (notice) {
    const message = lastStoreError || (connected === false ? "Verbindung unterbrochen. Bitte die Internetverbindung prüfen." : "");
    notice.textContent = message;
    notice.hidden = !message;
  }
}

function describeStoreError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied") || code.includes("permission_denied")) return "Zugriff nicht erlaubt. Bitte Anmeldung und Berechtigungen prüfen.";
  if (code.includes("operation-not-allowed")) return "Die Teilnahme-Anmeldung ist noch nicht aktiviert. Bitte die Spielleitung informieren.";
  if (code.includes("network") || code.includes("disconnected")) return "Die Live-Daten sind gerade nicht erreichbar. Bitte die Internetverbindung prüfen.";
  return "Die Live-Daten konnten nicht geladen oder gespeichert werden. Bitte die Verbindung und Anmeldung prüfen.";
}

window.addEventListener("regnum-connection", event => setConnectionStatus(event.detail?.connected));
window.addEventListener("regnum-store-error", event => {
  lastStoreError = describeStoreError(event.detail);
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => { lastStoreError = ""; renderConnectionStatus(); }, 12000);
  renderConnectionStatus();
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderConnectionStatus, { once: true });
else renderConnectionStatus();
