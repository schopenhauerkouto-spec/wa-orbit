const DEFAULT_POLICY = Object.freeze({
  enabled: false,
  mode: "observe",
  exemptAdmins: true,
  links: {
    enabled: true,
    allowAny: false,
    allowAdmins: true,
    allowedDomains: ["youtube.com", "youtu.be", "github.com"],
    blockedDomains: []
  },
  flood: {
    enabled: true,
    maxMessages: 5,
    windowSeconds: 10
  },
  repeats: {
    enabled: true,
    maxRepeats: 3,
    windowSeconds: 120
  },
  warnings: {
    enabled: true,
    threshold: 3
  }
});

const clamp = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
};

function normalizeDomain(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/^\*\./, "");
  if (!raw || raw.length > 253 || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host.includes("..") || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function normalizeDomainList(value, fallback) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]+/) : fallback;
  return [...new Set(entries.map(normalizeDomain).filter(Boolean))].slice(0, 100);
}

export function defaultGroupModerationPolicy() {
  return JSON.parse(JSON.stringify(DEFAULT_POLICY));
}

export function normalizeGroupModerationPolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const links = source.links && typeof source.links === "object" ? source.links : {};
  const flood = source.flood && typeof source.flood === "object" ? source.flood : {};
  const repeats = source.repeats && typeof source.repeats === "object" ? source.repeats : {};
  const warnings = source.warnings && typeof source.warnings === "object" ? source.warnings : {};

  return {
    enabled: source.enabled === true,
    mode: source.mode === "enforce" ? "enforce" : "observe",
    exemptAdmins: source.exemptAdmins !== false,
    links: {
      enabled: links.enabled !== false,
      allowAny: links.allowAny === true,
      allowAdmins: links.allowAdmins !== false,
      allowedDomains: normalizeDomainList(links.allowedDomains, DEFAULT_POLICY.links.allowedDomains),
      blockedDomains: normalizeDomainList(links.blockedDomains, DEFAULT_POLICY.links.blockedDomains)
    },
    flood: {
      enabled: flood.enabled !== false,
      maxMessages: clamp(flood.maxMessages, DEFAULT_POLICY.flood.maxMessages, 2, 100),
      windowSeconds: clamp(flood.windowSeconds, DEFAULT_POLICY.flood.windowSeconds, 3, 300)
    },
    repeats: {
      enabled: repeats.enabled !== false,
      maxRepeats: clamp(repeats.maxRepeats, DEFAULT_POLICY.repeats.maxRepeats, 2, 50),
      windowSeconds: clamp(repeats.windowSeconds, DEFAULT_POLICY.repeats.windowSeconds, 5, 3600)
    },
    warnings: {
      enabled: warnings.enabled !== false,
      threshold: clamp(warnings.threshold, DEFAULT_POLICY.warnings.threshold, 1, 10)
    }
  };
}

function extractLinks(text) {
  const source = String(text || "");
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s<>"']*)?/gi;
  const links = [];
  for (const match of source.matchAll(pattern)) {
    const cleaned = match[0].replace(/[),.!?;:]+$/g, "");
    try {
      const url = new URL(cleaned.includes("://") ? cleaned : `https://${cleaned}`);
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      if (host && !links.includes(host)) links.push(host);
    } catch {
      // Invalid URL candidates are ignored rather than treated as a block.
    }
  }
  return links;
}

function matchesDomain(host, domains) {
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function normalizeMessage(text) {
  return String(text || "").toLocaleLowerCase("fr")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/\s+/g, " ");
}

function recentFromSender(history, senderId, nowMs, windowSeconds) {
  const cutoff = nowMs - windowSeconds * 1000;
  return history.filter(item => {
    if (String(item?.senderId || "") !== senderId) return false;
    const timestamp = Date.parse(item?.timestamp || "");
    return Number.isFinite(timestamp) && timestamp <= nowMs && timestamp >= cutoff;
  });
}

export function inspectGroupMessage({
  policy: rawPolicy,
  text = "",
  senderId = "unknown",
  senderIsAdmin = false,
  history = [],
  now = Date.now()
} = {}) {
  const policy = normalizeGroupModerationPolicy(rawPolicy);
  const message = String(text).slice(0, 4096);
  const sender = String(senderId || "unknown").slice(0, 128);
  const events = Array.isArray(history) ? history.slice(-100) : [];
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const violations = [];
  const hosts = extractLinks(message);

  if (!Number.isFinite(nowMs)) throw new TypeError("now doit être une date ou un timestamp valide.");
  if (!policy.enabled) {
    return { enabled: false, decision: "observe_only", violations: [], hosts, executable: false, reason: "policy_disabled" };
  }
  if (policy.exemptAdmins && senderIsAdmin) {
    return { enabled: true, decision: "allow", violations: [], hosts, executable: false, reason: "admin_exempt" };
  }

  if (policy.links.enabled && hosts.length && !(senderIsAdmin && policy.links.allowAdmins)) {
    const blockedHosts = hosts.filter(host => matchesDomain(host, policy.links.blockedDomains));
    const notAllowedHosts = policy.links.allowAny
      ? []
      : hosts.filter(host => !matchesDomain(host, policy.links.allowedDomains));
    const disallowedHosts = [...new Set([...blockedHosts, ...notAllowedHosts])];
    if (disallowedHosts.length) {
      violations.push({
        type: "link",
        hosts: disallowedHosts,
        reason: blockedHosts.length ? "blocked_domain" : "domain_not_allowlisted"
      });
    }
  }

  if (policy.flood.enabled) {
    const recent = recentFromSender(events, sender, nowMs, policy.flood.windowSeconds);
    if (recent.length + 1 >= policy.flood.maxMessages) {
      violations.push({ type: "flood", count: recent.length + 1, windowSeconds: policy.flood.windowSeconds });
    }
  }

  if (policy.repeats.enabled) {
    const normalized = normalizeMessage(message);
    if (normalized) {
      const recent = recentFromSender(events, sender, nowMs, policy.repeats.windowSeconds);
      const duplicates = recent.filter(item => normalizeMessage(item?.text) === normalized);
      if (duplicates.length + 1 >= policy.repeats.maxRepeats) {
        violations.push({
          type: "repeat",
          count: duplicates.length + 1,
          windowSeconds: policy.repeats.windowSeconds
        });
      }
    }
  }

  const linkViolation = violations.some(item => item.type === "link");
  const spamViolation = violations.some(item => item.type === "flood" || item.type === "repeat");
  const suggestedAction = linkViolation ? "remove_message" : spamViolation ? "flag_for_admin_review" : "none";
  const requiredCapability = linkViolation ? "delete_group_message" : null;

  return {
    enabled: true,
    decision: linkViolation ? "block_link" : spamViolation ? "flag_spam" : "allow",
    violations,
    hosts,
    suggestedAction,
    requiredCapability,
    executable: false,
    execution: "simulation_only",
    note: "Cette décision est une analyse de règle. Aucun message ni membre n'est modifié par ce moteur."
  };
}
