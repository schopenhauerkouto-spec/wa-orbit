import { OrbitClient } from "./client.js";
import { ActionQueue } from "./queue.js";
import { canSend, normalizeEvent } from "./policy.js";

export function createConnector(config) {
  const orbit = new OrbitClient(config);
  const queue = new ActionQueue({minDelayMs: config.minDelayMs || 30000});

  async function statusReceived(status) {
    const e = normalizeEvent(status);
    return orbit.ingestStatus([{
      external_id:e.externalId,
      phone:e.phone,
      content_type:status.contentType || "text",
      text:e.text
    }]);
  }

  async function executeApproved(action) {
    const safety = await orbit.safety();
    const decision = canSend({
      paused:safety.paused === true || safety.paused === 1,
      consentStatus:action.consentStatus,
      approved:action.approved === true,
      dailyCount:action.dailyCount || 0,
      dailyLimit:action.dailyLimit || 5
    });
    if (!decision.ok) return decision;

    queue.push(action);
    return {ok:true, queued:true};
  }

  return {statusReceived, executeApproved, queue};
}
