# WA Orbit — connecteur WhatsApp Baileys

Le connector est le processus de transport séparé du cerveau Cloudflare Worker.

## Architecture

`WhatsApp personnel → Baileys → Connector → Cloudflare Worker → D1`

- **Baileys** = transport WhatsApp : connexion, session, réception, envoi et reçus.
- **Worker/D1** = cerveau : contacts, consentement, mémoire, sélection quotidienne, brouillons, autorisation, quota, pause d'urgence.
- **Le connector ne décide jamais seul d'envoyer** : chaque action est revalidée par le Worker juste avant le transport.

Baileys est une bibliothèque non officielle qui se connecte comme client WhatsApp Web. Elle ne nécessite donc pas Meta WhatsApp Cloud API pour envoyer les messages avec ce connecteur. Elle reste toutefois soumise aux conditions et contrôles de WhatsApp ; ce projet n'implémente aucun contournement anti-spam ou anti-détection.

## Configuration

Variables :

- `ORBIT_API_URL` : URL publique du Worker.
- `ADMIN_API_TOKEN` : même secret que le Worker.
- `BAILEYS_PHONE_NUMBER` : numéro E.164 en chiffres uniquement pour le code de jumelage. Laisser vide pour utiliser le QR.
- `BAILEYS_AUTH_DIR` : répertoire persistant de session.
- `ORBIT_BATCH_SIZE` : 1 à 5, défaut 5.
- `ORBIT_MIN_DELAY_MS` : délai local entre deux transports, défaut 30000.
- `ORBIT_POLL_INTERVAL_MS` : intervalle entre les cycles, défaut 60000.

Commande : `npm run connector:worker`

### Render

Déployer le connector comme **Background Worker** séparé. Si la plateforme utilise un disque éphémère, ne pas y laisser la session Baileys en production : la session doit être conservée sur un stockage persistant ou via un vrai store d'authentification adapté.

Le dossier d'authentification contient des secrets de session WhatsApp. Il ne doit jamais être commité, envoyé au frontend ou exposé dans les logs.

## Première connexion

1. Lancer le connector.
2. Si `BAILEYS_PHONE_NUMBER` est renseigné, le connector demande un code de jumelage lorsque Baileys le permet.
3. Sinon, un QR est affiché dans le terminal.
4. Associer le compte depuis WhatsApp.
5. Les identifiants sont ensuite sauvegardés dans `BAILEYS_AUTH_DIR`.

La documentation Baileys déconseille `useMultiFileAuthState` pour la production ; cette implémentation l'utilise pour amorcer le connector. Une prochaine étape de durcissement doit remplacer ce stockage fichier par un store d'authentification persistant chiffré/DB.

## Événements

Le connector transmet au Worker :

- les messages entrants via `/api/connector/inbound` ;
- les reçus `sent/delivered/read/failed` via `/api/connector/receipts`.

Les deux routes utilisent le même `ADMIN_API_TOKEN` que les autres routes internes. Les messages entrants sont dédupliqués par leur identifiant Baileys.

Les messages `messages.upsert` portant un `requestId` sont ignorés afin de réduire le risque lié aux événements d'historique/rejeu documenté par Baileys.

## Contrat d'exécution

1. Le Worker réserve les actions validées et crée un bail `processing`.
2. Le connector revalide immédiatement pause, consentement et état de conversation.
3. Une pause replace l'action en file sans consommer une tentative.
4. Un consentement invalide ou une autorisation expirée annule l'action.
5. Baileys transporte le message et retourne son identifiant.
6. Les événements Baileys réconcilient les reçus.

Le Worker récupère les baux `processing` abandonnés après 10 minutes. Les échecs sont retentés jusqu'à cinq fois avec backoff ; les échecs définitifs restent dans l'audit.

## Statuts personnels

Baileys peut fournir des événements liés à un compte WhatsApp personnel, mais l'ingestion de **statuts WhatsApp personnels** doit être traitée comme une capacité séparée et testée sur la version Baileys réellement déployée. Aucun support de statut n'est considéré comme garanti simplement parce que Baileys est installé.

## Sécurité

- aucune technique de contournement anti-spam ou anti-détection ;
- pause globale persistante ;
- consentement explicite et opt-out ;
- quota quotidien côté Worker ;
- autorisation serveur juste avant l'envoi ;
- token interne uniquement côté serveur ;
- session Baileys hors Git et hors frontend ;
- déduplication des événements entrants ;
- monotonie des reçus pour éviter de régresser `read` vers `sent`.

**Important :** aucun envoi réel n'est effectué par le dépôt tant que le Worker/D1 et le connector Baileys ne sont pas réellement configurés et lancés.
