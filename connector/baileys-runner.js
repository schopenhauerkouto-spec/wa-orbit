import "dotenv/config";
import { OrbitClient } from "./src/client.js";
import { BaileysGroupConnector } from "./src/baileys.js";

const required = ["ORBIT_API_URL", "BAILEYS_CONNECTOR_TOKEN"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error("Configuration Baileys manquante :", missing.join(", "));
  process.exit(1);
}

if (process.env.BAILEYS_ENABLED !== "true") {
  console.error("BAILEYS_ENABLED=true est requis pour lancer le connecteur Baileys.");
  process.exit(1);
}

const orbit = new OrbitClient({
  baseUrl: process.env.ORBIT_API_URL,
  token: process.env.BAILEYS_CONNECTOR_TOKEN
});

const connector = new BaileysGroupConnector({
  orbit,
  authDir: process.env.BAILEYS_AUTH_DIR || "./data/baileys-auth",
  pairingNumber: process.env.BAILEYS_PAIRING_NUMBER || "",
  enforcement: process.env.BAILEYS_GROUP_ENFORCEMENT === "true",
  controlPollMs: Number(process.env.BAILEYS_CONTROL_POLL_MS || 30000)
});

process.once("SIGINT", async () => {
  await connector.stop();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await connector.stop();
  process.exit(0);
});

console.info("WA Orbit Baileys connector démarrage.");
console.info("Enforcement live:", process.env.BAILEYS_GROUP_ENFORCEMENT === "true");
await connector.start();
