import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const ADMIN_PASSWORD = 'wa-orbit-smoke-password';
const SESSION_SECRET = 'wa-orbit-smoke-session-secret-long-enough';
const APP_SECRET = 'wa-orbit-smoke-app-secret';
const VERIFY_TOKEN = 'wa-orbit-smoke-verify-token-2026';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'wa-orbit-smoke-'));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    ADMIN_PASSWORD,
    SESSION_SECRET,
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    BOT_AUTO_REPLY_ENABLED: 'false'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let childOutput = '';
child.stdout.on('data', chunk => { childOutput += chunk.toString(); });
child.stderr.on('data', chunk => { childOutput += chunk.toString(); });

async function requestReady() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Le serveur a quitté prématurément.\n${childOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error(`Le serveur ne devient pas prêt.\n${childOutput}`);
}

try {
  const healthResponse = await requestReady();
  const health = await healthResponse.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.storage, 'local-file');

  const unauthenticated = await fetch(`${baseUrl}/api/contacts`);
  assert.equal(unauthenticated.status, 401, 'Les routes privées doivent refuser une session absente.');

  const challengeUrl = new URL('/webhook', baseUrl);
  challengeUrl.searchParams.set('hub.mode', 'subscribe');
  challengeUrl.searchParams.set('hub.verify_token', VERIFY_TOKEN);
  challengeUrl.searchParams.set('hub.challenge', 'orbit-challenge');
  const challenge = await fetch(challengeUrl);
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), 'orbit-challenge');

  async function postSignedWebhook(payload) {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      body
    });
  }
  const incomingMessageId = 'wamid.WAOrbitSmoke001';
  const incomingPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_SMOKE',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '+15550000000', phone_number_id: 'PHONE_SMOKE' },
          contacts: [{ profile: { name: 'Contact Webhook Smoke' }, wa_id: '2250700000003' }],
          messages: [{
            from: '2250700000003',
            id: incomingMessageId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'Bonjour depuis le test WA Orbit' }
          }]
        }
      }]
    }]
  };
  const acceptedWebhook = await postSignedWebhook(incomingPayload);
  assert.equal(acceptedWebhook.status, 200, 'Un webhook entrant signé doit être accepté.');

  const duplicateWebhook = await postSignedWebhook(incomingPayload);
  assert.equal(duplicateWebhook.status, 200, 'Une livraison dupliquée doit être acquittée sans erreur.');

  const rejectedWebhook = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(incomingPayload)
  });
  assert.equal(rejectedWebhook.status, 401, 'Un webhook non signé doit être rejeté.');

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  });
  assert.equal(login.status, 200, 'La connexion admin doit fonctionner.');
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  assert.ok(cookie.includes('waorbit.sid='), 'Le cookie de session doit être émis.');

  const safetyInitial = await fetch(`${baseUrl}/api/safety`, { headers: { cookie } });
  assert.equal(safetyInitial.status, 200);
  assert.equal((await safetyInitial.json()).paused, true, 'Le système doit démarrer en pause sécurisée.');
  const safetyResume = await fetch(`${baseUrl}/api/safety/pause`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ paused: false }) });
  assert.equal(safetyResume.status, 200);
  assert.equal((await safetyResume.json()).paused, false);
  const safetyPause = await fetch(`${baseUrl}/api/safety/pause`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ paused: true }) });
  assert.equal(safetyPause.status, 200);
  assert.equal((await safetyPause.json()).paused, true);

  const forbiddenOrigin = await fetch(`${baseUrl}/api/contacts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'https://attacker.invalid'
    },
    body: JSON.stringify({ name: 'Intrus', phone: '+2250700000099' })
  });
  assert.equal(forbiddenOrigin.status, 403, 'Les mutations cross-origin doivent être rejetées.');

  const created = await fetch(`${baseUrl}/api/contacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Contact Smoke', phone: '+2250700000001' })
  });
  assert.equal(created.status, 201);
  const contact = await created.json();
  assert.equal(contact.optedIn, false, 'Un contact neuf ne doit jamais être opt-in par défaut.');

  const duplicate = await fetch(`${baseUrl}/api/contacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Doublon', phone: '+225 07 00 00 00 01' })
  });
  assert.equal(duplicate.status, 409, 'Un numéro normalisé en double doit être refusé.');

  const imported = await fetch(`${baseUrl}/api/contacts/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ contacts: [
      { name: 'Contact importé', phone: '+2250700000002', optedIn: false },
      { name: 'Numéro invalide', phone: 'pas-un-numero', optedIn: true }
    ] })
  });
  assert.equal(imported.status, 200);
  const importResult = await imported.json();
  assert.equal(importResult.added, 1);
  assert.equal(importResult.skipped, 1);

  const listed = await fetch(`${baseUrl}/api/contacts`, { headers: { cookie } });
  assert.equal(listed.status, 200);
  const contacts = await listed.json();
  assert.equal(contacts.length, 3);
  const inboundContact = contacts.find(item => item.phone === '2250700000003');
  assert.ok(inboundContact, 'Le webhook doit créer automatiquement un contact entrant.');
  assert.equal(inboundContact.name, 'Contact Webhook Smoke', 'Le nom WhatsApp transmis par Meta doit être repris.');
  assert.equal(inboundContact.optedIn, false, 'Un contact qui écrit n’est pas implicitement opt-in aux campagnes.');
  assert.equal(inboundContact.messages.length, 1, 'Le message entrant doit être conservé une seule fois malgré une livraison dupliquée.');
  assert.equal(inboundContact.messages[0].role, 'user');
  assert.equal(inboundContact.messages[0].content, 'Bonjour depuis le test WA Orbit');

  const stopPayload = structuredClone(incomingPayload);
  stopPayload.entry[0].changes[0].value.messages[0] = {
    from: '2250700000003',
    id: 'wamid.WAOrbitSmokeSTOP',
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body: 'STOP' }
  };
  const stopWebhook = await postSignedWebhook(stopPayload);
  assert.equal(stopWebhook.status, 200);
  const afterStopResponse = await fetch(`${baseUrl}/api/contacts`, { headers: { cookie } });
  const afterStop = await afterStopResponse.json();
  const stoppedContact = afterStop.find(item => item.phone === '2250700000003');
  assert.equal(stoppedContact.blocked, true, 'STOP doit bloquer immédiatement les réponses automatiques et les envois.');
  assert.equal(stoppedContact.optedIn, false, 'STOP doit retirer le consentement.');

  const mediaPayload = structuredClone(incomingPayload);
  mediaPayload.entry[0].changes[0].value.contacts[0].wa_id = '2250700000004';
  mediaPayload.entry[0].changes[0].value.contacts[0].profile.name = 'Contact Media Smoke';
  mediaPayload.entry[0].changes[0].value.messages[0] = {
    from: '2250700000004',
    id: 'wamid.WAOrbitSmokeMEDIA',
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'image',
    image: { mime_type: 'image/jpeg', sha256: 'smoke', id: 'MEDIA_SMOKE' }
  };
  const mediaWebhook = await postSignedWebhook(mediaPayload);
  assert.equal(mediaWebhook.status, 200);
  const afterMediaResponse = await fetch(`${baseUrl}/api/contacts`, { headers: { cookie } });
  const afterMedia = await afterMediaResponse.json();
  const mediaContact = afterMedia.find(item => item.phone === '2250700000004');
  assert.ok(mediaContact, 'Un message média doit créer une conversation.');
  assert.equal(mediaContact.name, 'Contact Media Smoke');
  assert.equal(mediaContact.messages.length, 1);
  assert.equal(mediaContact.messages[0].content, '[Message image reçu]');

  console.log('WA Orbit smoke tests : OK');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(4000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(dataDir, { recursive: true, force: true });
}
