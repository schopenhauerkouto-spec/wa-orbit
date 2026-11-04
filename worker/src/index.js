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

  let receivedMessages = 0;
  let duplicateMessages = 0;
  let updatedStatuses = 0;

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const phone = normalizePhone(message.from);
        if (!validPhone(phone) || !message.id) continue;
        const body = text(message.text?.body || message.button?.text ||
          message.interactive?.button_reply?.title || message.interactive?.list_reply?.title ||
          message.image?.caption || message.video?.caption || message.document?.caption || "", 1200);
        const sender = (value.contacts || []).find(item =>
          normalizePhone(item?.wa_id).replace(/^\+/, "") === phone.replace(/^\+/, ""));
        const receivedAt = message.timestamp && Number.isFinite(Number(message.timestamp))
          ? new Date(Number(message.timestamp) * 1000).toISOString() : isoNow();

        const inserted = await env.DB.prepare(
          "INSERT OR IGNORE INTO webhook_messages (message_id, phone, sender_name, message_type, message_text, received_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(text(message.id, 200), phone, text(sender?.profile?.name, 100),
          text(message.type || "unknown", 40), body, receivedAt, JSON.stringify(message)).run();

        // Meta can retry webhook deliveries. A duplicate must not alter memory or create another draft.
        if (Number(inserted?.meta?.changes || 0) !== 1) {
          duplicateMessages++;
          continue;
        }

        const displayName = text(sender?.profile?.name, 100);
        await env.DB.prepare(
          "INSERT INTO wa_contacts (id, phone, display_name, consent_status, created_at, updated_at) VALUES (?, ?, ?, 'unknown', ?, ?) ON CONFLICT(phone) DO UPDATE SET display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE wa_contacts.display_name END, updated_at=excluded.updated_at"
        ).bind(crypto.randomUUID(), phone, displayName, receivedAt, receivedAt).run();
        await env.DB.prepare(
          "UPDATE wa_contacts SET last_interaction_at = ?, conversation_state = 'active', updated_at = ? WHERE phone = ?"
        ).bind(receivedAt, receivedAt, phone).run();

        const contact = await env.DB.prepare(
          "SELECT id, consent_status FROM wa_contacts WHERE phone=?"
        ).bind(phone).first();

        if (contact && body) {
          const topics = detectTopics(body);
          if (contact.consent_status === "opted_in") {
            const previous = await env.DB.prepare(
              "SELECT summary, last_topics_json FROM wa_conversation_memory WHERE contact_id=?"
            ).bind(contact.id).first();
            const summaryLine = "Message reçu: " + body.slice(0, 240);
            const summary = [previous?.summary || "", summaryLine].filter(Boolean).slice(-5).join("\n").slice(-1600);
            const previousTopics = parseJsonSafe(previous?.last_topics_json, []);
            const mergedTopics = [...new Set([...previousTopics, ...topics])].slice(0, 20);
            await env.DB.prepare(
              "INSERT INTO wa_conversation_memory(contact_id,summary,last_intent,last_topics_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET summary=excluded.summary,last_intent=excluded.last_intent,last_topics_json=excluded.last_topics_json,updated_at=excluded.updated_at"
            ).bind(contact.id, summary, topics.length ? "discuss_topic" : "reply_naturally", JSON.stringify(mergedTopics), receivedAt).run();

            for (const topic of topics) {
              await env.DB.prepare(
                "INSERT INTO wa_relationship_memory(contact_id,memory_type,content,source,importance,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
              ).bind(contact.id, "topic", "Sujet abordé: " + topic, "conversation", 3, receivedAt, receivedAt, receivedAt).run();
            }

            const draftBody = topics.length
              ? "Je vois 👀 Ça m’intéresse. Tu peux m’en dire un peu plus ?"
              : "Bien reçu. Merci pour ton message 😊";
            await createDraft(env, {
              contactId: contact.id, sourceType: "conversation", sourceId: text(message.id, 200),
              intent: topics.length ? "discuss_topic" : "reply_naturally",
              tone: "natural", body: draftBody, provider: "rule_engine"
            });
          }
        }
        receivedMessages++;
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status.id) continue;
        const providerStatus = ["sent", "delivered", "read", "failed"].includes(status.status)
          ? status.status : "unknown";
        const statusAt = status.timestamp && Number.isFinite(Number(status.timestamp))
          ? new Date(Number(status.timestamp) * 1000).toISOString() : isoNow();
        const errors = Array.isArray(status.errors) ? status.errors : [];
        const errorText = errors.length ? text(errors.map(e => e.title || e.message || e.code).join("; "), 500) : "";

        await env.DB.prepare(
          "INSERT INTO webhook_statuses (message_id, recipient_id, status, updated_at, status_timestamp, errors_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET recipient_id=excluded.recipient_id, status=excluded.status, updated_at=excluded.updated_at, status_timestamp=excluded.status_timestamp, errors_json=excluded.errors_json"
        ).bind(text(status.id, 200), text(status.recipient_id, 40), providerStatus, isoNow(), statusAt, JSON.stringify(errors)).run();

        const action = await env.DB.prepare(
          "SELECT id, contact_id FROM wa_action_queue WHERE provider_message_id=?"
        ).bind(text(status.id, 200)).first();
        if (action) {
          await env.DB.prepare(
            "UPDATE wa_action_queue SET provider_status=?, provider_status_at=?, provider_error_json=?, status=CASE WHEN ?='failed' THEN 'failed' ELSE status END, error=CASE WHEN ?='failed' THEN ? ELSE error END, updated_at=? WHERE id=?"
          ).bind(providerStatus, statusAt, JSON.stringify(errors), providerStatus, providerStatus, errorText || "Meta delivery failed", isoNow(), action.id).run();
          await env.DB.prepare(
            "INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?,?,?,?)"
          ).bind(action.id, action.contact_id, "provider_" + providerStatus,
            JSON.stringify({ provider_message_id: status.id, errors }), isoNow()).run();
        }
        updatedStatuses++;
      }
    }
  }

  return json({ ok: true, received_messages: receivedMessages, duplicate_messages: duplicateMessages, updated_statuses: updatedStatuses });
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
      "INSERT INTO wa_contacts (id, phone, display_name, consent_status, created_at, updated_at) VALUES (?, ?, ?, 'unknown', ?, ?) ON CONFLICT(phone) DO UPDATE SET display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE wa_contacts.display_name END, updated_at=excluded.updated_at"
    ).bind(crypto.randomUUID(), phone, text(item.name || item.display_name, 100), now, now));
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
    SELECT c.id, c.phone, c.display_name, c.last_contacted_at, c.cooldown_until,
           COALESCE(p.relationship_type, 'friend') AS relationship_type,
           COALESCE(p.preferred_tone, 'natural') AS preferred_tone,
           COALESCE(p.priority, 3) AS priority,
           p.follow_up_due_at
    FROM wa_contacts c
    LEFT JOIN wa_contact_profiles p ON p.contact_id = c.id
    WHERE c.consent_status = 'opted_in'
      AND c.conversation_state <> 'active'
      AND (c.cooldown_until IS NULL OR c.cooldown_until <= ?)
      AND NOT EXISTS (SELECT 1 FROM wa_daily_selections d WHERE d.contact_id = c.id AND d.selection_date = ?)
    ORDER BY CASE WHEN p.follow_up_due_at IS NOT NULL AND p.follow_up_due_at <= ? THEN 0 ELSE 1 END ASC, COALESCE(p.priority, 3) DESC, COALESCE(c.last_contacted_at, '1970-01-01') ASC, c.created_at ASC
    LIMIT ?
  `).bind(isoNow(), isoNow(), today, remaining).all();
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

async function getPersonality(env) {
  const row = await env.DB.prepare("SELECT id, name, role, tone, mission, values_json, style_rules_json, updated_at FROM wa_personality WHERE id=1").first();
  if (!row) return json({ error: "Personnalité non configurée." }, 404);
  return json({ ...row, values: JSON.parse(row.values_json || "[]"), style_rules: JSON.parse(row.style_rules_json || "[]") });
}

async function updatePersonality(request, env) {
  const body = await readJson(request, 32 * 1024);
  const values = Array.isArray(body.values) ? body.values.slice(0, 12).map(v => text(v, 80)) : ["patience","paix","bienveillance","enthousiasme","curiosité","respect"];
  const rules = Array.isArray(body.style_rules) ? body.style_rules.slice(0, 20).map(v => text(v, 160)) : ["écouter avant de répondre","éviter la pression","adapter le ton au contact","privilégier les messages courts et naturels","ne pas inventer de contexte"];
  const now = isoNow();
  await env.DB.prepare("UPDATE wa_personality SET name=?, role=?, tone=?, mission=?, values_json=?, style_rules_json=?, updated_at=? WHERE id=1").bind(
    text(body.name || "WA Orbit", 80),
    text(body.role || "Motivateur personnel enthousiaste et ingénieux", 160),
    text(body.tone || "chaleureux, calme, positif, naturel", 240),
    text(body.mission || "Entretenir des relations humaines de manière utile, respectueuse et personnalisée", 400),
    JSON.stringify(values), JSON.stringify(rules), now
  ).run();
  return getPersonality(env);
}

async function getContactProfile(env, id) {
  const row = await env.DB.prepare("SELECT c.id, c.phone, c.display_name, c.consent_status, c.conversation_state, p.relationship_type, p.preferred_tone, p.priority, p.notes, p.topics_json, p.follow_up_after_days, p.follow_up_due_at, p.updated_at FROM wa_contacts c LEFT JOIN wa_contact_profiles p ON p.contact_id = c.id WHERE c.id=?").bind(id).first();
  if (!row) return json({ error: "Contact introuvable." }, 404);
  return json({ ...row, topics: JSON.parse(row.topics_json || "[]") });
}

async function updateContactProfile(request, env, id) {
  const contact = await env.DB.prepare("SELECT id FROM wa_contacts WHERE id=?").bind(id).first();
  if (!contact) return json({ error: "Contact introuvable." }, 404);
  const body = await readJson(request, 32 * 1024);
  const topics = Array.isArray(body.topics) ? body.topics.slice(0, 20).map(v => text(v, 100)) : [];
  const now = isoNow();
  await env.DB.prepare("INSERT INTO wa_contact_profiles (contact_id, relationship_type, preferred_tone, priority, notes, topics_json, follow_up_after_days, follow_up_due_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(contact_id) DO UPDATE SET relationship_type=excluded.relationship_type, preferred_tone=excluded.preferred_tone, priority=excluded.priority, notes=excluded.notes, topics_json=excluded.topics_json, follow_up_after_days=excluded.follow_up_after_days, follow_up_due_at=excluded.follow_up_due_at, updated_at=excluded.updated_at").bind(
    id, text(body.relationship_type || "friend", 50), text(body.preferred_tone || "natural", 50),
    Math.min(5, Math.max(1, Number(body.priority) || 3)), text(body.notes || "", 1000), JSON.stringify(topics),
    Math.min(365, Math.max(1, Number(body.follow_up_after_days) || 30)), body.follow_up_due_at ? text(body.follow_up_due_at, 40) : null, now
  ).run();
  return getContactProfile(env, id);
}
function parseJsonSafe(value, fallback) { try { return JSON.parse(value || ''); } catch { return fallback; } }
const TOPIC_KEYWORDS = { basketball:['basket','nba','basketball','lakers','warriors','curry','lebron','giannis'], business:['business','entreprise','commerce','vente','marketing','startup','argent','investissement'], technology:['tech','technologie','ia','intelligence artificielle','iphone','android','code','programmation'], football:['football','ligue','champions','premier league','real madrid','barça','psg'], studies:['cours','examen','université','études','devoir','révision'], travel:['voyage','vacances','plage','avion','hôtel'], music:['musique','concert','artiste','rap','album','chanson'] };
function detectTopics(value) { const s=String(value||'').toLowerCase(); return Object.entries(TOPIC_KEYWORDS).filter(function(x){return x[1].some(function(w){return s.includes(w);});}).map(function(x){return x[0];}); }
function topicInterest(topics, profileTopics) { if (!topics.length) return 25; const scores=profileTopics&&typeof profileTopics==='object'?profileTopics:{}; return Math.round(topics.map(function(t){return Math.min(100,Math.max(0,Number(scores[t])||0));}).reduce(function(a,b){return a+b;},0)/topics.length); }
async function getInteractionPolicy(env) { return await env.DB.prepare('SELECT * FROM wa_interaction_policy WHERE id=1').first() || {status_reply_threshold:72,status_reaction_threshold:58,status_remember_threshold:45,max_status_interactions_per_contact_7d:3,min_hours_between_status_interactions:24,social_energy_daily:10}; }
async function ensureInterestProfile(env,id) { await env.DB.prepare('INSERT OR IGNORE INTO wa_interest_profiles(contact_id,updated_at) VALUES(?,?)').bind(id,isoNow()).run(); return env.DB.prepare('SELECT * FROM wa_interest_profiles WHERE contact_id=?').bind(id).first(); }
function chooseStatusDecision(x) { const score=Math.round(x.interest*0.55+x.relationship*0.30+(x.hasConversation?15:0)-Math.min(20,x.recentCount*7)); if(x.dailyCount>=x.policy.social_energy_daily)return {decision:'view',score:score,reason:'social_energy_daily_reached'}; if(x.recentCount>=x.policy.max_status_interactions_per_contact_7d)return {decision:'ignore',score:score,reason:'interaction_budget_reached'}; if(x.hoursSinceLast<x.policy.min_hours_between_status_interactions)return {decision:'view',score:score,reason:'cooldown_between_status_interactions'}; if(score>=x.policy.status_reply_threshold)return {decision:x.hasConversation?'continue':'reply',score:score,reason:'high_relevance'}; if(score>=x.policy.status_reaction_threshold)return {decision:'react',score:score,reason:'good_relevance_low_pressure'}; if(score>=x.policy.status_remember_threshold)return {decision:'remember',score:score,reason:'interesting_for_later'}; return {decision:'ignore',score:score,reason:'low_relevance'}; }
async function createDraft(env,x) {
  if (x.sourceId) {
    const existing = await env.DB.prepare(
      "SELECT id FROM wa_message_drafts WHERE source_type=? AND source_id=? LIMIT 1"
    ).bind(x.sourceType, text(x.sourceId, 200)).first();
    if (existing) return existing.id;
  }
  const now=isoNow();
  const r=await env.DB.prepare(
    "INSERT INTO wa_message_drafts(contact_id,source_type,source_id,intent,tone,body,provider,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)"
  ).bind(x.contactId,x.sourceType,x.sourceId||null,x.intent||'reconnect',x.tone||'natural',text(x.body,1200),x.provider||'rule_engine',now,now).run();
  return r.meta&&r.meta.last_row_id||null;
}
function makeFollowUpDraft(c) { const n=text(c.display_name||'',100), g=n?'Salut '+n+' 👋':'Salut 👋'; if(c.preferred_tone==='warm')return g+' Ça fait un moment, j’espère que tu vas bien. Quoi de neuf de ton côté ?'; if(c.preferred_tone==='professional')return g+' J’espère que tu vas bien. Ça fait quelque temps, comment avancent tes projets ?'; return g+' Ça fait un moment 😄 Comment tu vas ? Quoi de neuf de ton côté ?'; }
function makeStatusDraft(c,topics,active) { const p=c.display_name?'@'+text(c.display_name,80)+', ':''; if(active)return p+'ça me fait rebondir sur ce que tu dis. Tu en penses quoi exactement ?'; if(topics[0]==='basketball')return p+'ça m’intéresse ça 🏀 Tu suis ça depuis longtemps ?'; if(topics[0]==='business')return p+'intéressant ça 👀 Tu vois ça comment concrètement ?'; if(topics[0]==='technology')return p+'ça m’intéresse 👀 Tu l’utilises déjà ou tu découvres le sujet ?'; return p+'intéressant ça 👀 Tu en penses quoi ?'; }
async function planDailyDrafts(env) {
  const settings=await env.DB.prepare("SELECT daily_limit,paused FROM wa_settings WHERE id=1").first();
  if(!settings||settings.paused) return {planned:0,paused:true};
  const today=dayKey();
  const existing=await env.DB.prepare(
    "SELECT COUNT(*) n FROM wa_daily_selections WHERE selection_date=? AND state IN ('selected','queued','sent')"
  ).bind(today).first();
  const remaining=Math.max(0,Math.min(5,Number(settings.daily_limit)||5)-Number(existing?.n||0));
  if(!remaining) return {planned:0,paused:false,date:today};
  const candidates=await env.DB.prepare(
    "SELECT c.id,c.display_name,COALESCE(p.preferred_tone,'natural') preferred_tone FROM wa_contacts c LEFT JOIN wa_contact_profiles p ON p.contact_id=c.id WHERE c.consent_status='opted_in' AND c.conversation_state<>'active' AND (c.cooldown_until IS NULL OR c.cooldown_until<=?) AND NOT EXISTS (SELECT 1 FROM wa_daily_selections d WHERE d.contact_id=c.id AND d.selection_date=?) ORDER BY CASE WHEN p.follow_up_due_at IS NOT NULL AND p.follow_up_due_at<=? THEN 0 ELSE 1 END,COALESCE(p.priority,3) DESC,COALESCE(c.last_contacted_at,'1970-01-01') ASC,c.created_at ASC LIMIT ?"
  ).bind(isoNow(),today,isoNow(),remaining).all();
  let planned=0;
  for(const contact of candidates.results||[]){
    const now=isoNow();
    const inserted=await env.DB.prepare(
      "INSERT OR IGNORE INTO wa_daily_selections(selection_date,contact_id,state,selected_at) VALUES(?,?,'queued',?)"
    ).bind(today,contact.id,now).run();
    if(Number(inserted?.meta?.changes||0)!==1) continue;
    await env.DB.prepare(
      "UPDATE wa_contact_profiles SET follow_up_due_at=NULL,updated_at=? WHERE contact_id=?"
    ).bind(now,contact.id).run();
    await createDraft(env,{contactId:contact.id,sourceType:"follow_up",sourceId:"daily:"+today+":"+contact.id,intent:"reconnect",tone:contact.preferred_tone,body:makeFollowUpDraft(contact)});
    planned++;
  }
  return {planned,paused:false,date:today};
}

async function ingestStatus(request,env) {
  const body=await readJson(request,128*1024);
  if(!Array.isArray(body.statuses)||body.statuses.length>100) return json({error:"Fournis 1 à 100 statuts."},400);
  const policy=await getInteractionPolicy(env), results=[];
  for(const item of body.statuses){
    const externalId=text(item.external_id||item.id,200), phone=normalizePhone(item.phone);
    if(!externalId||!validPhone(phone)){results.push({accepted:false,reason:"invalid_status"});continue;}
    const contact=await env.DB.prepare("SELECT id,display_name,conversation_state FROM wa_contacts WHERE phone=?").bind(phone).first();
    if(!contact){results.push({accepted:false,reason:"unknown_contact"});continue;}
    const profile=await ensureInterestProfile(env,contact.id);
    const cp=await env.DB.prepare("SELECT priority FROM wa_contact_profiles WHERE contact_id=?").bind(contact.id).first();
    const topics=detectTopics(item.text||item.caption||"");
    const interest=topicInterest(topics,parseJsonSafe(profile?.topics_json,{}));
    const relationship=Math.min(100,Number(cp?.priority||3)*20+(contact.conversation_state==="active"?35:0));
    const recent=await env.DB.prepare("SELECT COUNT(*) n FROM wa_status_events WHERE contact_id=? AND created_at>=datetime('now','-7 day') AND decision IN ('react','reply','continue')").bind(contact.id).first();
    const daily=await env.DB.prepare("SELECT COUNT(*) n FROM wa_status_events WHERE created_at>=datetime('now','start of day') AND decision IN ('react','reply','continue')").first();
    const last=await env.DB.prepare("SELECT created_at FROM wa_status_events WHERE contact_id=? AND decision IN ('react','reply','continue') ORDER BY created_at DESC LIMIT 1").bind(contact.id).first();
    const hours=last?.created_at?(Date.now()-Date.parse(last.created_at))/3600000:9999;
    const choice=chooseStatusDecision({interest,relationship,recentCount:Number(recent?.n||0),dailyCount:Number(daily?.n||0),hoursSinceLast:hours,policy,hasConversation:contact.conversation_state==="active"});
    const now=isoNow();
    const inserted=await env.DB.prepare(
      "INSERT OR IGNORE INTO wa_status_events(external_id,contact_id,content_type,text_content,detected_topics_json,interest_score,relationship_score,opportunity_score,decision,decision_reason,interaction_state,created_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?, 'planned',?,?)"
    ).bind(externalId,contact.id,text(item.content_type||"text",30),text(item.text||item.caption||"",2000),JSON.stringify(topics),interest,relationship,choice.score,choice.decision,choice.reason,now,now).run();
    if(Number(inserted?.meta?.changes||0)!==1){
      results.push({accepted:true,duplicate:true,external_id:externalId,decision:"already_processed"});
      continue;
    }
    if(choice.decision==="reply"||choice.decision==="continue"){
      await createDraft(env,{contactId:contact.id,sourceType:"status",sourceId:externalId,intent:choice.decision==="continue"?"continue_conversation":"comment_on_status",body:makeStatusDraft(contact,topics,contact.conversation_state==="active")});
    } else if(choice.decision==="remember"&&topics.length){
      for(const topic of topics){
        await env.DB.prepare("INSERT INTO wa_relationship_memory(contact_id,memory_type,content,source,importance,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .bind(contact.id,"topic","Intérêt détecté: "+topic,"status",Math.max(2,Math.min(5,Math.ceil(interest/20))),now,now,now).run();
      }
    }
    results.push({accepted:true,external_id:externalId,topics,interest_score:interest,decision:choice.decision,reason:choice.reason});
  }
  return json({results},201);
}

async function listDrafts(env,url) { const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||20)), status=['draft','approved','sent','discarded'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'draft'; const r=await env.DB.prepare('SELECT d.*,c.phone,c.display_name FROM wa_message_drafts d JOIN wa_contacts c ON c.id=d.contact_id WHERE d.status=? ORDER BY d.created_at DESC LIMIT ?').bind(status,limit).all(); return json({drafts:r.results||[]}); }
async function updateDraft(request,env,id) { const b=await readJson(request,32*1024), d=await env.DB.prepare('SELECT id,body,status FROM wa_message_drafts WHERE id=?').bind(id).first(); if(!d)return json({error:'Brouillon introuvable.'},404); const status=['approved','discarded'].includes(b.status)?b.status:d.status, body=b.body!==undefined?text(b.body,1200):d.body; await env.DB.prepare('UPDATE wa_message_drafts SET body=?,status=?,updated_at=? WHERE id=?').bind(body,status,isoNow(),id).run(); return json({ok:true,id:id,status:status,body:body}); }

async function claimActions(request, env) {
  const body=await readJson(request,16*1024);
  const limit=Math.min(5,Math.max(1,Number(body.limit)||5));
  const settings=await env.DB.prepare("SELECT daily_limit,paused FROM wa_settings WHERE id=1").first();
  if(!settings||settings.paused) return json({actions:[],paused:true,remaining:0});
  const now=isoNow();
  const staleBefore=new Date(Date.now()-10*60*1000).toISOString();
  const stale=await env.DB.prepare(
    "SELECT id,contact_id,attempts FROM wa_action_queue WHERE status='processing' AND processing_started_at<=?"
  ).bind(staleBefore).all();
  for(const item of stale.results||[]){
    const next=Number(item.attempts||0)>=5?"failed":"queued";
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_action_queue SET status=?,processing_started_at=NULL,scheduled_at=?,error=?,updated_at=? WHERE id=? AND status='processing'")
        .bind(next,now,next==="failed"?"lease_expired_after_max_attempts":"worker_lease_expired",now,item.id),
      env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?,?,?,?)")
        .bind(item.id,item.contact_id,next==="failed"?"dead_letter":"lease_recovered",JSON.stringify({attempts:item.attempts}),now)
    ]);
  }

  const dailyLimit=Math.min(5,Number(settings.daily_limit)||5);
  const sent=await env.DB.prepare(
    "SELECT COUNT(*) n FROM wa_action_queue WHERE status='sent' AND sent_at>=datetime('now','start of day')"
  ).first();
  const pending=await env.DB.prepare(
    "SELECT COUNT(*) n FROM wa_action_queue WHERE status IN ('queued','processing') AND scheduled_at>=datetime('now','start of day')"
  ).first();
  const sentToday=Number(sent?.n||0);
  const pendingToday=Number(pending?.n||0);
  const capacity=Math.max(0,dailyLimit-sentToday-pendingToday);

  if(capacity>0){
    const drafts=await env.DB.prepare(
      "SELECT d.id,d.contact_id,d.body,c.phone FROM wa_message_drafts d JOIN wa_contacts c ON c.id=d.contact_id WHERE d.status='approved' AND c.consent_status='opted_in' AND c.conversation_state<>'active' AND NOT EXISTS (SELECT 1 FROM wa_action_queue q WHERE q.draft_id=d.id) ORDER BY d.created_at ASC LIMIT ?"
    ).bind(Math.min(limit,capacity)).all();
    for(const draft of drafts.results||[]){
      const key="draft:"+draft.id;
      const inserted=await env.DB.prepare(
        "INSERT OR IGNORE INTO wa_action_queue(draft_id,contact_id,action_type,payload_json,status,attempts,idempotency_key,scheduled_at,created_at,updated_at) VALUES(?,?,'send_text',?,'queued',0,?,?,?,?)"
      ).bind(draft.id,draft.contact_id,JSON.stringify({phone:draft.phone,body:draft.body}),key,now,now,now).run();
      if(Number(inserted?.meta?.changes||0)===1){
        await env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) SELECT id,contact_id,'queued',?,? FROM wa_action_queue WHERE idempotency_key=?")
          .bind(JSON.stringify({draft_id:draft.id}),now,key).run();
      }
    }
  }

  const claimLimit=Math.min(limit,Math.max(0,dailyLimit-sentToday));
  if(!claimLimit) return json({actions:[],paused:false,remaining:0,message:"Quota quotidien atteint."});
  const ready=await env.DB.prepare(
    "SELECT q.id,q.contact_id FROM wa_action_queue q JOIN wa_contacts c ON c.id=q.contact_id WHERE q.status='queued' AND q.scheduled_at<=? AND c.consent_status='opted_in' AND c.conversation_state<>'active' ORDER BY q.scheduled_at ASC,q.id ASC LIMIT ?"
  ).bind(now,claimLimit).all();
  const claimed=[];
  for(const item of ready.results||[]){
    const update=await env.DB.prepare(
      "UPDATE wa_action_queue SET status='processing',attempts=attempts+1,processing_started_at=?,updated_at=? WHERE id=? AND status='queued'"
    ).bind(now,now,item.id).run();
    if(Number(update?.meta?.changes||0)!==1) continue;
    await env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?, 'claimed',?,?)")
      .bind(item.id,item.contact_id,JSON.stringify({lease_started_at:now}),now).run();
    const full=await env.DB.prepare(
      "SELECT q.id,q.draft_id,q.contact_id,q.action_type,q.payload_json,q.status,q.attempts,q.idempotency_key,q.scheduled_at,d.body,c.phone,c.display_name,c.consent_status,c.conversation_state FROM wa_action_queue q JOIN wa_message_drafts d ON d.id=q.draft_id JOIN wa_contacts c ON c.id=q.contact_id WHERE q.id=?"
    ).bind(item.id).first();
    if(full) claimed.push(full);
  }
  return json({actions:claimed,paused:false,remaining:Math.max(0,dailyLimit-sentToday-claimed.length)});
}

async function authorizeAction(env,id) {
  const settings=await env.DB.prepare("SELECT paused FROM wa_settings WHERE id=1").first();
  if(!settings||settings.paused) return {authorized:false,reason:"emergency_pause",retryable:true};
  const action=await env.DB.prepare(
    "SELECT q.status,c.consent_status,c.conversation_state FROM wa_action_queue q JOIN wa_contacts c ON c.id=q.contact_id WHERE q.id=?"
  ).bind(id).first();
  if(!action) return {authorized:false,reason:"action_not_found",retryable:false};
  if(action.status!=="processing") return {authorized:false,reason:"action_not_processing",retryable:false};
  if(action.consent_status!=="opted_in") return {authorized:false,reason:"consent_required",retryable:false};
  if(action.conversation_state==="active") return {authorized:false,reason:"conversation_active",retryable:false};
  return {authorized:true};
}

async function recordActionResult(request, env, id) {
  const body=await readJson(request,32*1024);
  const action=await env.DB.prepare("SELECT q.*,d.contact_id AS draft_contact_id,c.consent_status FROM wa_action_queue q JOIN wa_message_drafts d ON d.id=q.draft_id JOIN wa_contacts c ON c.id=q.contact_id WHERE q.id=?").bind(id).first();
  if(!action) return json({error:"Action introuvable."},404);
  if(["sent","cancelled","failed"].includes(action.status)) return json({ok:true,status:action.status,id:Number(id)});
  const now=isoNow();

  if(body.status==="deferred"){
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_action_queue SET status='queued',attempts=MAX(0,attempts-1),processing_started_at=NULL,scheduled_at=?,error=?,updated_at=? WHERE id=? AND status='processing'")
        .bind(now,text(body.error||"temporarily_deferred",500),now,id),
      env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?, 'deferred',?,?)")
        .bind(id,action.contact_id,JSON.stringify({reason:body.error||"temporarily_deferred"}),now)
    ]);
    return json({ok:true,id:Number(id),status:"queued"});
  }

  if(body.status==="cancelled"){
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_action_queue SET status='cancelled',processing_started_at=NULL,error=?,updated_at=? WHERE id=? AND status='processing'")
        .bind(text(body.error||"not_authorized",500),now,id),
      env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?, 'cancelled',?,?)")
        .bind(id,action.contact_id,JSON.stringify({reason:body.error||"not_authorized"}),now)
    ]);
    return json({ok:true,id:Number(id),status:"cancelled"});
  }

  if(body.status==="sent"){
    if(action.status!=="processing") return json({error:"Action non réservée."},409);
    const changed=await env.DB.prepare(
      "UPDATE wa_action_queue SET status='sent',provider_status='sent',provider_message_id=?,sent_at=?,provider_status_at=?,updated_at=?,processing_started_at=NULL,error=NULL WHERE id=? AND status='processing'"
    ).bind(text(body.provider_message_id||"",200)||null,now,now,now,id).run();
    if(Number(changed?.meta?.changes||0)!==1) return json({error:"Action déjà traitée."},409);
    await env.DB.batch([
      env.DB.prepare("UPDATE wa_message_drafts SET status='sent',updated_at=? WHERE id=?").bind(now,action.draft_id),
      env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?, 'sent',?,?)").bind(id,action.contact_id,JSON.stringify({provider_message_id:body.provider_message_id||null}),now)
    ]);
    const contact=await env.DB.prepare("SELECT id FROM wa_contacts WHERE id=? AND consent_status='opted_in'").bind(action.contact_id).first();
    if(contact) await recordContact({json:async()=>({action:"sent"})},env,action.contact_id);
    return json({ok:true,id:Number(id),status:"sent"});
  }

  const attempts=Number(action.attempts||0);
  const maxAttempts=5;
  const nextStatus=attempts>=maxAttempts?"failed":"queued";
  const backoffMinutes=Math.min(60,Math.pow(2,Math.max(0,attempts-1)));
  const retryAt=new Date(Date.now()+backoffMinutes*60*1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE wa_action_queue SET status=?,scheduled_at=?,error=?,updated_at=?,processing_started_at=NULL WHERE id=? AND status='processing'")
      .bind(nextStatus,retryAt,text(body.error||"send_failed",500),now,id),
    env.DB.prepare("INSERT INTO wa_action_audit(action_id,contact_id,event,details_json,created_at) VALUES(?,?,?, ?,?)")
      .bind(id,action.contact_id,nextStatus==="failed"?"dead_letter":"retry",JSON.stringify({attempts,retry_at:nextStatus==="failed"?null:retryAt,error:body.error||"send_failed"}),now)
  ]);
  return json({ok:false,id:Number(id),status:nextStatus,attempts,retry_at:nextStatus==="failed"?null:retryAt});
}

async function listActionQueue(env,url) {
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||20));
  const status=["queued","processing","sent","failed","cancelled"].includes(url.searchParams.get("status"))?url.searchParams.get("status"):"queued";
  const r=await env.DB.prepare("SELECT q.*,d.body,c.phone,c.display_name FROM wa_action_queue q JOIN wa_message_drafts d ON d.id=q.draft_id JOIN wa_contacts c ON c.id=q.contact_id WHERE q.status=? ORDER BY q.created_at DESC LIMIT ?").bind(status,limit).all();
  return json({actions:r.results||[]});
}

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: "Base D1 non configurée." }, 503);
  if (!authorized(request, env)) return json({ error: "Authentification requise." }, 401);
  if (request.method === "POST" && url.pathname === "/api/actions/claim") return claimActions(request, env);
  const actionAuthorizeMatch=url.pathname.match(/^\/api\/actions\/(\d+)\/authorize$/);
  if(actionAuthorizeMatch&&request.method==="POST"){
    const result=await authorizeAction(env,Number(actionAuthorizeMatch[1]));
    return json(result,result.reason==="action_not_found"?404:200);
  }
  const actionResultMatch=url.pathname.match(/^\/api\/actions\/(\d+)\/result$/);
  if (actionResultMatch && request.method === "POST") return recordActionResult(request, env, Number(actionResultMatch[1]));
  if (request.method === "GET" && url.pathname === "/api/actions") return listActionQueue(env,url);
  if (request.method === "GET" && url.pathname === "/api/personality") return getPersonality(env);
  if (request.method === "GET" && url.pathname === "/api/drafts") return listDrafts(env,url);
  if (request.method === "POST" && url.pathname === "/api/drafts/claim") {
    const body=await readJson(request,16*1024);
    const limit=Math.min(20,Math.max(1,Number(body.limit)||5));
    const rows=await env.DB.prepare("SELECT d.*,c.phone,c.display_name,c.consent_status FROM wa_message_drafts d JOIN wa_contacts c ON c.id=d.contact_id WHERE d.status='approved' AND c.consent_status='opted_in' ORDER BY d.created_at ASC LIMIT ?").bind(limit).all();
    return json({drafts:rows.results||[], connector_note:"Chaque brouillon doit être revalidé via /api/safety et les règles de consentement juste avant l'envoi."});
  }
  if (request.method === "GET" && url.pathname === "/api/interaction-policy") return json(await getInteractionPolicy(env));
  if (request.method === "POST" && url.pathname === "/api/interaction-policy") {
    const b=await readJson(request), p=await getInteractionPolicy(env);
    const n=(v,d,min,max)=>Math.min(max,Math.max(min,Number(v ?? d)||d));
    await env.DB.prepare("UPDATE wa_interaction_policy SET status_reply_threshold=?,status_reaction_threshold=?,status_remember_threshold=?,max_status_interactions_per_contact_7d=?,min_hours_between_status_interactions=?,social_energy_daily=?,updated_at=? WHERE id=1")
      .bind(n(b.status_reply_threshold,p.status_reply_threshold,0,100),n(b.status_reaction_threshold,p.status_reaction_threshold,0,100),n(b.status_remember_threshold,p.status_remember_threshold,0,100),n(b.max_status_interactions_per_contact_7d,p.max_status_interactions_per_contact_7d,0,50),n(b.min_hours_between_status_interactions,p.min_hours_between_status_interactions,1,720),n(b.social_energy_daily,p.social_energy_daily,0,50),isoNow()).run();
    return json(await getInteractionPolicy(env));
  }
  if (request.method === "POST" && url.pathname === "/api/status-events") return ingestStatus(request,env);
  const draftMatch=url.pathname.match(/^\/api\/drafts\/(\d+)$/);
  if (draftMatch && request.method === "POST") return updateDraft(request,env,Number(draftMatch[1]));
  if (request.method === "POST" && url.pathname === "/api/personality") return updatePersonality(request, env);
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
  const interestMatch=url.pathname.match(/^\/api\/contacts\/([0-9a-f-]{36})\/interests$/i);
  if(interestMatch&&request.method==="GET"){ const p=await ensureInterestProfile(env,interestMatch[1]); return json(p||{}); }
  if(interestMatch&&request.method==="POST"){ const b=await readJson(request,32*1024); await ensureInterestProfile(env,interestMatch[1]); const topics=b.topics&&typeof b.topics==="object"?b.topics:{}; await env.DB.prepare("UPDATE wa_interest_profiles SET topics_json=?,curiosity_threshold=?,status_interaction_cooldown_hours=?,max_status_interactions_7d=?,updated_at=? WHERE contact_id=?").bind(JSON.stringify(topics),Math.min(100,Math.max(0,Number(b.curiosity_threshold)||55)),Math.min(720,Math.max(1,Number(b.status_interaction_cooldown_hours)||24)),Math.min(50,Math.max(0,Number(b.max_status_interactions_7d)||3)),isoNow(),interestMatch[1]).run(); return json(await ensureInterestProfile(env,interestMatch[1])); }
  const profileMatch = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]{36})\/profile$/i);
  if (profileMatch && request.method === "GET") return getContactProfile(env, profileMatch[1]);
  if (profileMatch && request.method === "POST") return updateContactProfile(request, env, profileMatch[1]);
  const match = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]{36})\/action$/i);
  if (request.method === "POST" && match) return recordContact(request, env, match[1]);
  return json({ error: "Route API introuvable." }, 404);
}

export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil(planDailyDrafts(env).catch(()=>{})); },
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
