const state = { contacts: [], events: [], config: null, groupModeration: null, currentPage: 'overview', selectedConversationId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let toastTimer;

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erreur ${response.status}`);
    error.status = response.status;
    error.details = data.details;
    throw error;
  }
  return data;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?';
}
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);
}
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
function within24h(value) {
  if (!value) return false;
  const elapsed = Date.now() - new Date(value).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 24 * 60 * 60 * 1000;
}
function stageLabel(contact) {
  if (contact.blocked || contact.stage === 'opt-out') return ['Opt-out / bloqué', 'red'];
  if (contact.conversationStarted) return ['Conversation', 'blue'];
  if (contact.optedIn) return ['Éligible', 'green'];
  return ['Consentement requis', 'orange'];
}
function consentLabel(contact) {
  if (contact.blocked) return ['Retiré / bloqué', 'red'];
  if (contact.optedIn) return ['Confirmé', 'green'];
  return ['Non confirmé', 'orange'];
}

function showPage(page) {
  if (!$(`#page-${page}`)) page = 'overview';
  state.currentPage = page;
  $$('.page').forEach(section => section.classList.toggle('active-page', section.id === `page-${page}`));
  $$('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page && (button.classList.contains('nav-item') || button.closest('.mobile-nav'))));
  const labels = { overview: "Vue d'ensemble", contacts: 'Contacts', inbox: 'Conversations', campaigns: 'Messages', status: 'Statuts', groups: 'Groupes & modération', settings: 'Paramètres' };
  $('#breadcrumbCurrent').textContent = labels[page] || 'Accueil';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'campaigns') renderRecipientOptions();
  if (page === 'inbox') renderInbox();
}

async function loadData() {
  const [contacts, events, config, safety, groupModeration] = await Promise.all([
    api('/api/contacts'), api('/api/events'), api('/api/config'), api('/api/safety'), api('/api/groups/moderation')
  ]);
  state.contacts = contacts;
  state.events = events;
  state.config = { ...config, safety };
  state.groupModeration = groupModeration;
  renderAll();
}

function renderAll() {
  renderOverview();
  renderContacts();
  renderEvents();
  renderInbox();
  renderRecipientOptions();
  renderSettings();
  renderGroupModeration();
}

function renderOverview() {
  const total = state.contacts.length;
  const eligible = state.contacts.filter(c => c.optedIn && !c.blocked).length;
  const conversations = state.contacts.filter(c => c.conversationStarted).length;
  const paused = state.contacts.filter(c => !c.optedIn || c.blocked).length;
  $('#statContacts').textContent = total;
  $('#statEligible').textContent = eligible;
  $('#statConversations').textContent = conversations;
  $('#statPaused').textContent = paused;
  $('#navContactCount').textContent = total;
  $('#navInboxCount').textContent = state.events.filter(e => e.kind === 'incoming').length;
  $('#contactTotal').textContent = total;
  $('#contactConsented').textContent = eligible;
  $('#contactConvo').textContent = conversations;
  $('#contactStopped').textContent = paused;

  const incoming = state.config?.whatsapp?.configured;
  const badge = $('#connectionBadge');
  badge.classList.toggle('offline', !incoming);
  badge.innerHTML = `<i></i> ${incoming ? 'Identifiants Cloud API présents' : 'API non configurée'}`;

  const waReady = Boolean(state.config?.whatsapp?.configured);
  $('#waCheck').textContent = waReady ? '✓' : '·';
  $('#waCheck').classList.toggle('done', waReady);
  $('#waReadiness').textContent = waReady ? 'Identifiants détectés côté serveur' : 'À configurer dans .env';
  $('#waState').textContent = waReady ? 'CONNECTÉ' : 'À FAIRE';
  $('#waState').classList.toggle('ready', waReady);
  const aiReady = Boolean(state.config?.aiConfigured);
  $('#aiCheck').textContent = aiReady ? '✓' : '·';
  $('#aiCheck').classList.toggle('done', aiReady);
  $('#aiReadiness').textContent = aiReady ? (state.config?.bot?.autoReplyEnabled ? 'Bot conversationnel automatique activé' : 'Groq connecté — réponses automatiques en pause') : 'Ajoute ta clé Groq dans .env';
  $('#aiState').textContent = aiReady ? (state.config?.bot?.autoReplyEnabled ? 'BOT ACTIF' : 'GROQ OK') : 'À FAIRE';
  $('#aiState').classList.toggle('ready', aiReady);
}

