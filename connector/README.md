# WA Orbit — connecteur WhatsApp officiel

Le connector est un processus de transport séparé du cerveau Cloudflare Worker. Il utilise exclusivement la **WhatsApp Business Platform officielle de Meta**.

## Architecture

`WhatsApp Business Platform → Meta Cloud API → Connector → Cloudflare Worker → D1`

- **Meta Cloud API** = transport officiel réservé à un numéro WhatsApp Business configuré.
- **Worker/D1** = cerveau : contacts, consentement, mémoire relationnelle, brouillons, autorisation, quota et pause d'urgence.
- **Dashboard** = validation humaine des brouillons avant qu'ils soient placés dans la file d'envoi.

## Limite importante pour un compte personnel

Ce connector ne connecte pas un compte WhatsApp Messenger personnel. Baileys est un client non officiel ; WhatsApp interdit l'utilisation de clients non officiels et les messages automatisés ou en masse dans ses règles de messagerie. WA Orbit ne fournit donc ni QR de connexion personnel, ni scraping de statuts personnels, ni envoi automatique via Baileys.

Pour un compte personnel, WA Orbit peut rester un **assistant de préparation** : tu ajoutes le contexte, l'IA rédige une proposition, tu la relis et tu la copies toi-même dans WhatsApp. Aucun message ne part du compte personnel depuis le serveur.

## Configuration Meta officielle

Variables :

- `ORBIT_API_URL` : URL publique du Cloudflare Worker.
- `ADMIN_API_TOKEN` : même secret que le Worker.
- `WHATSAPP_ACCESS_TOKEN` : jeton serveur Meta.
- `WHATSAPP_PHONE_NUMBER_ID` : identifiant du numéro WhatsApp Business.
- `WHATSAPP_API_VERSION` : version Graph API, défaut `v26.0`.
- `ORBIT_BATCH_SIZE` : 1 à 5, défaut 5.
- `ORBIT_MIN_DELAY_MS` : intervalle local entre deux actions ; ce n'est pas un mécanisme de contournement des limites.
- `ORBIT_POLL_INTERVAL_MS` : intervalle entre les cycles.

Commande : `npm run connector:worker`

Déployer ce composant comme **Background Worker** distinct du service web. Les secrets restent côté serveur ; ne jamais les intégrer au frontend ou au dépôt.

## Règles d'envoi

1. Le contact doit avoir explicitement accepté les communications.
2. Un brouillon doit être relu et approuvé dans WA Orbit.
3. Le Worker revalide pause d'urgence, consentement et fenêtre de service juste avant le transport.
4. Dans la fenêtre de service de 24 heures, les réponses libres sont possibles selon la politique WhatsApp Business.
5. En dehors de cette fenêtre, l'envoi exige un modèle Meta approuvé adapté au motif du message.
6. Un opt-out annule les actions encore en file et bloque les prochains envois.
7. Le Worker réserve la capacité quotidienne et empêche la double réservation d'une même action.

Ne pas utiliser ce système pour prospecter des personnes qui n'ont pas demandé à être contactées, importer des listes achetées, envoyer des messages automatiques à froid ou contourner les limites de WhatsApp.

## Webhooks

Configurer l'URL `https://<worker>/webhook` dans Meta et abonner l'application aux événements WhatsApp nécessaires. Le Worker vérifie la signature `X-Hub-Signature-256`, déduplique les identifiants entrants et met à jour les accusés de livraison.

## Fiabilité et limites

- Les baux `processing` abandonnés sont récupérés après 10 minutes.
- Les échecs sont retentés jusqu'à cinq fois avec un backoff exponentiel.
- Les échecs définitifs sont conservés dans l'audit.
- Les reçus `sent/delivered/read/failed` ne doivent pas régresser vers un état antérieur.
- Aucun système distribué ne peut promettre un envoi externe « exactly once » si le processus tombe après acceptation par le fournisseur et avant la confirmation locale.

**Aucun envoi réel n'a été effectué** tant que les secrets Meta, la base D1, le webhook et le Background Worker ne sont pas configurés et testés.
