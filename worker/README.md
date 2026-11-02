# WA Orbit sur Cloudflare Workers — fondation

Cette première étape ajoute un Worker pour les routes de santé et le webhook Meta, ainsi qu'un schéma D1 idempotent pour les messages entrants et statuts.

## Ce qui fonctionne dans cette fondation
- `GET /health` vérifie la liaison D1.
- `GET /webhook` effectue le challenge de vérification Meta.
- `POST /webhook` vérifie obligatoirement la signature HMAC SHA-256 Meta avant de parser le JSON.
- Les messages entrants sont enregistrés dans D1 avec `message_id` comme clé primaire (les doublons sont ignorés).
- Les statuts de livraison sont enregistrés et actualisés.
- Les fichiers statiques du dossier `public/` sont servis par le binding Assets.

## Ce qui n'est PAS encore migré
Les routes `/api/*` du tableau de bord, l'authentification admin, les sessions, les contacts, les imports, les conversations, l'arrêt d'urgence, l'envoi WhatsApp et l'intégration Groq ne sont pas encore portés vers Workers/D1. Ces routes répondent volontairement `501` afin de ne pas laisser croire que le tableau de bord est opérationnel alors que son API ne l'est pas.

Le frontend actuel dépend de ces routes : le site ne doit donc pas être présenté comme prêt à l'utilisation après ce seul déploiement.

## Préparation Cloudflare
1. Créer une base D1 nommée `wa-orbit-db`.
2. Remplacer `database_id` dans `wrangler.toml` par l'identifiant fourni par Cloudflare.
3. Installer Wrangler localement : `npm install -D wrangler`.
4. Appliquer le schéma : `npx wrangler d1 migrations apply wa-orbit-db --remote`.
5. Définir les secrets via Wrangler (jamais dans Git) :
   - `npx wrangler secret put WHATSAPP_APP_SECRET`
   - `npx wrangler secret put WHATSAPP_VERIFY_TOKEN`
6. Déployer : `npx wrangler deploy`.
7. Configurer le webhook Meta vers `https://<nom-du-worker>.<compte>.workers.dev/webhook`.

## Tests
- `node --check worker/src/index.js`
- Vérifier `/health` après liaison D1.
- Tester le challenge Meta.
- Vérifier le rejet d'une signature absente/incorrecte.
- Envoyer deux fois le même événement et confirmer l'idempotence dans D1.

Ne jamais activer les réponses automatiques avant migration complète des règles de consentement, du STOP, de la fenêtre 24 h, des plafonds et de l'arrêt d'urgence.