function renderContacts() {
  const query = ($('#contactSearch')?.value || '').toLowerCase().trim();
  const filter = $('#contactFilter')?.value || 'all';
  const filtered = state.contacts.filter(contact => {
    const matchesQuery = !query || `${contact.name} ${contact.phone}`.toLowerCase().includes(query);
    let matchesFilter = true;
    if (filter === 'eligible') matchesFilter = contact.optedIn && !contact.blocked && !contact.conversationStarted;
    else if (filter === 'consent-required') matchesFilter = !contact.optedIn && !contact.blocked;
    else if (filter === 'conversation') matchesFilter = contact.conversationStarted;
    else if (filter === 'opt-out') matchesFilter = contact.blocked || contact.stage === 'opt-out';
    return matchesQuery && matchesFilter;
  });
  const tbody = $('#contactsBody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${state.contacts.length ? 'Aucun contact ne correspond à ce filtre.' : 'Ton carnet est vide pour le moment.'}</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(contact => {
      const [consent, consentClass] = consentLabel(contact);
      const [stage, stageClass] = stageLabel(contact);
      const last = contact.lastInboundAt || contact.lastOutboundAt;
      return `<tr>
        <td><div class="contact-name"><span class="contact-avatar">${escapeHtml(initials(contact.name))}</span><span><strong>${escapeHtml(contact.name)}</strong><small>Ajouté le ${escapeHtml(formatDate(contact.createdAt))}</small></span></div></td>
        <td>${escapeHtml(contact.phone)}</td>
        <td><span class="pill ${consentClass}">${consent}</span></td>
        <td><span class="pill ${stageClass}">${stage}</span></td>
        <td>${escapeHtml(formatDate(last))}</td>
        <td><div class="row-actions">${contact.optedIn && !contact.blocked ? `<button class="row-action" data-action="revoke" data-id="${contact.id}">Retirer accord</button>` : !contact.blocked ? `<button class="row-action" data-action="consent" data-id="${contact.id}">Confirmer accord</button>` : `<span class="row-action is-muted">Bloqué</span>`}<button class="row-action" data-action="stop" data-id="${contact.id}" title="Bloquer">⊘</button></div></td>
      </tr>`;
    }).join('');
  }
  $('#contactCountLabel').textContent = `${filtered.length} contact${filtered.length > 1 ? 's' : ''}`;
  $('#navContactCount').textContent = state.contacts.length;
}

function eventPresentation(event) {
  const types = {
    incoming: ['▤', 'incoming', 'Message entrant'],
    sent: ['↗', '', 'Message envoyé'],
    delivery: ['✓', '', `Statut : ${event.status || 'livraison'}`],
    optout: ['⊘', 'stop', 'Demande d’arrêt'],
    import: ['↓', '', 'Import de contacts'],
    'contact-added': ['＋', '', 'Contact ajouté'],
    'send-error': ['!', 'stop', 'Échec d’envoi'],
    'bot-reply': ['✦', 'incoming', 'Réponse automatique du bot'],
    'bot-error': ['!', 'stop', 'Erreur du bot'],
    'bot-paused': ['Ⅱ', 'stop', 'Réponse automatique suspendue']
  };
  return types[event.kind] || ['·', '', 'Événement'];
}
function eventMarkup(event) {
  const [symbol, css, title] = eventPresentation(event);
  const body = event.text || (event.phone ? event.phone : 'Événement WhatsApp');
  return `<div class="event-row"><span class="event-symbol ${escapeHtml(css)}">${escapeHtml(symbol)}</span><div class="event-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(body)}</small></div><time class="event-time">${escapeHtml(formatTime(event.at))}</time></div>`;
}
function renderEvents() {
  const recent = state.events.slice(0, 5);
  const recentNode = $('#recentEvents');
  recentNode.innerHTML = recent.length ? recent.map(eventMarkup).join('') : `<div class="empty-state compact"><span>◷</span><strong>Pas encore d’activité</strong><p>Les événements apparaîtront ici.</p></div>`;
  const inboxNode = $('#inboxEvents');
  inboxNode.innerHTML = state.events.length ? state.events.map(eventMarkup).join('') : `<div class="empty-state"><span>▤</span><strong>Aucune conversation reçue</strong><p>Configure le webhook Meta pour recevoir les réponses.</p></div>`;
}

