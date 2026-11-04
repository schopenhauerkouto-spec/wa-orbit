import { OrbitClient } from "./client.js";
import { ActionQueue } from "./queue.js";
import { canSend, normalizeEvent } from "./policy.js";
import { MetaCloudTransport } from "./meta-cloud-transport.js";

export function createConnector(config) {
  const orbit = new OrbitClient(config);
  const transport = config.transport || (config.meta?.accessToken && config.meta?.phoneNumberId ? new MetaCloudTransport(config.meta) : null);
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

  return {statusReceived, executeApproved, queue, transport};
}


export async function syncApproved(config, transport = createConnector(config).transport) {
  const connector=createConnector(config);
  if(!transport) throw new Error("WHATSAPP_TRANSPORT_REQUIRED");
  const batch=await connector.orbit.claimActions(Math.min(5,config.batchSize||5));
  const results=[];
  for(const action of batch.actions||[]) {
    const safety=await connector.orbit.safety();
    const paused=safety.paused===true||safety.paused===1;
    if(paused) {
      results.push({id:action.id,ok:false,reason:"emergency_pause"});
      continue;
    }
    let payload={};
    try { payload=JSON.parse(action.payload_json||"{}"); } catch { payload={}; }
    if(typeof transport.send !== "function") {
      await connector.orbit.actionResult(action.id,{status:"failed",error:"transport.send requis"});
      results.push({id:action.id,ok:false,reason:"transport_missing"});
      continue;
    }
    try {
      const response=await transport.send({phone:payload.phone||action.phone,body:payload.body||action.body});
      await connector.orbit.actionResult(action.id,{status:"sent",provider_message_id:response?.messageId||response?.id||null});
      results.push({id:action.id,ok:true,status:"sent"});
    } catch(error) {
      await connector.orbit.actionResult(action.id,{status:"failed",error:String(error?.message||error)});
      results.push({id:action.id,ok:false,status:"failed",error:String(error?.message||error)});
    }
    if(config.minDelayMs) await new Promise(resolve=>setTimeout(resolve,config.minDelayMs));
  }
  return results;
}
