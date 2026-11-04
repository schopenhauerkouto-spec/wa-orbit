export function canSend({paused, consentStatus, approved, dailyCount, dailyLimit}) {
  if (paused) return {ok:false, reason:"emergency_pause"};
  if (consentStatus !== "opted_in") return {ok:false, reason:"consent_required"};
  if (!approved) return {ok:false, reason:"approval_required"};
  if (dailyCount >= dailyLimit) return {ok:false, reason:"daily_limit"};
  return {ok:true, reason:"allowed"};
}

export function normalizeEvent(event) {
  return {
    externalId: String(event.externalId || event.id || ""),
    type: String(event.type || "message"),
    phone: String(event.phone || ""),
    text: String(event.text || ""),
    timestamp: event.timestamp || new Date().toISOString()
  };
}
