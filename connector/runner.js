import "dotenv/config";
import { syncApproved } from "./src/index.js";
import { BaileysTransport } from "./src/baileys-transport.js";
import { OrbitClient } from "./src/client.js";

const required = ["ORBIT_API_URL", "ADMIN_API_TOKEN"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error("Configuration manquante :", missing.join(", "));
  process.exit(1);
}

const number = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

const orbit = new OrbitClient({
  baseUrl: process.env.ORBIT_API_URL,
  token: process.env.ADMIN_API_TOKEN
});

const transport = new BaileysTransport({
  authDir: process.env.BAILEYS_AUTH_DIR || "./.baileys-auth",
  phoneNumber: process.env.BAILEYS_PHONE_NUMBER || "",
  onMessage: message => orbit.ingestInbound(message),
  onReceipt: receipt => orbit.ingestReceipts([receipt])
});

const config = {
  baseUrl: process.env.ORBIT_API_URL,
  token: process.env.ADMIN_API_TOKEN,
  transport,
  batchSize: number("ORBIT_BATCH_SIZE", 5, 1, 5),
  minDelayMs: number("ORBIT_MIN_DELAY_MS", 30000, 0, 300000)
};
const pollIntervalMs = number("ORBIT_POLL_INTERVAL_MS", 60000, 15000, 900000);
let stopping = false;

const stop = async () => {
  stopping = true;
  await transport.stop();
};
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await transport.connect();
console.info("WA Orbit connector actif : Baileys = transport WhatsApp, Worker = cerveau et mémoire.");
console.info("Aucun contournement anti-spam n'est implémenté ; pause, consentement et autorisation restent côté Worker.");

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

await transport.stop();
console.info("WA Orbit connector arrêté proprement.");
