# WA Orbit — Cloudflare Worker

## Fonctionnalités de cette étape
- Webhook Meta vérifié par signature HMAC SHA-256 et stockage idempotent des messages/statuts.
- Contacts importables en JSON, avec normalisation et validation des numéros.
- Consentement explicite suivi par contact : `unknown`, `opted_in`, `opted_out`.
- Sélection quotidienne plafonnée à 5 contacts, uniquement avec consentement `opted_in`.
- Anti-doublon quotidien via `wa_daily_selections`.
- Cooldown de 30 jours après enregistrement d'un envoi, configurable côté base entre 1 et 365 jours.
- Exclusion des conversations actives de la sélection de nouvelles prises de contact.
- Opt-out immédiat, pause d'urgence persistante.
- API protégée par `ADMIN_API_TOKEN`.
- Personnalité configurable : motivateur enthousiaste, ingénieux, patient, paisible et accueillant.
- Profils relationnels par contact : type de relation, ton préféré, priorité, notes, sujets et date de suivi.
- Sélection quotidienne enrichie : priorise les suivis arrivés à échéance puis les relations prioritaires.

## API admin
Toutes les routes `/api/*` exigent `Authorization: Bearer <ADMIN_API_TOKEN>`.

- `GET /api/personality`
- `POST /api/personality` pour modifier le nom, rôle, ton, mission, valeurs et règles de style.
- `GET /api/safety`
- `POST /api/safety/pause` avec `{"paused":true}` ou `{"paused":false}`
- `GET /api/contacts`
- `POST /api/contacts/import` avec `{"contacts":[{"phone":"+2250700000000","name":"Nom"}]}`
- `GET /api/contacts/daily-selection`
- `POST /api/contacts/:id/action` avec `{"action":"opt_in","consent_source":"..."}`
- `GET /api/contacts/:id/profile`
- `POST /api/contacts/:id/profile` avec `relationship_type`, `preferred_tone`, `priority`, `notes`, `topics`, `follow_up_after_days` et `follow_up_due_at`
- Actions supplémentaires : `opt_out`, `sent`, `conversation_active`, `conversation_closed`.

## Règles anti-répétition
Un contact envoyé aujourd'hui est marqué comme contacté et reçoit une date `cooldown_until` à J+30. Il ne revient pas dans les sélections avant cette date. Les doublons du jour sont bloqués par clé primaire. Les contacts en conversation active sont écartés des nouvelles prises de contact. Les réponses entrantes du webhook actualisent l'interaction et placent la conversation en état actif.

## Important — limites d'envoi
Le Worker ne transmet pas lui-même les messages : il expose une file d'actions que le processus `connector/runner.js` consomme avec Meta Cloud API. Chaque action est validée par l'utilisateur puis recontrôlée côté serveur juste avant le transport. Le système reste en pause au démarrage. L'intégration doit respecter les règles Meta applicables : consentement, modèles approuvés lorsque requis hors fenêtre de service de 24 heures, opt-out et qualité du compte. Aucun mécanisme de contournement anti-spam n'est intégré.

## Déploiement
1. Créer/choisir la base D1 `wa-orbit-db`.
2. Remplacer `database_id` dans `wrangler.toml`.
3. Appliquer les migrations : `npx wrangler d1 migrations apply wa-orbit-db --remote`.
4. Définir les secrets :
   - `npx wrangler secret put WHATSAPP_APP_SECRET`
   - `npx wrangler secret put WHATSAPP_VERIFY_TOKEN`
   - `npx wrangler secret put ADMIN_API_TOKEN`
   - facultatif : `npx wrangler secret put GROQ_API_KEY` ; laisser `GROQ_DRAFTS_ENABLED = "false"` par défaut et ne l’activer qu’après avoir informé les personnes concernées du traitement externe.
   - facultatif : `WHATSAPP_TEMPLATE_NAME` et `WHATSAPP_TEMPLATE_LANGUAGE` via `wrangler secret put` pour les messages hors fenêtre de service ; configurer aussi `WHATSAPP_TEMPLATE_BODY_PARAMETER`/`WHATSAPP_TEMPLATE_COMPONENTS_JSON` selon le modèle exact.
5. Déployer : `npx wrangler deploy`.
6. Configurer le webhook Meta sur `https://<worker>/webhook`.

## Vérification
- `npm test`
- `node --check worker/src/index.js`
- `GET /health` doit répondre `status: ok` après migration et liaison D1.
- Tester l'authentification, l'import, le quota, le cooldown, l'opt-out et l'idempotence webhook.

Le texte du message entrant, les notes relationnelles et les thèmes peuvent être transmis à Groq uniquement lorsque GROQ_DRAFTS_ENABLED=true. Les quotas sont enregistrés dans D1. La génération ne déplace jamais un brouillon vers approved.

La migration Cloudflare ne remplace pas la base Supabase DIGIT+ déjà préparée. Cette branche utilise D1 pour que le Worker puisse fonctionner sans exposer de clé privilégiée dans le navigateur.


## Personnalité WA Orbit

Le moteur de personnalité ne sert pas à masquer une automatisation. Il définit la qualité du comportement : chaleureux, enthousiaste mais jamais insistant, patient, paisible, accueillant, curieux et capable d'adapter son ton au contexte du contact.

Principes :
1. Écouter et tenir compte du contexte avant de répondre.
2. Ne jamais inventer un souvenir, une information ou une proximité.
3. Favoriser des messages courts et humains.
4. Respecter le rythme et les préférences du contact.
5. Transformer une relance en conversation utile plutôt qu'en répétition.
6. Garder l'utilisateur aux commandes avec pause et opt-out.

## Vision produit

