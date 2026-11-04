import { OrbitClient } from "./client.js";
import { ActionQueue } from "./queue.js";
import { canSend, normalizeEvent } from "./policy.js";
import { MetaCloudTransport } from "./meta-cloud-transport.js";

export function createConnector(config) {
  const orbit = new OrbitClient(config);
  const transport = config.transport || (config.meta?.accessToken && config.meta?.phoneNumberId
    ? new MetaCloudTransport(config.meta)
    : null);
  const queue = new ActionQueue({minDelayMs: config.minDelayMs ?? 30000});

  async function statusReceived(status) {
    const event = normalizeEvent(status);
    return orbit.ingestStatus([{
      external_id: event.externalId,
      phone: event.phone,
      content_type: status.contentType || "text",
      text: event.text,
      timestamp: event.timestamp
    }]);
  }

  async function executeApproved(action) {
    const safety = await orbit.safety();
    const decision = canSend({
      paused: safety.paused === true || safety.paused === 1,
      consentStatus: action.consentStatus,
      approved: action.approved === true,
      dailyCount: action.dailyCount || 0,
      dailyLimit: action.dailyLimit || 5
    });
    if (!decision.ok) return decision;
    queue.push({...action, queuedAt: new Date().toISOString()});
    return {ok: true, queued: true};
  }

  return {orbit, statusReceived, executeApproved, queue, transport};
}

export async function syncApproved(config, transportOverride) {
  const connector = createConnector(config);
  const transport = transportOverride || connector.transport;
  if (!transport || typeof transport.send !== "function") {
    throw new Error("WHATSAPP_TRANSPORT_REQUIRED");
  }

  const requestedBatch = Number(config.batchSize) || 5;
  const batch = await connector.orbit.claimActions(Math.min(5, Math.max(1, requestedBatch)));
  const results = [];
  const delayMs = Math.max(0, Number(config.minDelayMs ?? 30000));

  for (const action of batch.actions || []) {
    // Re-check pause, consent and conversation state on the server immediately before transport.
    let authorization;
    try {
      authorization = await connector.orbit.authorizeAction(action.id);
    } catch (error) {
      results.push({id: action.id, ok: false, reason: "authorization_unavailable"});
      continue;
    }

    if (!authorization.authorized) {
      const status = authorization.retryable ? "deferred" : "cancelled";
      try {
        await connector.orbit.actionResult(action.id, {
          status,
          error: authorization.reason || "not_authorized"
        });
      } catch {}
      results.push({id: action.id, ok: false, reason: authorization.reason || "not_authorized"});
      continue;
    }

    let payload = {};
    try {
      payload = JSON.parse(action.payload_json || "{}");
    } catch {
      await connector.orbit.actionResult(action.id, {status: "failed", error: "invalid_action_payload"});
      results.push({id: action.id, ok: false, reason: "invalid_action_payload"});
      continue;
    }

    const phone = payload.phone || action.phone;
    const body = payload.body || action.body;
    if (!phone || !body) {
      await connector.orbit.actionResult(action.id, {status: "failed", error: "phone_or_body_missing"});
      results.push({id: action.id, ok: false, reason: "phone_or_body_missing"});
      continue;
    }

    let providerResponse;
    try {
      providerResponse = await transport.send({phone, body});
    } catch (error) {
      const message = String(error?.message || error).slice(0, 500);
      await connector.orbit.actionResult(action.id, {status: "failed", error: message});
      results.push({id: action.id, ok: false, status: "failed", error: message});
      continue;
    }

    try {
      await connector.orbit.actionResult(action.id, {
        status: "sent",
        provider_message_id: providerResponse?.messageId || providerResponse?.id || null
      });
      results.push({id: action.id, ok: true, status: "sent", provider_message_id: providerResponse?.id || null});
    } catch (error) {
      // The provider may already have accepted the message. Do not mislabel it as a send failure.
      results.push({id: action.id, ok: false, status: "sent_unconfirmed", error: String(error?.message || error)});
    }

    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return results;
}