function renderRecipientOptions() {
  const select = $('#messageContact');
  if (!select) return;
  const previous = select.value;
  const contacts = state.contacts.filter(c => !c.blocked && (c.optedIn || within24h(c.lastInboundAt))); 
  select.innerHTML = `<option value="">Choisir un contact autorisé…</option>` + contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name)} · ${escapeHtml(c.phone)}</option>`).join('');
  if (contacts.some(c => c.id === previous)) select.value = previous;
  updateRecipientHint();
}


function conversationLastMessage(contact) {
  const messages = Array.isArray(contact?.messages) ? contact.messages : [];
  return messages.length ? messages[messages.length - 1] : null;
}
function conversationTimestamp(contact) {
  const lastMessage = conversationLastMessage(contact);
  const value = lastMessage?.at || contact?.lastInboundAt || contact?.updatedAt || contact?.createdAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
function renderInbox() {
  const search = ($('#conversationSearch')?.value || '').toLowerCase().trim();
  const conversations = state.contacts
    .filter(contact => contact.conversationStarted || (Array.isArray(contact.messages) && contact.messages.length > 0))
    .sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));
  const visible = conversations.filter(contact =>
    !search || `${contact.name || ''} ${contact.phone || ''}`.toLowerCase().includes(search)
  );
  if (!visible.some(contact => contact.id === state.selectedConversationId)) {
    state.selectedConversationId = visible[0]?.id || null;
  }
  const list = $('#conversationList');
  if (!list) return;
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state compact"><span>▤</span><strong>Aucune conversation</strong><p>Les messages entrants apparaîtront ici après réception par le webhook.</p></div>';
  } else {
    list.innerHTML = visible.map(contact => {
      const last = conversationLastMessage(contact);
      const preview = last?.content || 'Conversation démarrée';
      const isOpen = within24h(contact.lastInboundAt);
      return `<button type="button" class="conversation-item ${contact.id === state.selectedConversationId ? 'active' : ''}" data-thread-id="${escapeHtml(contact.id)}" aria-pressed="${contact.id === state.selectedConversationId}">
        <span class="conversation-avatar">${escapeHtml(initials(contact.name))}</span>
        <span class="conversation-item-copy"><strong>${escapeHtml(contact.name || contact.phone)}</strong><small>${escapeHtml(contact.phone)}</small><span>${escapeHtml(preview)}</span></span>
        <span class="conversation-item-meta"><time>${escapeHtml(formatTime(last?.at || contact.lastInboundAt))}</time><i class="${isOpen ? 'window-open' : 'window-closed'}" title="${isOpen ? 'Fenêtre de 24 h ouverte' : 'Fenêtre de 24 h fermée'}"></i></span>
      </button>`;
    }).join('');
  }
  renderConversation();
}
function renderConversation() {
  const contact = state.contacts.find(item => item.id === state.selectedConversationId);
  const header = $('#conversationHeader');
  const messagesNode = $('#conversationMessages');
  const policy = $('#conversationPolicy');
  const input = $('#conversationReplyText');
  const approval = $('#conversationApproval');
  const submit = $('#conversationReplyForm button[type="submit"]');
  if (!header || !messagesNode || !policy || !input || !approval || !submit) return;

  if (!contact) {
    header.innerHTML = '<div><strong>Aucune conversation sélectionnée</strong><small>Choisis une conversation dans la colonne de gauche.</small></div>';
    messagesNode.innerHTML = '<div class="empty-state"><span>✉</span><strong>Ta boîte de réception est prête</strong><p>Les échanges s’afficheront ici dès qu’un contact t’écrira.</p></div>';
    policy.textContent = 'Une réponse libre est possible pendant les 24 heures qui suivent le dernier message entrant.';
    input.disabled = true;
    approval.disabled = true;
    submit.disabled = true;
    return;
  }

  const isOpen = within24h(contact.lastInboundAt);
  const blocked = Boolean(contact.blocked);
  header.innerHTML = `<div class="conversation-person"><span class="conversation-avatar large">${escapeHtml(initials(contact.name))}</span><span><strong>${escapeHtml(contact.name || contact.phone)}</strong><small>${escapeHtml(contact.phone)}</small></span></div><span class="thread-window ${isOpen && !blocked ? 'open' : 'closed'}">${blocked ? 'Contact bloqué' : isOpen ? 'Fenêtre 24 h ouverte' : 'Fenêtre 24 h fermée'}</span>`;

  const messages = Array.isArray(contact.messages) ? contact.messages : [];
  messagesNode.innerHTML = messages.length ? messages.map(message => {
    const role = message.role === 'user' ? 'incoming' : 'outgoing';
    const label = role === 'incoming' ? 'Contact' : 'WA Orbit / Admin';
    const body = escapeHtml(message.content || '').replace(/\n/g, '<br>');
    return `<article class="message-bubble ${role}"><small>${label}</small><p>${body}</p><time>${escapeHtml(formatTime(message.at))}</time></article>`;
  }).join('') : '<div class="empty-state compact"><span>✉</span><strong>Pas encore de message affichable</strong><p>Le contact a démarré une conversation, mais aucun contenu texte n’est disponible.</p></div>';
  messagesNode.scrollTop = messagesNode.scrollHeight;

  input.disabled = blocked || !isOpen;
  approval.disabled = blocked || !isOpen;
  submit.disabled = blocked || !isOpen;
  policy.textContent = blocked
    ? 'Envoi impossible : ce contact a demandé l’arrêt ou a été bloqué.'
    : isOpen
      ? 'Fenêtre de service ouverte : tu peux répondre librement à ce contact. Une validation humaine reste obligatoire.'
      : 'Fenêtre de 24 h fermée : la réponse libre est désactivée. Pour un message hors fenêtre, utilise un modèle approuvé et vérifie le consentement dans la rubrique Messages.';
}
async function handleConversationReply(event) {
  event.preventDefault();
  const contact = state.contacts.find(item => item.id === state.selectedConversationId);
  const feedback = $('#conversationReplyFeedback');
  const input = $('#conversationReplyText');
  const approval = $('#conversationApproval');
  const submit = $('#conversationReplyForm button[type="submit"]');
  if (!contact) { feedback.textContent = 'Sélectionne une conversation.'; return; }
  if (contact.blocked) { feedback.textContent = 'Ce contact est bloqué.'; return; }
  if (!within24h(contact.lastInboundAt)) { feedback.textContent = 'La fenêtre de 24 h est fermée. Utilise un modèle approuvé si les conditions sont réunies.'; return; }
  const text = input.value.trim();
  if (!text) { feedback.textContent = 'Écris une réponse avant de l’envoyer.'; return; }
  if (!approval.checked) { feedback.textContent = 'Confirme la vérification du destinataire et du message.'; return; }

  feedback.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Envoi en cours…';
  try {
    const result = await api('/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ contactId: contact.id, mode: 'text', text, approved: true })
    });
    input.value = '';
    approval.checked = false;
    $('#conversationCharCount').textContent = '0 / 4096';
    feedback.style.color = '#2b9669';
    feedback.textContent = `Message accepté par Meta. Référence : ${result.messageId || 'non fournie'}`;
    await loadData();
    toast('Réponse envoyée.');
  } catch (error) {
    feedback.style.color = '#c06c59';
    feedback.textContent = error.message;
  } finally {
    submit.disabled = !within24h(contact.lastInboundAt) || contact.blocked;
    submit.textContent = 'Envoyer la réponse';
  }
}

function renderGroupModeration() {
  const data = state.groupModeration;
  if (!data?.policy || !$('#groupModerationForm')) return;
  const p = data.policy;
  $('#groupPolicyEnabled').checked = p.enabled === true;
  $('#groupPolicyMode').value = p.mode || 'observe';
  $('#groupExemptAdmins').checked = p.exemptAdmins !== false;
  $('#groupLinksEnabled').checked = p.links?.enabled !== false;
  $('#groupAllowAnyLinks').checked = p.links?.allowAny === true;
  $('#groupAllowAdminLinks').checked = p.links?.allowAdmins !== false;
  $('#groupAllowedDomains').value = (p.links?.allowedDomains || []).join('\n');
  $('#groupBlockedDomains').value = (p.links?.blockedDomains || []).join('\n');
  $('#groupFloodEnabled').checked = p.flood?.enabled !== false;
  $('#groupFloodMax').value = p.flood?.maxMessages ?? 5;
  $('#groupFloodWindow').value = p.flood?.windowSeconds ?? 10;
  $('#groupRepeatsEnabled').checked = p.repeats?.enabled !== false;
  $('#groupRepeatMax').value = p.repeats?.maxRepeats ?? 3;
  $('#groupRepeatWindow').value = p.repeats?.windowSeconds ?? 120;
  $('#groupWarningsEnabled').checked = p.warnings?.enabled !== false;
  $('#groupWarningThreshold').value = p.warnings?.threshold ?? 3;
  const connector = data.connector || {};
  $('#groupTransportState').textContent = connector.connected
    ? (connector.liveEnforcement
      ? 'Baileys connecté : l’enforcement est armé. La suppression exige que le bot soit administrateur du groupe.'
      : 'Baileys connecté, mais l’enforcement live est désactivé. Les décisions restent en observation.')
    : 'Aucun connecteur de groupes n’est actif. Les règles restent en configuration/simulation.';
  $('#groupPolicyFeedback').textContent = p.enabled
    ? (connector.connected ? 'Moteur actif : vérifie le mode et les droits du bot avant toute enforcement.' : 'Moteur activé, mais aucun connecteur réel n’est connecté.')
    : 'Moteur désactivé au démarrage.';
}

function groupPolicyPayload() {
  return {
    enabled: $('#groupPolicyEnabled').checked,
    mode: $('#groupPolicyMode').value,
    exemptAdmins: $('#groupExemptAdmins').checked,
    links: {
      enabled: $('#groupLinksEnabled').checked,
      allowAny: $('#groupAllowAnyLinks').checked,
      allowAdmins: $('#groupAllowAdminLinks').checked,
      allowedDomains: $('#groupAllowedDomains').value.split(String.fromCharCode(10)).flatMap(line => line.split(/[,;]/)).map(v => v.trim()).filter(Boolean),
      blockedDomains: $('#groupBlockedDomains').value.split(String.fromCharCode(10)).flatMap(line => line.split(/[,;]/)).map(v => v.trim()).filter(Boolean)
    },
    flood: {
      enabled: $('#groupFloodEnabled').checked,
      maxMessages: Number($('#groupFloodMax').value),
      windowSeconds: Number($('#groupFloodWindow').value)
    },
    repeats: {
      enabled: $('#groupRepeatsEnabled').checked,
      maxRepeats: Number($('#groupRepeatMax').value),
      windowSeconds: Number($('#groupRepeatWindow').value)
    },
    warnings: {
      enabled: $('#groupWarningsEnabled').checked,
      threshold: Number($('#groupWarningThreshold').value)
    }
  };
}

function renderSettings() {
  const cfg = state.config;
  if (!cfg) return;
  const safety = cfg.safety || { paused: true };
  const safetyNode = $('#safetyState');
  safetyNode.classList.toggle('ready', safety.paused === false);
  safetyNode.classList.toggle('pending', safety.paused !== false);
  safetyNode.querySelector('strong').textContent = safety.paused ? 'Système en pause — envois bloqués' : 'Système disponible — contrôles actifs';
  $('#safetyModeLabel').textContent = safety.paused ? 'PAUSE ACTIVE' : 'ACTIF';
  $('#safetyUpdatedLabel').textContent = formatTime(safety.updatedAt) || '—';
  const safetyButton = $('#safetyToggleBtn');
  safetyButton.textContent = safety.paused ? 'Reprendre après vérification' : 'Activer l’arrêt d’urgence';
  safetyButton.classList.toggle('btn-primary', safety.paused);
  safetyButton.classList.toggle('btn-outline', !safety.paused);
  const wa = cfg.whatsapp;
  $('#tokenPresence').textContent = wa.tokenPresent ? 'Détecté · masqué' : 'Non détecté';
  $('#phoneIdPresence').textContent = wa.phoneNumberIdPresent ? 'Détecté · masqué' : 'Non détecté';
  $('#versionPresence').textContent = wa.apiVersionPresent ? 'Détectée' : 'Non détectée';
  const waNode = $('#whatsappSettingsState');
  waNode.classList.toggle('ready', wa.configured);
  waNode.querySelector('strong').textContent = wa.configured ? 'Configuration détectée' : 'Configuration incomplète';
  $('#aiKeyPresence').textContent = cfg.aiConfigured ? 'Détectée · masquée' : 'Non détectée';
  $('#aiModelPresence').textContent = cfg.aiConfigured ? (cfg.groq?.model || 'Configuré') : 'Non détecté';
  $('#autoReplyPresence').textContent = cfg.bot?.autoReplyEnabled ? `Actives · ${cfg.bot.repliesToday || 0}/${cfg.bot.maxAutoRepliesPerDay || 50} aujourd’hui` : 'Désactivées';
  const quota = cfg.groq?.freeTier;
  if (quota) {
    $('#groqQuotaModel').textContent = quota.model || '—';
    $('#groqQuotaRequests').textContent = `${quota.used.requestsToday} / ${quota.limits.rpd} aujourd’hui`;
    $('#groqQuotaTokens').textContent = `${new Intl.NumberFormat('fr-FR').format(quota.used.tokensToday)} / ${new Intl.NumberFormat('fr-FR').format(quota.limits.tpd)} tokens aujourd’hui`;
    $('#groqQuotaMinute').textContent = `${quota.remaining.requestsThisMinute} requêtes restantes cette minute`;
    $('#groqQuotaState').textContent = quota.enabled ? 'Limiteur Free Tier actif' : 'Limiteur désactivé';
  }
  const aiNode = $('#aiSettingsState');
  aiNode.classList.toggle('ready', cfg.aiConfigured);
  aiNode.querySelector('strong').textContent = cfg.aiConfigured ? (cfg.bot?.autoReplyEnabled ? 'Groq connecté · bot actif' : 'Groq connecté · bot en pause') : 'Groq non configuré';
  const dbReady = cfg.storage === 'postgres';
  const dbNode = $('#databaseSettingsState');
  dbNode.classList.toggle('ready', dbReady);
  dbNode.querySelector('strong').textContent = dbReady ? 'PostgreSQL persistant connecté' : 'Stockage local temporaire';
  $('#storageModeLabel').textContent = dbReady ? 'PostgreSQL' : 'Fichier local';
  $('#sessionStorageLabel').textContent = dbReady ? 'PostgreSQL' : 'Mémoire (test local)';
  $('#webhookUrl').textContent = `${location.origin}${cfg.webhookPath}`;
  const webhookState = $('#webhookReadiness');
  if (webhookState) webhookState.textContent = wa.webhookConfigured ? 'Signature Meta + jeton de vérification détectés' : 'À compléter : App Secret et Verify Token';
}

async function refreshAll() {
  try { await loadData(); }
  catch (error) { toast(error.message); }
}

function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if ((char === ',' || char === ';' || char === '\t') && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
      row = []; cell = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());
  const findIndex = aliases => headers.findIndex(h => aliases.includes(h));
  const nameIndex = findIndex(['name', 'nom', 'fullname', 'full name', 'prenom', 'prénom']);
  const phoneIndex = findIndex(['phone', 'telephone', 'téléphone', 'mobile', 'numero', 'numéro', 'tel']);
  const consentIndex = findIndex(['optin', 'opt_in', 'consent', 'consentement', 'whatsapp_optin', 'autorisation']);
  return rows.map(r => ({
    name: r[nameIndex] || 'Contact sans nom',
    phone: r[phoneIndex] || '',
    optedIn: consentIndex >= 0 && /^(yes|oui|true|1|consent|confirmed|confirme|confirmé)$/i.test(r[consentIndex] || '')
  }));
}
function parseVcf(text) {
  text = String(text || '').replace(/\r?\n[ \t]/g, ''); // lignes vCard repliées
  const cards = text.split(/BEGIN:VCARD/i).slice(1);
  return cards.map(card => {
    const fn = card.match(/^FN(?:;[^:]*)?:(.*)$/im)?.[1]?.trim();
    const n = card.match(/^N(?:;[^:]*)?:(.*)$/im)?.[1]?.trim();
    const telLines = card.match(/^TEL(?:;[^:]*)?:(.*)$/gim) || [];
    const phone = telLines.map(line => line.slice(line.indexOf(':') + 1).trim()).find(Boolean) || '';
    const decodedName = (fn || n || 'Contact sans nom').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ');
    return { name: decodedName, phone, optedIn: false };
  }).filter(c => c.phone);
}

async function importContacts(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Fichier trop volumineux : limite de 2 Mo. Divise le fichier en plusieurs imports.');
  const text = await file.text();
  const contacts = /\.vcf$|\.vcard$/i.test(file.name) ? parseVcf(text) : parseCsv(text);
  if (!contacts.length) return toast('Aucun contact exploitable. Vérifie le format du fichier.');
  const confirmed = contacts.filter(c => c.optedIn).length;
  const result = await api('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) });
  await refreshAll();
  toast(`${result.added} ajoutés · ${result.updated} actualisés · ${result.skipped} ignorés. ${confirmed} consentements explicites importés.`);
}

function selectedContact() {
  return state.contacts.find(c => c.id === $('#messageContact').value);
}
function messageMode() {
  return $('input[name="messageMode"]:checked')?.value || 'text';
}
function updateRecipientHint() {
  const node = $('#recipientHint');
  if (!node) return;
  const contact = selectedContact();
  const mode = messageMode();
  if (!contact) { node.textContent = 'Choisis un contact pour vérifier les conditions d’envoi.'; return; }
  if (contact.blocked) { node.textContent = 'Envoi bloqué : ce contact a demandé l’arrêt ou a été bloqué.'; return; }
  const canReply = within24h(contact.lastInboundAt);
  if (mode === 'text') {
    node.textContent = canReply ? `Réponse possible : message entrant reçu le ${formatTime(contact.lastInboundAt)} (fenêtre de 24 h ouverte).` : 'Message libre indisponible : aucun message entrant dans les dernières 24 h. Utilise un modèle approuvé par Meta avec consentement explicite.';
  } else {
    node.textContent = contact.conversationStarted ? 'Nouvelle sollicitation bloquée : cette personne a déjà engagé une conversation.' : !contact.optedIn ? 'Consentement explicite manquant : le modèle ne peut pas être envoyé.' : contact.initialTemplateSentAt ? 'Une sollicitation a déjà été envoyée. Pas de deuxième message de campagne sans réponse.' : 'Modèle approuvé requis. Une seule sollicitation initiale est autorisée dans ce prototype.';
  }
}
function updateMessageMode() {
  const isText = messageMode() === 'text';
  $('#textModeFields').classList.toggle('hidden', !isText);
  $('#templateModeFields').classList.toggle('hidden', isText);
  $('#copyMessageBtn').classList.toggle('hidden', !isText);
  updateRecipientHint();
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  const contact = selectedContact();
  const mode = messageMode();
  const feedback = $('#sendFeedback');
  feedback.textContent = '';
  if (!contact) { feedback.textContent = 'Sélectionne un contact.'; return; }
  const payload = {
    contactId: contact.id,
    mode,
    approved: $('#sendApproval').checked,
    text: $('#messageText').value,
    templateName: $('#templateName').value.trim(),
    templateLanguage: $('#templateLanguage').value.trim() || 'fr'
  };
  if (!payload.approved) { feedback.textContent = 'Coche la confirmation de validation humaine.'; return; }
  const submit = $('#messageForm button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Envoi en cours…';
  try {
    const result = await api('/api/messages/send', { method: 'POST', body: JSON.stringify(payload) });
    feedback.style.color = '#2b9669';
    feedback.textContent = `Message accepté par Meta. Identifiant : ${result.messageId || 'non fourni'}`;
    $('#messageText').value = '';
    $('#charCount').textContent = '0 / 4096';
    $('#sendApproval').checked = false;
    await refreshAll();
  } catch (error) {
    feedback.style.color = '#c06c59';
    feedback.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Envoyer via WhatsApp Business <span>↗</span>';
    updateRecipientHint();
  }
}

async function copyMessageToClipboard() {
  const contact = selectedContact();
  const message = $('#messageText').value.trim();
  const feedback = $('#sendFeedback');
  feedback.textContent = '';
  if (!contact) { feedback.textContent = 'Sélectionne un contact.'; return; }
  if (contact.blocked || contact.stage === 'opt-out') {
    feedback.textContent = 'Copie bloquée : ce contact a demandé l’arrêt.';
    return;
  }
  if (!contact.optedIn && !within24h(contact.lastInboundAt)) {
    feedback.textContent = 'Pas de consentement enregistré ni de message entrant récent : ne prépare pas une sollicitation non demandée.';
    return;
  }
  if (!message) { feedback.textContent = 'Écris ou génère un brouillon avant de le copier.'; return; }
  try {
    await navigator.clipboard.writeText(message);
    feedback.style.color = '#2b9669';
    feedback.textContent = 'Texte copié. Ouvre WhatsApp et envoie-le manuellement après ta dernière vérification.';
  } catch {
    feedback.style.color = '#c06c59';
    feedback.textContent = 'Copie indisponible dans ce navigateur. Sélectionne le texte et copie-le manuellement.';
  }
}

async function generateDraft() {
  const contact = selectedContact();
  if (!contact) return toast('Choisis d’abord un destinataire.');
  const button = $('#generateDraftBtn');
  button.disabled = true;
  button.textContent = 'Génération…';
  try {
    const result = await api('/api/ai/draft', {
      method: 'POST',
      body: JSON.stringify({ contactName: contact.name, context: $('#draftContext').value.trim() || 'Aucun message entrant fourni ; ne suppose aucun lien personnel non vérifié.', goal: 'rédiger une réponse utile au contexte fourni, sans relance insistante', tone: 'amical, simple et naturel' })
    });
    $('#messageText').value = result.draft;
    $('#charCount').textContent = `${result.draft.length} / 4096`;
    toast('Brouillon IA généré. Relis-le avant tout envoi.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '✦ Générer'; }
}

async function handleContactAction(button) {
  const id = button.dataset.id;
  const contact = state.contacts.find(c => c.id === id);
  if (!contact) return;
  try {
    if (button.dataset.action === 'stop') {
      if (!confirm(`Bloquer ${contact.name} et retirer son autorisation ?`)) return;
      await api(`/api/contacts/${id}/stop`, { method: 'POST', body: '{}' });
      toast('Contact bloqué. Aucun nouvel envoi ne sera autorisé.');
    } else if (button.dataset.action === 'consent') {
      if (!confirm(`Confirmer que ${contact.name} a explicitement accepté de recevoir des messages WhatsApp ?`)) return;
      await api(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ optedIn: true, optInSource: 'Confirmation manuelle dans WA Orbit' }) });
      toast('Consentement enregistré.');
    } else if (button.dataset.action === 'revoke') {
      if (!confirm(`Retirer le consentement de ${contact.name} ?`)) return;
      await api(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ optedIn: false }) });
      toast('Consentement retiré.');
    }
    await refreshAll();
  } catch (error) { toast(error.message); }
}

function exportContacts() {
  const rows = [['name', 'phone', 'optedIn', 'stage', 'lastInboundAt']];
  state.contacts.forEach(c => rows.push([c.name, c.phone, c.optedIn ? 'yes' : 'no', c.stage || '', c.lastInboundAt || '']));
  const csvCell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'wa-orbit-contacts.csv'; link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.addEventListener('click', event => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { event.preventDefault(); showPage(pageButton.dataset.page); return; }
    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) { document.getElementById(closeButton.dataset.closeDialog)?.close(); return; }
    const threadButton = event.target.closest('[data-thread-id]');
    if (threadButton) {
      if (state.selectedConversationId !== threadButton.dataset.threadId) {
        state.selectedConversationId = threadButton.dataset.threadId;
        $('#conversationReplyText').value = '';
        $('#conversationApproval').checked = false;
        $('#conversationReplyFeedback').textContent = '';
        $('#conversationCharCount').textContent = '0 / 4096';
      }
      renderInbox();
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) handleContactAction(actionButton);
  });
  $('#conversationSearch').addEventListener('input', renderInbox);
  $('#conversationReplyForm').addEventListener('submit', handleConversationReply);
  $('#conversationReplyText').addEventListener('input', () => {
    $('#conversationCharCount').textContent = `${$('#conversationReplyText').value.length} / 4096`;
  });
  $('#contactSearch').addEventListener('input', renderContacts);
  $('#contactFilter').addEventListener('change', renderContacts);
  $('#addContactBtn').addEventListener('click', () => $('#contactDialog').showModal());
  $('#contactForm').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = { name: $('#newContactName').value.trim(), phone: $('#newContactPhone').value.trim(), optedIn: $('#newContactConsent').checked };
    try {
      await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
      $('#contactDialog').close();
      $('#contactForm').reset();
      await refreshAll();
      toast('Contact enregistré.');
    } catch (error) { toast(error.message); }
  });
  $('#importFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importContacts(file); }
    catch (error) { toast(error.message); }
    finally { event.target.value = ''; }
  });
  $('#exportContactsBtn').addEventListener('click', exportContacts);
  $('#messageContact').addEventListener('change', () => {
    updateRecipientHint();
    const contact = selectedContact();
    const latestIncoming = contact && state.events.find(e => e.kind === 'incoming' && String(e.phone || '').replace(/\D/g, '') === String(contact.phone || '').replace(/\D/g, ''));
    $('#draftContext').value = latestIncoming?.text || '';
  });
  $$('input[name="messageMode"]').forEach(input => input.addEventListener('change', updateMessageMode));
  $('#messageForm').addEventListener('submit', handleMessageSubmit);
  $('#copyMessageBtn').addEventListener('click', copyMessageToClipboard);
  $('#messageText').addEventListener('input', () => $('#charCount').textContent = `${$('#messageText').value.length} / 4096`);
  $('#generateDraftBtn').addEventListener('click', generateDraft);
  $('#groupModerationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#groupModerationForm button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await api('/api/groups/moderation', {
        method: 'POST',
        body: JSON.stringify(groupPolicyPayload())
      });
      state.groupModeration = { ...state.groupModeration, policy: response.policy };
      renderGroupModeration();
      toast('Règles de modération enregistrées.');
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  });
  $('#groupSimulationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const output = $('#groupSimulationResult');
    output.textContent = 'Analyse en cours…';
    try {
      const result = await api('/api/groups/moderation/simulate', {
        method: 'POST',
        body: JSON.stringify({
          text: $('#groupSimulationText').value,
          senderIsAdmin: $('#groupSimulationAdmin').checked
        })
      });
      output.textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      output.textContent = error.message;
    }
  });
  $('#refreshEventsBtn').addEventListener('click', refreshAll);
  $('#recheckConfigBtn').addEventListener('click', refreshAll);
  $('#refreshQuotaBtn').addEventListener('click', refreshAll);
  $('#copyWebhookBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#webhookUrl').textContent); toast('URL du webhook copiée.'); }
    catch { toast('Copie impossible sur ce navigateur.'); }
  });
  $('#aiHelpBtn').addEventListener('click', () => toast('Ajoute GROQ_API_KEY dans les variables Render (ou dans .env en local). Modèle : openai/gpt-oss-20b. BOT_AUTO_REPLY_ENABLED=true active les réponses automatiques.'));
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    $('#appShell').classList.add('hidden');
    document.body.classList.remove('logged-in');
    $('#loginScreen').classList.remove('hidden');
    $('#loginPassword').value = '';
  });
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('#loginError').textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#loginPassword').value }) });
      await enterApp();
    } catch (error) { $('#loginError').textContent = error.message; }
  });
}

async function enterApp() {
  try {
    await loadData();
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    document.body.classList.add('logged-in');
    showPage('overview');
  } catch (error) {
    if (error.status === 401) {
      $('#appShell').classList.add('hidden');
      document.body.classList.remove('logged-in');
      $('#loginScreen').classList.remove('hidden');
    } else toast(error.message);
  }
}

function setDynamicDate() {
  const node = $('.page-heading .eyebrow');
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  const overviewDate = $('#page-overview .page-heading .eyebrow');
  if (overviewDate) overviewDate.textContent = date.toLocaleUpperCase('fr-FR');
}

bindEvents();
setDynamicDate();
(async () => {
  try {
    const session = await api('/api/auth/me');
    if (session.authenticated) await enterApp();
    else { $('#loginScreen').classList.remove('hidden'); $('#appShell').classList.add('hidden'); }
  } catch { $('#loginScreen').classList.remove('hidden'); }
})();
