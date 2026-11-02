const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const normalizePhone = value => String(value || "").replace(/[\s().-]/g, "").replace(/^00/, "+");
const validPhone = value => /^\+?[1-9]\d{7,14}$/.test(value);
const isoNow = () => new Date().toISOString();
const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

async function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature || !signature.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = "sha256=" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

function authorized(request, env) {
  const expected = env.ADMIN_API_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function readJson(request, maxBytes = 256 * 1024) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("INVALID_JSON"); }
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
  if (!await verifySignature(rawBody, request.headers.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET)) {
    return json({ error: "Signature webhook invalide." }, 401);
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch { return json({ error: "JSON invalide." }, 400); }

  const statements = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const phone = normalizePhone(message.from);
        if (!validPhone(phone) || !message.id) continue;
        const body = message.text?.body || message.button?.text ||
          message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
        const sender = (value.contacts || []).find(item =>
          normalizePhone(item?.wa_id).replace(/^\+/, "") === phone.replace(/^\+/, ""));
        const receivedAt = isoNow();
        statements.push(env.DB.prepare(
          "INSERT OR IGNORE INTO webhook_messages (message_id, phone, sender_name, message_type, message_text, received_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(text(message.id, 200), phone, text(sender?.profile?.name, 100),
          text(message.type || "unknown", 40), text(body, 1200), receivedAt, JSON.stringify(message)));
        // Inbound replies update the contact's last interaction and reopen its conversation.
        statements.push(env.DB.prepare(
          "INSERT INTO wa_contacts (phone, display_name, consent_status, created_at, updated_at) VALUES (?, ?, 'unknown', ?, ?) ON CONFLICT(phone) DO UPDATE SET display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE wa_contacts.display_name END, updated_at=excluded.updated_at"
        ).bind(phone, text(sender?.profile?.name, 100), receivedAt, receivedAt));
        statements.push(env.DB.prepare(
          "UPDATE wa_contacts SET last_interaction_at = ?, conversation_state = 'active', updated_at = ? WHERE phone = ?"
        ).bind(receivedAt, receivedAt, phone));
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status.id) continue;
        statements.push(env.DB.prepare(
          "INSERT INTO webhook_statuses (message_id, recipient_id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET recipient_id=excluded.recipient_id, status=excluded.status, updated_at=excluded.updated_at"
        ).bind(text(status.id, 200), text(status.recipient_id, 40),
          text(status.status || "unknown", 30), isoNow()));
      }
    }
  }
  if (statements.length) await env.DB.batch(statements);
  return new Response("EVENT_RECEIVED", { status: 200, headers: { "content-type": "text/plain" } });
}

async function listContacts(env, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const status = url.searchParams.get("consent_status");
  const where = status && ["unknown", "opted_in", "opted_out"].includes(status) ? "WHERE consent_status = ?" : "";
  const stmt = env.DB.prepare(`SELECT id, phone, display_name, consent_status, consent_source, consent_at,
    opted_out_at, last_contacted_at, cooldown_until, last_interaction_at, conversation_state, created_at, updated_at
    FROM wa_contacts ${where} ORDER BY COALESCE(last_contacted_at, '1970-01-01') ASC, created_at ASC LIMIT ?`);
  const result = status && ["unknown", "opted_in", "opted_out"].includes(status)
    ? await stmt.bind(status, limit).all() : await stmt.bind(limit).all();
  return json({ contacts: result.results || [] });
}

