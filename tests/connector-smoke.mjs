import assert from "node:assert/strict";
import { canSend, normalizeEvent } from "../connector/src/policy.js";
import { ActionQueue } from "../connector/src/queue.js";
import { MetaCloudTransport } from "../connector/src/meta-cloud-transport.js";
import { syncApproved } from "../connector/src/index.js";
import { OrbitClient } from "../connector/src/client.js";
import { BaileysTransport } from "../connector/src/baileys-transport.js";
import { EventEmitter } from "node:events";

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
  apiVersion:"v26.0",
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

const apiCalls=[];
const apiFetch=async(url,options={})=>{
  apiCalls.push({url,options});
  if(url.endsWith("/api/actions/claim")) return new Response(JSON.stringify({
    actions:[{id:44,payload_json:JSON.stringify({phone:"+2250700000000",body:"Bonjour"}),phone:"+2250700000000",body:"Bonjour"}]
  }),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/44/authorize")) return new Response(JSON.stringify({authorized:true}),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/44/result")) return new Response(JSON.stringify({ok:true,status:"sent"}),{status:200,headers:{"content-type":"application/json"}});
  throw new Error("Unexpected API URL: "+url);
};
const transportCalls=[];
const syncResult=await syncApproved({
  baseUrl:"https://orbit.example",
  token:"test-token",
  fetchImpl:apiFetch,
  minDelayMs:0,
  batchSize:1
},{
  send:async({phone,body})=>{
    transportCalls.push({phone,body});
    return {id:"wamid.sync-test"};
  }
});
assert.equal(syncResult[0].status,"sent");
assert.equal(transportCalls.length,1);
assert.equal(transportCalls[0].phone,"+2250700000000");
assert.equal(transportCalls[0].body,"Bonjour");
assert.ok(apiCalls.some(call=>call.url.endsWith("/api/actions/44/authorize")));
assert.ok(apiCalls.some(call=>call.url.endsWith("/api/actions/44/result")));

const pausedCalls=[];
const pausedFetch=async(url,options={})=>{
  pausedCalls.push({url,options});
  if(url.endsWith("/api/actions/claim")) return new Response(JSON.stringify({
    actions:[{id:45,payload_json:JSON.stringify({phone:"+2250700000000",body:"Bonjour"})}]
  }),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/45/authorize")) return new Response(JSON.stringify({
    authorized:false,reason:"emergency_pause",retryable:true
  }),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/45/result")) return new Response(JSON.stringify({ok:true,status:"queued"}),{status:200,headers:{"content-type":"application/json"}});
  throw new Error("Unexpected paused API URL: "+url);
};
let pausedTransportCalls=0;
const pausedResult=await syncApproved({
  baseUrl:"https://orbit.example",token:"test-token",fetchImpl:pausedFetch,minDelayMs:0,batchSize:1
},{send:async()=>{pausedTransportCalls++;return {id:"never"};}});
assert.equal(pausedResult[0].reason,"emergency_pause");
assert.equal(pausedTransportCalls,0);
assert.ok(pausedCalls.some(call=>call.url.endsWith("/api/actions/45/result")));
console.log("WA Orbit guarded sync tests : OK");

const normalizedClient = new OrbitClient({
  baseUrl: "https://orbit.example/",
  token: "test",
  fetchImpl: async () => new Response(JSON.stringify({ok:true}), {status:200})
});
assert.equal(normalizedClient.baseUrl, "https://orbit.example");

let templatePayload;
const templateTransport = new MetaCloudTransport({
  accessToken:"template-token",
  phoneNumberId:"123",
  fetchImpl:async(url,options)=>{
    templatePayload=JSON.parse(options.body);
    return new Response(JSON.stringify({messages:[{id:"wamid.template"}]}),{status:200,headers:{"content-type":"application/json"}});
  }
});
const templateSent=await templateTransport.sendTemplate({
  phone:"+2250700000000",
  name:"orbit_followup",
  language:"fr",
  body:"Petit message personnalisé"
});
assert.equal(templateSent.id,"wamid.template");
assert.equal(templatePayload.type,"template");
assert.equal(templatePayload.template.name,"orbit_followup");
assert.equal(templatePayload.template.language.code,"fr");
assert.equal(templatePayload.template.components[0].parameters[0].text,"Petit message personnalisé");

const templateApiCalls=[];
const templateApiFetch=async(url,options={})=>{
  templateApiCalls.push({url,options});
  if(url.endsWith("/api/actions/claim")) return new Response(JSON.stringify({
    actions:[{
      id:46,
      send_mode:"template",
      payload_json:JSON.stringify({
        phone:"+2250700000000",
        body:"Texte de suivi",
        mode:"template",
        template_name:"orbit_followup",
        template_language:"fr",
        template_body_parameter:true
      })
    }]
  }),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/46/authorize")) return new Response(JSON.stringify({authorized:true}),{status:200,headers:{"content-type":"application/json"}});
  if(url.endsWith("/api/actions/46/result")) return new Response(JSON.stringify({ok:true,status:"sent"}),{status:200,headers:{"content-type":"application/json"}});
  throw new Error("Unexpected template API URL: "+url);
};
let templateTransportCalls=0;
const templateSync=await syncApproved({
  baseUrl:"https://orbit.example",token:"test-token",fetchImpl:templateApiFetch,minDelayMs:0,batchSize:1
},{
  send:async()=>{throw new Error("free-form text must not be used");},
  sendTemplate:async({phone,name,language,body})=>{
    templateTransportCalls++;
    assert.equal(phone,"+2250700000000");
    assert.equal(name,"orbit_followup");
    assert.equal(language,"fr");
    assert.equal(body,"Texte de suivi");
    return {id:"wamid.template-sync"};
  }
});
assert.equal(templateSync[0].status,"sent");
assert.equal(templateTransportCalls,1);
console.log("WA Orbit approved-template tests : OK");

const events = new EventEmitter();
const inbound = [];
const receipts = [];
const socket = {
  ev: events,
  async sendMessage(jid, payload) {
    assert.equal(jid, "2250700000000@s.whatsapp.net");
    assert.equal(payload.text, "Salut Baileys");
    return { key: { id: "BAILEYS-1" } };
  },
  end() {}
};
const baileys = new BaileysTransport({
  authDir: "test-auth",
  authStateFactory: async () => ({ state: { creds: { registered: true } }, saveCreds: async () => {} }),
  socketFactory: () => socket,
  onMessage: value => inbound.push(value),
  onReceipt: value => receipts.push(value)
});
await baileys.connect();
const baileysSent = await baileys.send({phone:"+2250700000000",body:"Salut Baileys"});
assert.equal(baileysSent.id,"BAILEYS-1");
events.emit("messages.upsert", {messages:[{
  key:{id:"INBOUND-1",remoteJid:"2250700000011@s.whatsapp.net",fromMe:false},
  pushName:"Koffi",
  message:{conversation:"Salut Orbit"}
}]});
await new Promise(resolve => setImmediate(resolve));
assert.equal(inbound[0].phone,"2250700000011");
assert.equal(inbound[0].text,"Salut Orbit");
events.emit("messages.update", [{key:{id:"BAILEYS-1",remoteJid:"2250700000000@s.whatsapp.net"},update:{status:4}}]);
await new Promise(resolve => setImmediate(resolve));
assert.equal(receipts[0].status,"read");
await baileys.stop();
console.log("WA Orbit Baileys transport smoke tests : OK");
