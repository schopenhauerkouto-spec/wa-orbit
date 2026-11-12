import assert from "node:assert/strict";
import { isOptOutText, recordInbound, recordOutbound, scheduleFollowUp, buildDecision, isProactiveEligible } from "../src/relationship-engine.mjs";

assert.equal(isOptOutText("STOP"), true);
assert.equal(isOptOutText("Arrêt"), true);
assert.equal(isOptOutText("Bonjour"), false);

let contact = { phone: "+2250700000000", optedIn: true, blocked: false, messages: [], followUpsSent: 0, maxFollowUps: 3 };
contact = recordOutbound(contact, new Date("2026-11-12T10:00:00Z"));
contact = scheduleFollowUp(contact, 48 * 60 * 60 * 1000, new Date("2026-11-12T10:00:00Z"));
assert.equal(buildDecision(contact, Date.parse("2026-11-13T10:00:00Z")).action, "wait");

contact = recordInbound(contact, { text: "Oui, montre-moi le prix", intent: "price_request", userAskedQuestion: true }, new Date("2026-11-13T11:00:00Z"));
let decision = buildDecision(contact, Date.parse("2026-11-13T11:01:00Z"));
assert.equal(decision.action, "reply");
assert.equal(contact.followUpCancelled, true);
assert.ok(decision.score >= 20);

contact = recordInbound(contact, { text: "STOP" }, new Date("2026-11-13T12:00:00Z"));
assert.equal(contact.blocked, true);
assert.equal(contact.optedIn, false);
assert.equal(isProactiveEligible(contact).ok, false);

contact = { optedIn: true, blocked: false, followUpsSent: 0, maxFollowUps: 3, nextFollowUpAt: "2026-11-12T09:00:00Z", lastOutboundAt: "2026-11-10T09:00:00Z", lastInboundAt: "2026-11-09T09:00:00Z" };
decision = buildDecision(contact, Date.parse("2026-11-12T10:00:00Z"));
assert.equal(decision.action, "follow_up");

console.log("Relationship Engine tests : OK");