async function importContacts(request, env) {
  const body = await readJson(request);
  if (!Array.isArray(body.contacts) || body.contacts.length > 1000) return json({ error: "Fournis une liste de 1 à 1000 contacts." }, 400);
  const now = isoNow();
  const statements = [];
  let rejected = 0;
  for (const item of body.contacts) {
    const phone = normalizePhone(item.phone);
    if (!validPhone(phone)) { rejected++; continue; }
    statements.push(env.DB.prepare(
      "INSERT INTO wa_contacts (phone, display_name, consent_status, created_at, updated_at) VALUES (?, ?, 'unknown', ?, ?) ON CONFLICT(phone) DO UPDATE SET display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE wa_contacts.display_name END, updated_at=excluded.updated_at"
    ).bind(phone, text(item.name || item.display_name, 100), now, now));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ imported_or_updated: statements.length, rejected, consent_default: "unknown" }, 201);
}

async function selectDailyContacts(env, url) {
  const today = dayKey();
  const max = Math.min(5, Math.max(1, Number(url.searchParams.get("limit")) || 5));
  const settings = await env.DB.prepare("SELECT daily_limit, cooldown_days, paused FROM wa_settings WHERE id = 1").first();
  if (!settings || settings.paused) return json({ date: today, paused: true, contacts: [], message: "WA Orbit est en pause." });
  const limit = Math.min(max, settings.daily_limit);
  const already = await env.DB.prepare("SELECT COUNT(*) AS n FROM wa_daily_selections WHERE selection_date = ?").bind(today).first();
  const remaining = Math.max(0, limit - Number(already?.n || 0));
  if (!remaining) return json({ date: today, paused: false, contacts: [], remaining: 0, message: "Quota quotidien déjà atteint." });

  const candidates = await env.DB.prepare(`
    SELECT c.id, c.phone, c.display_name, c.last_contacted_at, c.cooldown_until
    FROM wa_contacts c
    WHERE c.consent_status = 'opted_in'
      AND c.conversation_state <> 'active'
      AND (c.cooldown_until IS NULL OR c.cooldown_until <= ?)
      AND NOT EXISTS (SELECT 1 FROM wa_daily_selections d WHERE d.contact_id = c.id AND d.selection_date = ?)
    ORDER BY COALESCE(c.last_contacted_at, '1970-01-01') ASC, c.created_at ASC
    LIMIT ?
  `).bind(isoNow(), today, remaining).all();
  const rows = candidates.results || [];
  if (rows.length) await env.DB.batch(rows.map(contact => env.DB.prepare(
    "INSERT OR IGNORE INTO wa_daily_selections (selection_date, contact_id, state, selected_at) VALUES (?, ?, 'selected', ?)"
  ).bind(today, contact.id, isoNow())));
  return json({ date: today, paused: false, contacts: rows, selected: rows.length,
    remaining: Math.max(0, remaining - rows.length), cooldown_days: settings.cooldown_days,
    note: "Seuls les contacts ayant explicitement accepté les messages sont éligibles." });
}

