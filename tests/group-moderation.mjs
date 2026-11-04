import assert from "node:assert/strict";
import {
  defaultGroupModerationPolicy,
  inspectGroupMessage,
  normalizeGroupModerationPolicy
} from "../src/group-moderation-policy.js";

const base = defaultGroupModerationPolicy();
assert.equal(base.enabled, false, "La modération doit être désactivée par défaut.");

const policy = normalizeGroupModerationPolicy({
  enabled: true,
  links: {
    enabled: true,
    allowAny: false,
    allowAdmins: true,
    allowedDomains: ["youtube.com", "github.com"],
    blockedDomains: ["bad.example"]
  },
  flood: { enabled: true, maxMessages: 3, windowSeconds: 10 },
  repeats: { enabled: true, maxRepeats: 3, windowSeconds: 60 }
});

const now = Date.parse("2026-11-04T12:00:00.000Z");
const history = [
  {senderId:"member-1", text:"Salut", timestamp:new Date(now - 3000).toISOString()},
  {senderId:"member-1", text:"Encore un message", timestamp:new Date(now - 2000).toISOString()}
];

const blockedLink = inspectGroupMessage({
  policy, text:"Regarde https://bad.example/page", senderId:"member-2", now
});
assert.equal(blockedLink.decision, "block_link");
assert.equal(blockedLink.suggestedAction, "remove_message");
assert.equal(blockedLink.executable, false, "Le moteur de règles ne doit pas exécuter un acte WhatsApp.");

const safeLink = inspectGroupMessage({
  policy, text:"Documentation https://docs.github.com/en", senderId:"member-2", now
});
assert.equal(safeLink.decision, "allow");

const spoofedDomain = inspectGroupMessage({
  policy, text:"https://github.com.evil.example", senderId:"member-2", now
});
assert.equal(spoofedDomain.decision, "block_link", "Un domaine suffixé malveillant ne doit pas être autorisé.");

const admin = inspectGroupMessage({
  policy, text:"https://bad.example", senderId:"admin-1", senderIsAdmin:true, now
});
assert.equal(admin.decision, "allow");
assert.equal(admin.reason, "admin_exempt");

const flood = inspectGroupMessage({
  policy, text:"Message différent", senderId:"member-1", history, now
});
assert.equal(flood.decision, "flag_spam");
assert.ok(flood.violations.some(item => item.type === "flood"));

const repeatHistory = [
  {senderId:"member-2", text:"Achetez maintenant !!!", timestamp:new Date(now - 5000).toISOString()},
  {senderId:"member-2", text:"Achetez maintenant", timestamp:new Date(now - 3000).toISOString()}
];
const repeat = inspectGroupMessage({
  policy, text:"Achetez maintenant.", senderId:"member-2", history:repeatHistory, now
});
assert.ok(repeat.violations.some(item => item.type === "repeat"));

const bounded = normalizeGroupModerationPolicy({
  flood:{maxMessages:999,windowSeconds:1},
  warnings:{threshold:99},
  links:{allowedDomains:["*.example.com","https://sub.example.com/path","not a domain"]}
});
assert.equal(bounded.flood.maxMessages,100);
assert.equal(bounded.flood.windowSeconds,3);
assert.equal(bounded.warnings.threshold,10);
assert.deepEqual(bounded.links.allowedDomains,["example.com","sub.example.com"]);

console.log("WA Orbit group moderation tests: OK");