WA Orbit évolue vers un **agent personnel de relation** : il observe les interactions autorisées, mémorise le contexte utile, identifie les suivis pertinents, prépare une formulation adaptée et laisse l'utilisateur décider du niveau d'automatisation.

Baileys pourra être ajouté comme connecteur WhatsApp séparé. Le Worker Cloudflare reste le cerveau/API ; aucune promesse de compatibilité Baileys avec le runtime Workers n'est faite ici.

## Intelligence relationnelle

Cette version ajoute le cœur comportemental de WA Orbit :

- mémoire relationnelle persistante par contact ;
- profil d'intérêts pondéré par sujet ;
- moteur de décision des statuts : `ignore`, `view`, `react`, `reply`, `remember`, `continue` ;
- budget d'interaction et cooldown pour éviter les sollicitations répétitives ;
- génération de brouillons pour les suivis quotidiens, les statuts et les réponses entrantes ;
- validation humaine des brouillons avant envoi ;
- planification quotidienne Cloudflare à 08:00 UTC (08:00 Côte d'Ivoire) ;
- politique d'interaction configurable.

### API intelligence

- `GET /api/drafts`
- `POST /api/drafts/:id` avec `{"status":"approved"|"discarded","body":"..." }`
- `POST /api/drafts/:id/refine` pour demander une reformulation Groq d’un brouillon encore en attente.
- `POST /api/status-events` pour alimenter le moteur depuis un connecteur WhatsApp autorisé.
- `GET/POST /api/interaction-policy`
- `GET/POST /api/contacts/:id/interests`

### Format status-events

```json
{
  "statuses": [{
    "external_id": "status-123",
    "phone": "+2250700000000",
    "content_type": "text",
    "text": "Le contenu du statut"
  }]
}
```

Le moteur ne répond pas mécaniquement à chaque statut. Il évalue le sujet, les intérêts du contact, la relation, la fréquence récente et le budget social, puis choisit une action. Un connecteur WhatsApp séparé peut traduire `view`/ `react`/ `reply` en actions autorisées.

### Limite importante

L'API Cloud WhatsApp officielle ne fournit pas le contrôle complet des statuts personnels d'un compte WhatsApp classique. Pour cette partie, WA Orbit doit utiliser un connecteur autorisé et compatible avec le compte utilisé. Baileys peut servir de connecteur expérimental séparé, mais ne doit pas être utilisé pour contourner les protections anti-abus de WhatsApp.

Les brouillons sont volontairement séparés de l'envoi. L'architecture est donc :

`WhatsApp connector → perception → mémoire → décision → brouillon → validation → transport`

et non `status → réponse automatique systématique`.


### File d'actions sortantes

La validation d'un brouillon ne déclenche pas directement un envoi. Le Worker crée d'abord une action idempotente dans `wa_action_queue`.

- `POST /api/actions/claim` : réserve jusqu'à 5 actions et leur attribue un bail `processing`.
- `POST /api/actions/:id/authorize` : revalide pause, consentement et état de conversation immédiatement avant le transport.
- `POST /api/actions/:id/result` : enregistre `sent`, `failed`, `cancelled` ou `deferred`, le provider message id et l'audit.
- `GET /api/actions` : expose la file pour supervision.
- Les callbacks Meta mettent à jour les reçus `sent`, `delivered`, `read` et `failed`.
- Une clé `draft:<id>` empêche qu'un même brouillon soit réservé deux fois.
- Les erreurs sont retentables jusqu'à 5 tentatives ; le transport réel reste séparé du Worker.

Le connecteur ne doit jamais considérer une liste de brouillons comme une autorisation permanente : il revalide la sécurité juste avant le transport.


## Réception, mémoire et fiabilité

Les événements Meta sont vérifiés avec la signature HMAC SHA-256. Les messages entrants sont dédupliqués par identifiant fournisseur avant toute mise à jour de conversation ou création de brouillon : une nouvelle livraison du même webhook ne crée donc pas de deuxième brouillon. Un texte libre ne peut être autorisé que si le dernier message entrant date de moins de 24 heures ; en dehors de cette fenêtre, la réservation exige un modèle Meta configuré et approuvé. Sans modèle, le brouillon reste en attente. Pour les contacts autorisés, les thèmes détectés alimentent la mémoire de conversation et la mémoire relationnelle.

Les accusés Meta sont stockés dans `webhook_statuses` et rapprochés de `wa_action_queue.provider_message_id`. Les baux d'action abandonnés sont récupérés après 10 minutes ; les tentatives sont limitées à cinq avec temporisation exponentielle. Les erreurs définitives sont conservées dans la file et l'audit pour inspection.

La livraison côté connecteur est de type « au moins une fois » en cas de crash incertain après acceptation par le fournisseur. L'identifiant de brouillon rend la réservation interne idempotente, mais ne peut pas imposer une garantie exactly-once à un système externe.


## Génération IA facultative

Le Worker sait enrichir les brouillons avec Groq sans approuver ni envoyer le message. La fonctionnalité reste désactivée par défaut (GROQ_DRAFTS_ENABLED=false). Le quota de départ est de 30 générations par jour et 3 par contact et par heure ; les valeurs sont configurables dans wrangler.toml. Pour l’activer, fournir GROQ_API_KEY comme secret, puis définir GROQ_DRAFTS_ENABLED=true et éventuellement GROQ_MODEL. Le modèle par défaut est openai/gpt-oss-20b.

Lorsqu’elle est activée, le Worker transmet au fournisseur le texte nécessaire du message entrant ou du statut, ainsi que le contexte relationnel minimal, afin de rédiger une proposition. L’utilisateur doit vérifier et approuver le brouillon avant qu’il puisse rejoindre la file. N’active pas cette option sans tenir compte de la confidentialité, des obligations d’information et des autorisations applicables aux conversations traitées.