async function recordContact(request, env, id) {
  const body = await readJson(request);
  const contact = await env.DB.prepare("SELECT id, phone, consent_status FROM wa_contacts WHERE id = ?").bind(id).first();
  if (!contact) return json({ error: "Contact introuvable." }, 404);
  if (body.action === "opt_out") {
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_contacts SET consent_status='opted_out', opted_out_at=?, conversation_state='closed', updated_at=? WHERE id=?")
        .bind(isoNow(), isoNow(), id),
      env.DB.prepare("UPDATE wa_daily_selections SET state='cancelled' WHERE contact_id=? AND state IN ('selected','queued')").bind(id)
    ]);
    return json({ ok: true, contact_id: id, consent_status: "opted_out" });
  }
  if (body.action === "opt_in") {
    await env.DB.prepare("UPDATE wa_contacts SET consent_status='opted_in', consent_source=?, consent_at=?, opted_out_at=NULL, updated_at=? WHERE id=?")
      .bind(text(body.consent_source || "admin_recorded", 80), isoNow(), isoNow(), id).run();
    return json({ ok: true, contact_id: id, consent_status: "opted_in" });
  }
  if (body.action === "sent") {
    if (contact.consent_status !== "opted_in") return json({ error: "Consentement explicite requis avant tout envoi." }, 403);
    const settings = await env.DB.prepare("SELECT cooldown_days FROM wa_settings WHERE id=1").first();
    const days = Math.min(365, Math.max(1, Number(settings?.cooldown_days) || 30));
    const now = new Date();
    const cooldown = new Date(now.getTime() + days * 86400000).toISOString();
    const date = dayKey(now);
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_contacts SET last_contacted_at=?, cooldown_until=?, conversation_state='waiting', updated_at=? WHERE id=?")
        .bind(now.toISOString(), cooldown, now.toISOString(), id),
      env.DB.prepare("UPDATE wa_daily_selections SET state='sent', sent_at=? WHERE contact_id=? AND selection_date=?")
        .bind(now.toISOString(), id, date)
    ]);
    return json({ ok: true, contact_id: id, last_contacted_at: now.toISOString(), cooldown_until: cooldown, cooldown_days: days });
  }
  if (body.action === "conversation_active") {
    await env.DB.prepare("UPDATE wa_contacts SET conversation_state='active', last_interaction_at=?, updated_at=? WHERE id=?")
      .bind(isoNow(), isoNow(), id).run();
    return json({ ok: true, contact_id: id, conversation_state: "active" });
  }
  if (body.action === "conversation_closed") {
    await env.DB.prepare("UPDATE wa_contacts SET conversation_state='closed', updated_at=? WHERE id=?")
      .bind(isoNow(), id).run();
    return json({ ok: true, contact_id: id, conversation_state: "closed" });
  }
  return json({ error: "Action inconnue. Actions: opt_in, opt_out, sent, conversation_active, conversation_closed." }, 400);
}

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: "Base D1 non configurée." }, 503);
  if (!authorized(request, env)) return json({ error: "Authentification requise." }, 401);
  if (request.method === "GET" && url.pathname === "/api/safety") {
    const row = await env.DB.prepare("SELECT paused, daily_limit, cooldown_days FROM wa_settings WHERE id=1").first();
    return json(row || { paused: true, daily_limit: 5, cooldown_days: 30 });
  }
  if (request.method === "POST" && url.pathname === "/api/safety/pause") {
    const body = await readJson(request);
    await env.DB.prepare("UPDATE wa_settings SET paused=?, updated_at=? WHERE id=1")
      .bind(body.paused !== false ? 1 : 0, isoNow()).run();
    return json({ ok: true, paused: body.paused !== false });
  }
  if (request.method === "GET" && url.pathname === "/api/contacts") return listContacts(env, url);
  if (request.method === "POST" && url.pathname === "/api/contacts/import") return importContacts(request, env);
  if (request.method === "GET" && url.pathname === "/api/contacts/daily-selection") return selectDailyContacts(env, url);
  const match = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]{36})\/action$/i);
  if (request.method === "POST" && match) return recordContact(request, env, match[1]);
  return json({ error: "Route API introuvable." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      try {
        if (!env.DB) return json({ status: "degraded", storage: "unconfigured" }, 503);
        await env.DB.prepare("SELECT 1").first();
        await env.DB.prepare("SELECT 1 FROM wa_settings LIMIT 1").first();
        return json({ status: "ok", runtime: "cloudflare-workers", storage: "d1", contact_cooldown: true });
      } catch {
        return json({ status: "degraded", storage: "d1", migrations_required: true }, 503);
      }
    }
    if (url.pathname === "/webhook" && request.method === "GET") return handleWebhookVerification(url, env);
    if (url.pathname === "/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      try { return await handleApi(request, env, url); }
      catch (error) {
        if (error.message === "PAYLOAD_TOO_LARGE") return json({ error: "Payload trop volumineux." }, 413);
        if (error.message === "INVALID_JSON") return json({ error: "JSON invalide." }, 400);
        return json({ error: "Erreur interne." }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("WA Orbit Cloudflare Worker is running.", { status: 200 });
  }
};
