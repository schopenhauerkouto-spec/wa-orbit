# WA Orbit WhatsApp Connector

Le connector est le processus de transport séparé du cerveau Cloudflare Worker.

## Démarrage local ou Render Background Worker

Le processus poll la file sécurisée du Worker, demande une autorisation fraîche pour chaque action, transmet uniquement les actions autorisées à Meta Cloud API, puis enregistre le résultat.

Variables d'environnement requises :

- `ORBIT_API_URL` : URL publique du Cloudflare Worker, sans slash final.
- `ADMIN_API_TOKEN` : même secret que le Worker.
- `WHATSAPP_ACCESS_TOKEN` : jeton d'accès Meta à conserver côté serveur.
- `WHATSAPP_PHONE_NUMBER_ID` : identifiant du numéro WhatsApp Business.
- `WHATSAPP_API_VERSION` : version Graph API, facultative (défaut du code : `v23.0`).
- `ORBIT_BATCH_SIZE` : 1 à 5, défaut 5.
- `ORBIT_MIN_DELAY_MS` : délai entre deux transmissions, défaut 30000.
- `ORBIT_POLL_INTERVAL_MS` : intervalle entre les cycles, défaut 60000.

Commande : `npm run connector:worker`

Pour Render, déployer ce composant comme **Background Worker** distinct du service web. Ne pas placer les secrets Meta dans le code frontend ni dans une variable publique.

## Contrat d'exécution

1. Le Worker réserve des actions validées et crée un bail `processing`.
2. Le connector revalide immédiatement la pause d'urgence, le consentement et l'état de conversation.
3. Si la pause est activée, l'action est replacée en file sans consommer une tentative.
4. Si le consentement n'est plus valide ou si la conversation est devenue active, l'action est annulée.
5. Le connector transmet à Meta Cloud API puis renvoie l'identifiant fournisseur.
6. Les webhooks Meta actualisent les reçus `sent`, `delivered`, `read` ou `failed`.

Le Worker récupère les baux `processing` abandonnés après 10 minutes. Les tentatives sont limitées à cinq, avec temporisation exponentielle. Les actions terminées ou en échec définitif restent consultables dans l'audit.

## Webhooks

Configurer l'URL `https://<worker>/webhook` dans le tableau de bord Meta et abonner l'application au champ WhatsApp `messages`. Le Worker vérifie `X-Hub-Signature-256`, déduplique les identifiants de messages et enregistre les accusés de livraison. Le connector n'a pas besoin de recevoir directement les callbacks Meta.

## Sécurité et limites

- aucune technique de contournement anti-spam ou anti-détection ;
- pause globale persistante, consentement explicite et opt-out ;
- quota de cinq envois par jour au maximum ;
- contrôle d'autorisation côté serveur juste avant l'envoi ;
- identifiants, tokens et secrets uniquement côté serveur ;
- les logs n'affichent ni contenu des messages, ni numéros des contacts.

**Important :** la file garantit l'unicité d'une action interne, mais aucun système distribué ne peut garantir un envoi externe strictement « exactly once » si le processus tombe après l'acceptation par Meta et avant la confirmation au Worker. Les reçus Meta permettent de réconcilier l'état du message quand le webhook arrive.

Meta Cloud API est destinée aux numéros WhatsApp Business et ne donne pas accès aux statuts personnels d'un compte WhatsApp classique. L'ingestion de statuts personnels nécessite un connecteur distinct, autorisé et compatible avec le compte utilisé ; aucune promesse de compatibilité n'est faite ici.

Aucun envoi réel n'a été effectué avec ce dépôt tant que les secrets Meta, la base D1, le webhook et le service Background Worker ne sont pas configurés.
