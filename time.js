// Firebase provides the clock offset through .info/serverTimeOffset.
// Local demo sessions use the device clock until a server offset is available.
let serverTimeOffset = 0;

export function setServerTimeOffset(value) {
  serverTimeOffset = typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function serverNow() {
  return Date.now() + serverTimeOffset;
}
