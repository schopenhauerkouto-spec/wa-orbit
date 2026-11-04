import assert from "node:assert/strict";
import { canSend, normalizeEvent } from "../connector/src/policy.js";
import { ActionQueue } from "../connector/src/queue.js";
import { MetaCloudTransport } from "../connector/src/meta-cloud-transport.js";

assert.deepEqual(canSend({paused:true,consentStatus:"opted_in",approved:true,dailyCount:0,dailyLimit:5}),{ok:false,reason:"emergency_pause"});
assert.deepEqual(canSend({paused:false,consentStatus:"unknown",approved:true,dailyCount:0,dailyLimit:5}),{ok:false,reason:"consent_required"});
assert.deepEqual(canSend({paused:false,consentStatus:"opted_in",approved:false,dailyCount:0,dailyLimit:5}),{ok:false,reason:"approval_required"});
assert.deepEqual(canSend({paused:false,consentStatus:"opted_in",approved:true,dailyCount:5,dailyLimit:5}),{ok:false,reason:"daily_limit"});
assert.deepEqual(canSend({paused:false,consentStatus:"opted_in",approved:true,dailyCount:0,dailyLimit:5}),{ok:true,reason:"allowed"});

const event=normalizeEvent({id:123,phone:"+225 07 00",text:"Salut"});
assert.equal(event.externalId,"123");
assert.equal(event.type,"message");
assert.equal(event.phone,"+225 07 00");
assert.equal(event.text,"Salut");
assert.equal(typeof event.timestamp,"string");

const queue=new ActionQueue({minDelayMs:1000});
queue.push({id:1}); queue.push({id:2});
const seen=[];
await queue.drain(async action=>seen.push(action.id));
assert.deepEqual(seen,[1,2]);

console.log("WA Orbit connector smoke tests : OK");

const requests=[];
const transport=new MetaCloudTransport({
  accessToken:"test-token",
  phoneNumberId:"123",
  apiVersion:"v23.0",
  fetchImpl:async(url,options)=>{
    requests.push({url,options});
    return new Response(JSON.stringify({messages:[{id:"wamid.test"}]}),{status:200,headers:{"content-type":"application/json"}});
  }
});
const sent=await transport.send({phone:"+2250700000000",body:"Salut 👋"});
assert.equal(sent.id,"wamid.test");
assert.equal(requests[0].options.method,"POST");
assert.equal(JSON.parse(requests[0].options.body).messaging_product,"whatsapp");
assert.equal(JSON.parse(requests[0].options.body).text.body,"Salut 👋");
assert.equal(requests[0].options.headers.Authorization,"Bearer test-token");

console.log("WA Orbit Meta transport smoke tests : OK");
