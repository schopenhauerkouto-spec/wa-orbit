const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const normalizePhone = value => String(value || "").replace(/[\\s().-]/g, "").replace(/^00/, "+");
const validPhone = value => /^\\+?[1-9]\\d{7,14}$/.test(value);

async function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature || !signature.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = "sha256=" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

async function handleWebhookVerification(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (mode !== "subscribe" || !env.WHATSAPP_VERIFY_TOKEN || token !== env.WHATSAPP_VERIFY_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function handleWebhook(request, env) {
  if (!env.DB || !env.WHATSAPP_APP_SECRET) return json({ error: "Webhook non configuré." }, 503);
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > 2 * 1024 * 1024) return json({ error: "Payload trop volumineux." }, 413);
  const valid = await verifySignature(rawBody, request.headers.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET);
  if (!valid) return json({ error: "Signature webhook invalide." }, 401);

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch { return json({ error: "JSON invalide." }, 400); }

  const statements = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const phone = normalizePhone(message.from);
        if (!validPhone(phone)) continue;
        const messageId = String(message.id || "");
        if (!messageId) continue;
        const text = message.text?.body || message.button?.text ||
          message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
        const type = String(message.type || "unknown").slice(0, 40);
        const sender = (value.contacts || []).find(item =>
          normalizePhone(item?.wa_id).replace(/^\\+/, "") === phone.replace(/^\\+/, "")
        );
        const senderName = String(sender?.profile?.name || "").slice(0, 100);
        statements.push(env.DB.prepare(
          "INSERT OR IGNORE INTO webhook_messages (message_id, phone, sender_name, message_type, message_text, received_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(messageId, phone, senderName, type, String(text).slice(0, 1200), new Date().toISOString(), JSON.stringify(message)));
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = String(status.id || "");
        if (!messageId) continue;
        statements.push(env.DB.prepare(
          "INSERT INTO webhook_statuses (message_id, recipient_id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET recipient_id=excluded.recipient_id, status=excluded.status, updated_at=excluded.updated_at"
        ).bind(messageId, String(status.recipient_id || ""), String(status.status || "unknown"), new Date().toISOString()));
      }
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "content-type": "text/plain" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      try {
        if (!env.DB) return json({ status: "degraded", storage: "unconfigured" }, 503);
        await env.DB.prepare("SELECT 1").first();
        return json({ status: "ok", runtime: "cloudflare-workers", storage: "d1" });
      } catch {
        return json({ status: "degraded", storage: "d1" }, 503);
      }
    }
    if (url.pathname === "/webhook" && request.method === "GET") return handleWebhookVerification(url, env);
    if (url.pathname === "/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "API Cloudflare en cours de migration." }, 501);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("WA Orbit Cloudflare Worker is running.", { status: 200 });
  }
};
