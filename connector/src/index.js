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

    queue.push({...action, queuedAt:new Date().toISOString()});
    return {ok:true, queued:true};
  }

  return {statusReceived, executeApproved, queue};
}


export async function syncApproved(config, transport) {
  const connector=createConnector(config);
  const batch=await connector.orbit.drafts("approved");
  const results=[];
  for(const draft of batch.drafts||[]) {
    const result=await connector.executeApproved({
      id:draft.id,
      phone:draft.phone,
      body:draft.body,
      consentStatus:draft.consent_status,
      approved:true,
      dailyCount:0,
      dailyLimit:5
    });
    if(result.ok) {
      await connector.queue.drain(async action => {
        if(typeof transport.send !== "function") throw new Error("transport.send requis");
        await transport.send({phone:action.phone,body:action.body});
      });
    }
    results.push({id:draft.id,...result});
  }
  return results;
}
