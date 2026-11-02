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

  const webhookBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(webhookBody).digest('hex')}`;
  const acceptedWebhook = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: webhookBody
  });
  assert.equal(acceptedWebhook.status, 200, 'Un webhook signé doit être accepté.');

  const rejectedWebhook = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: webhookBody
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
  assert.equal(contacts.length, 2);

  console.log('WA Orbit smoke tests : OK');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(4000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(dataDir, { recursive: true, force: true });
}
