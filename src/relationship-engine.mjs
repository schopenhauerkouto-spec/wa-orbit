const STOP_WORDS = new Set(["stop","arrêt","arrete","unsubscribe","desabonne","désabonne","remove","quit"]);
const HOT_INTENTS = new Set(["price_request","demo_request","purchase_intent","appointment_request","problem_with_offer"]);
const POSITIVE_INTENTS = new Set(["question","interest","information_request","follow_up_request","purchase_intent","price_request","demo_request"]);

export function normalizePhone(value) {
  return String(value ?? "").replace(/[\s().-]/g, "").replace(/^00/, "+");
}

export function isOptOutText(text) {
  const normalized = String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return STOP_WORDS.has(normalized) || /^(stop|arrete|unsubscribe)(\s|$)/.test(normalized);
}

export function temperatureForScore(score) {
  const value = Number(score) || 0;
  if (value >= 81) return "very_hot";
  if (value >= 66) return "hot";
  if (value >= 46) return "interested";
  if (value >= 21) return "low";
  return "cold";
}

export function scoreContact(contact = {}) {
  let score = Number.isFinite(Number(contact.engagementScore)) ? Number(contact.engagementScore) : 0;
  const signals = [];
  const messages = Array.isArray(contact.messages) ? contact.messages.slice(-12) : [];

  for (const message of messages) {
    if (message.role !== "user") continue;
    const intent = String(message.intent || "").toLowerCase();
    if (HOT_INTENTS.has(intent)) { score += 15; signals.push(intent); }
    else if (POSITIVE_INTENTS.has(intent)) { score += 7; signals.push(intent); }
    if (message.userAskedQuestion) { score += 4; signals.push("question"); }
  }

  if (contact.lastInboundAt && contact.lastOutboundAt) {
    const inbound = Date.parse(contact.lastInboundAt);
    const outbound = Date.parse(contact.lastOutboundAt);
    if (Number.isFinite(inbound) && Number.isFinite(outbound) && inbound >= outbound && inbound - outbound <= 2 * 60 * 60 * 1000) {
      score += 8; signals.push("fast_response");
    }
  }

  if (contact.repliedCount > 0) { score += Math.min(15, Number(contact.repliedCount)); signals.push("replies"); }
  if (contact.noReplyCount > 0) { score -= Math.min(20, Number(contact.noReplyCount) * 3); signals.push("no_reply"); }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return { score: bounded, temperature: temperatureForScore(bounded), signals: [...new Set(signals)] };
}

export function isProactiveEligible(contact = {}, now = Date.now()) {
  if (contact.blocked === true) return { ok: false, reason: "blocked" };
  if (contact.optedIn !== true) return { ok: false, reason: "no_explicit_opt_in" };
  if (contact.proactiveMessagingDisabled === true) return { ok: false, reason: "proactive_disabled" };

  const lastInbound = Date.parse(contact.lastInboundAt || "");
  if (Number.isFinite(lastInbound) && now - lastInbound < 24 * 60 * 60 * 1000) return { ok: true, reason: "service_window_open" };

  const cooldownUntil = Date.parse(contact.cooldownUntil || "");
  if (Number.isFinite(cooldownUntil) && now < cooldownUntil) return { ok: false, reason: "cooldown" };

  return { ok: true, reason: "explicit_opt_in" };
}

export function shouldFollowUp(contact = {}, now = Date.now()) {
  const eligibility = isProactiveEligible(contact, now);
  if (!eligibility.ok) return { action: "wait", reason: eligibility.reason };
  if (contact.awaitingHuman === true) return { action: "wait", reason: "human_handoff" };
  if (contact.followUpCancelled === true) return { action: "stop", reason: "follow_up_cancelled" };

  if (contact.lastInboundAt && contact.lastOutboundAt) {
    const inbound = Date.parse(contact.lastInboundAt);
    const outbound = Date.parse(contact.lastOutboundAt);
    if (Number.isFinite(inbound) && Number.isFinite(outbound) && inbound > outbound) return { action: "reply", reason: "contact_replied" };
  }

  const nextAt = Date.parse(contact.nextFollowUpAt || "");
  if (Number.isFinite(nextAt) && now < nextAt) return { action: "wait", reason: "scheduled_for_later", nextAt: new Date(nextAt).toISOString() };

  const maxFollowUps = Math.max(0, Number(contact.maxFollowUps ?? 3));
  const followUps = Math.max(0, Number(contact.followUpsSent ?? 0));
  if (followUps >= maxFollowUps) return { action: "stop", reason: "follow_up_limit" };

  if (contact.lastInboundAt && !contact.lastOutboundAt) return { action: "reply", reason: "unanswered_inbound" };
  return { action: "follow_up", reason: "eligible_and_due" };
}

export function recordInbound(contact = {}, message = {}, now = new Date()) {
  const next = { ...contact, lastInboundAt: new Date(now).toISOString(), repliedCount: Number(contact.repliedCount || 0) + 1, noReplyCount: 0, followUpCancelled: true, nextFollowUpAt: null };
  if (isOptOutText(message.text || message.content || "")) {
    next.blocked = true;
    next.optedIn = false;
    next.proactiveMessagingDisabled = true;
    next.followUpCancelled = true;
  }
  return next;
}

export function recordOutbound(contact = {}, now = new Date()) {
  return { ...contact, lastOutboundAt: new Date(now).toISOString(), followUpCancelled: false };
}

export function scheduleFollowUp(contact = {}, delayMs, now = new Date()) {
  const delay = Math.max(60_000, Number(delayMs) || 0);
  return { ...contact, nextFollowUpAt: new Date(new Date(now).getTime() + delay).toISOString(), followUpCancelled: false };
}

export function buildDecision(contact = {}, now = Date.now()) {
  const scoring = scoreContact(contact);
  const followUp = shouldFollowUp(contact, now);
  return { score: scoring.score, temperature: scoring.temperature, signals: scoring.signals, action: followUp.action, reason: followUp.reason, nextAt: followUp.nextAt || contact.nextFollowUpAt || null };
}
