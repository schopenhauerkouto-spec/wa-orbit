import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { inspectGroupMessage } from "../../src/group-moderation-policy.js";
import { mkdir, chmod, rm } from "node:fs/promises";
import path from "node:path";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function extractText(message) {
  const content = message?.message || {};
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    ""
  ).slice(0, 4096);
}

function senderId(message) {
  return String(message?.key?.participant || message?.key?.remoteJid || "").slice(0, 128);
}

function isGroupJid(jid) {
  return String(jid || "").endsWith("@g.us");
}

function normalizeJid(jid) {
  return String(jid || "").split(":")[0];
}

function participantIsAdmin(participant) {
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

export class BaileysGroupConnector {
  constructor({
    orbit,
    authDir = "./data/baileys-auth",
    pairingNumber = "",
    enforcement = false,
    controlPollMs = 30000
  }) {
    this.orbit = orbit;
    this.authDir = path.resolve(authDir);
    this.pairingNumber = String(pairingNumber || "").replace(/\D/g, "");
    this.enforcement = enforcement === true;
    this.controlPollMs = Math.max(10000, Number(controlPollMs) || 30000);
    this.policy = null;
    this.safety = { paused: true };
    this.setup = {
      mode: this.pairingNumber ? "pairing" : "qr",
      pairingNumber: this.pairingNumber,
      resetRequestedAt: null
    };
    this.policyLoadedAt = 0;
    this.stopping = false;
    this.resetting = false;
    this.pairingRequested = false;
    this.lastResetHandledAt = null;
    this.socket = null;
    this.history = new Map();
    this.adminCache = new Map();
    this.controlTimer = null;
  }

  async refreshControlPlane(force = false) {
    const now = Date.now();
    if (!force && this.policy && now - this.policyLoadedAt < this.controlPollMs) return;
    const control = await this.orbit.baileysConfig();
    this.policy = control.policy;
    this.safety = control.safety || { paused: true };
    this.setup = control.setup || this.setup;
    this.policyLoadedAt = now;
    const resetRequestedAt = this.setup?.resetRequestedAt;
    if (
      resetRequestedAt &&
      (!this.lastResetHandledAt || Date.parse(resetRequestedAt) > Date.parse(this.lastResetHandledAt))
    ) {
      this.lastResetHandledAt = resetRequestedAt;
      await this.resetSession();
    }
  }

  remember(jid, item) {
    const list = this.history.get(jid) || [];
    list.push(item);
    const cutoff = Date.now() - 10 * 60 * 1000;
    const filtered = list.filter(entry => Date.parse(entry.timestamp) >= cutoff).slice(-100);
    this.history.set(jid, filtered);
    return filtered;
  }

  async isBotAdmin(jid) {
    const cached = this.adminCache.get(jid);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value = false;
    try {
      const metadata = await this.socket.groupMetadata(jid);
      const botJid = normalizeJid(this.socket.user?.id);
      const participant = (metadata.participants || []).find(item => normalizeJid(item.id) === botJid);
      value = participantIsAdmin(participant);
    } catch (error) {
      await this.safeEvent({
        kind: "baileys-capability-error",
        text: `Impossible de vérifier les droits du bot dans ${jid}: ${String(error?.message || error).slice(0, 300)}`,
        groupId: jid
      });
    }

    this.adminCache.set(jid, { value, expiresAt: Date.now() + 60_000 });
    return value;
  }

  async safeEvent(event) {
    try {
      await this.orbit.baileysEvent(event);
    } catch (error) {
      console.error("WA Orbit control-plane event error:", String(error?.message || error));
    }
  }

  async heartbeat(connected) {
    let canDeleteMessages = false;
    if (connected && this.socket) {
      try {
        const groups = await this.socket.groupFetchAllParticipating();
        for (const jid of Object.keys(groups || {})) {
          if (await this.isBotAdmin(jid)) {
            canDeleteMessages = true;
            break;
          }
        }
      } catch {}
    }
    await this.orbit.baileysHeartbeat({
      connected,
      canDeleteMessages,
      userId: this.socket?.user?.id || ""
    });
  }

  async moderate(message) {
    const jid = message?.key?.remoteJid;
    if (!isGroupJid(jid) || message?.key?.fromMe) return;
    const text = extractText(message);
    if (!text.trim()) return;

    await this.refreshControlPlane();
    const sender = senderId(message);
    const timestamp = Number(message?.messageTimestamp)
      ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString();

    const previous = this.history.get(jid) || [];
    const senderAdmin = await this.isBotAdminForSender(jid, sender);
    const result = inspectGroupMessage({
      policy: this.policy,
      text,
      senderId: sender,
      senderIsAdmin: senderAdmin,
      history: previous,
      now: timestamp
    });

    this.remember(jid, { senderId: sender, text, timestamp });

    if (result.decision === "allow" || result.decision === "observe_only") return;

    await this.safeEvent({
      kind: "group-moderation-decision",
      text: `Décision ${result.decision} dans ${jid}`,
      groupId: jid,
      senderId: sender,
      decision: result.decision,
      violations: result.violations
    });

    const liveAllowed =
      this.enforcement &&
      this.policy?.enabled === true &&
      this.policy?.mode === "enforce" &&
      this.safety?.paused !== true &&
      result.violations?.length > 0;

    if (!liveAllowed) return;

    if (!await this.isBotAdmin(jid)) {
      await this.safeEvent({
        kind: "group-moderation-capability-missing",
        text: `Le bot n'est pas administrateur de ${jid}; aucune suppression exécutée.`,
        groupId: jid,
        senderId: sender,
        decision: result.decision,
        violations: result.violations
      });
      return;
    }

    try {
      await this.socket.sendMessage(jid, { delete: message.key });
      await this.safeEvent({
        kind: "group-moderation-action",
        text: `Message supprimé par la politique de modération dans ${jid}.`,
        groupId: jid,
        senderId: sender,
        decision: "message_deleted",
        violations: result.violations
      });
    } catch (error) {
      await this.safeEvent({
        kind: "group-moderation-action-failed",
        text: `Échec de suppression dans ${jid}: ${String(error?.message || error).slice(0, 300)}`,
        groupId: jid,
        senderId: sender,
        decision: "delete_failed",
        violations: result.violations
      });
    }
  }

  async isBotAdminForSender(jid, sender) {
    try {
      const metadata = await this.socket.groupMetadata(jid);
      const participant = (metadata.participants || []).find(item => normalizeJid(item.id) === normalizeJid(sender));
      return participantIsAdmin(participant);
    } catch {
      return false;
    }
  }

  async connect() {
    await mkdir(this.authDir, { recursive: true });
    try { await chmod(this.authDir, 0o700); } catch {}

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("WA Orbit"),
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    this.socket = socket;
    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr && !state.creds.registered && this.pairingNumber && !this.pairingRequested) {
        this.pairingRequested = true;
        try {
          const code = await socket.requestPairingCode(this.pairingNumber);
          console.info("WA Orbit Baileys pairing code:", code);
        } catch (error) {
          this.pairingRequested = false;
          console.error("Impossible de générer le code d'appairage:", String(error?.message || error));
        }
      }

      if (connection === "open") {
        this.pairingRequested = false;
        console.info("WA Orbit Baileys connecté:", socket.user?.id || "unknown");
        await this.heartbeat(true);
      }

      if (connection === "close" && !this.stopping) {
        await this.heartbeat(false);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          console.error("Session Baileys déconnectée définitivement. Supprime l'auth state puis ré-appaire le compte.");
          return;
        }
        console.warn("Baileys déconnecté; reconnexion dans 5 s.");
        await sleep(5000);
        if (!this.stopping) await this.connect();
      }
    });

    socket.ev.on("messages.upsert", async ({ type, messages }) => {
      if (type !== "notify") return;
      for (const message of messages || []) {
        try {
          await this.moderate(message);
        } catch (error) {
          console.error("Erreur de modération Baileys:", String(error?.stack || error));
        }
      }
    });

    return socket;
  }

  async start() {
    await this.refreshControlPlane(true);
    if (this.safety?.paused !== true) {
      console.warn("Le système de sécurité global n'est pas en pause; le connecteur respecte néanmoins la politique et le drapeau d'enforcement.");
    }
    return this.connect();
  }

  async stop() {
    this.stopping = true;
    try { this.socket?.end(undefined); } catch {}
    await this.orbit.baileysHeartbeat({ connected: false, canDeleteMessages: false, userId: "" });
  }
}
