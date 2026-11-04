import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode-terminal";

const statusFromBaileys = status => {
  const map = {
    0: "failed",
    1: "sent",
    2: "sent",
    3: "delivered",
    4: "read",
    5: "read"
  };
  return map[Number(status)] || null;
};

const jidToPhone = jid => {
  const value = String(jid || "");
  if (!value.endsWith("@s.whatsapp.net")) return "";
  return value.replace("@s.whatsapp.net", "");
};

const messageText = message => {
  const m = message?.message || {};
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  ).trim().slice(0, 1200);
};

const messageType = message => {
  const m = message?.message || {};
  if (m.conversation || m.extendedTextMessage) return "text";
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.documentMessage) return "document";
  if (m.audioMessage) return "audio";
  return "unknown";
};

export class BaileysTransport {
  constructor({
    authDir = "./.baileys-auth",
    phoneNumber = "",
    logger = console,
    onMessage,
    onReceipt,
    socketFactory = makeWASocket,
    authStateFactory = useMultiFileAuthState
  } = {}) {
    this.authDir = authDir;
    this.phoneNumber = String(phoneNumber || "").replace(/\D/g, "");
    this.logger = logger;
    this.onMessage = onMessage;
    this.onReceipt = onReceipt;
    this.socketFactory = socketFactory;
    this.authStateFactory = authStateFactory;
    this.sock = null;
    this.startPromise = null;
    this.stopping = false;
  }

  async connect() {
    if (this.stopping) throw new Error("BAILEYS_TRANSPORT_STOPPING");
    if (this.sock) return this.sock;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.#start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #start() {
    const { state, saveCreds } = await this.authStateFactory(this.authDir);
    const sock = this.socketFactory({
      auth: state,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !state.creds.registered && this.phoneNumber) {
        try {
          const code = await sock.requestPairingCode(this.phoneNumber);
          this.logger.info?.("Code de jumelage WhatsApp :", code);
        } catch (error) {
          this.logger.error?.("Échec du code de jumelage :", String(error?.message || error));
        }
      } else if (qr && !state.creds.registered) {
        this.logger.info?.("QR WhatsApp reçu. Scanne-le avec le terminal/flux QR affiché ci-dessous.");
        QRCode.generate(qr, { small: true }, rendered => this.logger.info?.("\n" + rendered));
      }

      if (connection === "open") {
        this.logger.info?.("WA Orbit connecté à WhatsApp via Baileys.");
      }

      if (connection === "close") {
        this.sock = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (!this.stopping && code !== DisconnectReason.loggedOut) {
          this.logger.warn?.("Connexion Baileys fermée, reconnexion.");
          setTimeout(() => this.connect().catch(error =>
            this.logger.error?.("Reconnexion Baileys impossible :", String(error?.message || error))
          ), 1500);
        } else if (code === DisconnectReason.loggedOut) {
          this.logger.error?.("Session WhatsApp déconnectée volontairement. Une nouvelle association est nécessaire.");
        }
      }
    });

    sock.ev.on("messages.upsert", async event => {
      if (event?.requestId) return;
      for (const message of event.messages || []) {
        if (!message?.key?.id || message.key.fromMe) continue;
        const phone = jidToPhone(message.key.remoteJid);
        if (!phone) continue;
        try {
          await this.onMessage?.({
            id: message.key.id,
            phone,
            senderName: message.pushName || "",
            type: messageType(message),
            text: messageText(message),
            timestamp: message.messageTimestamp
              ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
              : new Date().toISOString(),
            raw: message
          });
        } catch (error) {
          this.logger.error?.("Ingestion message Baileys échouée :", String(error?.message || error));
        }
      }
    });

    sock.ev.on("messages.update", async updates => {
      for (const item of updates || []) {
        const id = item?.key?.id;
        const status = statusFromBaileys(item?.update?.status);
        if (!id || !status) continue;
        const phone = jidToPhone(item.key.remoteJid);
        if (!phone) continue;
        try {
          await this.onReceipt?.({
            id,
            phone,
            status,
            timestamp: new Date().toISOString(),
            errors: item.update?.messageStubParameters || []
          });
        } catch (error) {
          this.logger.error?.("Ingestion reçu Baileys échouée :", String(error?.message || error));
        }
      }
    });

    return sock;
  }

  async send({ phone, body }) {
    const normalized = String(phone || "").replace(/\D/g, "");
    if (!normalized || !body) throw new Error("WHATSAPP_PHONE_AND_BODY_REQUIRED");
    const sock = await this.connect();
    const jid = normalized + "@s.whatsapp.net";
    const result = await sock.sendMessage(jid, { text: String(body).slice(0, 4096) });
    return { id: result?.key?.id || null, raw: result };
  }

  async stop() {
    this.stopping = true;
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try { sock.end(undefined); } catch {}
    }
  }
}
