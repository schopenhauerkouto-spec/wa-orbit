import "dotenv/config";
import { syncApproved } from "./src/index.js";

const required = ["ORBIT_API_URL", "ADMIN_API_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error("Configuration manquante :", missing.join(", "));
  console.error("Le connecteur utilise uniquement l'API officielle WhatsApp Business. Un compte WhatsApp personnel ne peut pas être connecté via ce runner.");
  process.exit(1);
}

const number = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const config = {
  baseUrl: process.env.ORBIT_API_URL,
  token: process.env.ADMIN_API_TOKEN,
  meta: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || "v26.0"
  },
  batchSize: number("ORBIT_BATCH_SIZE", 5, 1, 5),
  minDelayMs: number("ORBIT_MIN_DELAY_MS", 30000, 0, 300000)
};
const pollIntervalMs = number("ORBIT_POLL_INTERVAL_MS", 60000, 15000, 900000);
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
console.info("WA Orbit connector officiel WhatsApp Business actif.");
console.info("Pause, consentement, fenêtre de service et modèles approuvés restent contrôlés côté Worker.");

while (!stopping) {
  try {
    const results = await syncApproved(config);
    const sent = results.filter(item => item.status === "sent").length;
    const deferred = results.filter(item => item.reason === "emergency_pause").length;
    const failed = results.filter(item => item.status === "failed" || item.status === "sent_unconfirmed").length;
    if (results.length) console.info("Cycle terminé :", {actions: results.length, sent, deferred, failed});
  } catch (error) {
    console.error("Cycle WA Orbit indisponible :", String(error?.message || error));
  }
  if (!stopping) await sleep(pollIntervalMs);
}
console.info("WA Orbit connector arrêté proprement.");
