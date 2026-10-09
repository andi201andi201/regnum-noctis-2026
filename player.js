const PROFILE_KEY = "regnum-noctis-player";

export const TEAM_STORIES = {
  draco: "Als die letzte Glut der alten Nacht fast erlosch, entfachten fünf Unbeugsame das Drachenfeuer neu. Aus ihrem Schwur entstand Draco – das Reich von Mut, Kraft und ungezähmtem Willen.",
  serpens: "In den verborgenen Gängen unter dem Mondtempel schlossen sich die klügsten Wandernden zusammen. So entstand Serpens – lautlos, wachsam und jeder Gegnerin stets einen Zug voraus.",
  lupus: "Ein einsamer Ruf führte die Verirrten durch den eisigen Nachtwald. Am Silbermond fanden sie zueinander und gründeten Lupus – ein Rudel, das gemeinsam stärker ist als jede Dunkelheit.",
  corvus: "Als der erste schwarze Stern erschien, versammelten sich seine Boten auf dem höchsten Turm. Daraus wurde Corvus – das Reich des scharfen Blicks, der Freiheit und verborgenen Wege.",
  noctua: "Im ältesten Observatorium wachten die Hüterinnen, während alle anderen schliefen. Ihr Wissen wurde zum Reich Noctua – ruhig, weise und im Dunkeln niemals blind."
};

export function getPlayerProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
  catch { return null; }
}

export function clearPlayerProfile() {
  localStorage.removeItem(PROFILE_KEY);
  window.dispatchEvent(new CustomEvent("regnum-player-changed", { detail: null }));
}

export function savePlayerProfile(name, teamId, membership = null) {
  const existing = getPlayerProfile();
  const profile = {
    id: membership?.id || existing?.id || crypto.randomUUID(),
    name: name.trim().slice(0, 32),
    teamId,
    joinedAt: membership?.joinedAt || existing?.joinedAt || Date.now()
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent("regnum-player-changed", { detail: profile }));
  return profile;
}
