# WA Orbit — WhatsApp Contact Hub

WA Orbit est une application monoposte de gestion de contacts et de conversations WhatsApp Business. Elle utilise un frontend HTML/CSS/JavaScript natif, un backend Node.js/Express, la WhatsApp Cloud API de Meta et Groq pour les réponses qui nécessitent une compréhension du langage.

## Fonctionnalités

- Tableau de bord responsive pour mobile et ordinateur.
- Carnet de contacts, import VCF/VCARD/CSV, recherche, filtres et export CSV.
- Consentement distinct de la simple présence d'un numéro dans un carnet.
- Réception des messages et statuts via webhook Meta signé.
- Réponses automatiques aux messages entrants lorsque le réglage est activé, avec plafond journalier (50) et plafond par contact/heure (3) configurables.
- Réponses locales aux commandes simples pour éviter des appels IA inutiles.
- Groq pour les demandes complexes, avec estimation des tokens, raisonnement réglé sur `low`, quota local persistant et compteur visible.
- Envoi manuel unitaire avec validation humaine, fenêtre de service de 24 h et modèles approuvés.
- Détection des demandes STOP / ARRÊT / UNSUBSCRIBE.
- Sessions persistantes PostgreSQL en déploiement, rate limits HTTP, cookies HttpOnly/SameSite, contrôle d'origine et Helmet.
- Arrêt d'urgence persistant, activé par défaut sur les nouvelles installations, qui bloque les envois sortants et les réponses automatiques jusqu'à reprise manuelle.

## Stack

- Node.js 20+
- Express 5
- PostgreSQL via `pg`
- Sessions via `express-session` + `connect-pg-simple`
- HTML / CSS / JavaScript natifs
- Meta WhatsApp Cloud API
- Groq Chat Completions (`openai/gpt-oss-20b` par défaut)

## Déploiement Cloudflare Workers (migration en cours)

Le projet comporte maintenant une première fondation Cloudflare dans `worker/` avec :
- un endpoint de santé `/health` ;
- la vérification Meta `GET /webhook` ;
- la réception sécurisée des webhooks `POST /webhook` avec validation HMAC SHA-256 ;
- le stockage idempotent des messages et statuts dans Cloudflare D1 ;
- le service des fichiers statiques via Workers Assets.

**Important : cette fondation n'est pas encore un déploiement complet de WA Orbit.** Les routes du tableau de bord `/api/*`, l'authentification, la gestion des contacts, les conversations, les contrôles de sécurité, l'envoi WhatsApp et Groq doivent encore être migrés. Tant que cette migration n'est pas terminée, le tableau de bord ne sera pas pleinement fonctionnel sur Cloudflare et les réponses automatiques restent désactivées.

Consulte [worker/README.md](worker/README.md) pour la préparation Cloudflare, D1, les secrets et le déploiement.

Le déploiement Render décrit dans l'historique reste une option Node.js/Express distincte ; il n'est pas nécessaire pour la voie Cloudflare.

## Limites de déploiement

Les offres gratuites des plateformes comportent des quotas et des limites susceptibles d'évoluer. Vérifie les quotas affichés dans ton compte Cloudflare avant la mise en production. Une disponibilité 24/7 et l'absence de coûts ne sont jamais garanties par un simple déploiement.

## Configuration locale

```bash
npm install
cp .env.example .env
npm start
```

En local, si `DATABASE_URL` est vide, l'application utilise `data/db.json`. En production avec `REQUIRE_DATABASE=true`, elle refuse de démarrer si PostgreSQL n'est pas configuré : cela évite de croire que les données seront conservées sur le disque éphémère Render.

Ouvre `http://127.0.0.1:3000` et connecte-toi avec `ADMIN_PASSWORD`.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `ADMIN_PASSWORD` | Mot de passe d'administration, 16 caractères minimum en production |
| `SESSION_SECRET` | Secret de signature des sessions, 32 caractères minimum en production |
| `DATABASE_URL` | URI PostgreSQL Supabase Session pooler |
| `REQUIRE_DATABASE` | Si `true`, interdit le stockage fichier en production |
| `WHATSAPP_ACCESS_TOKEN` | Token Meta, serveur uniquement |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro Business |
| `WHATSAPP_API_VERSION` | Version Graph API, au format `vNN.N` |
| `WHATSAPP_APP_SECRET` | Validation de signature des webhooks |
| `WHATSAPP_VERIFY_TOKEN` | Secret de validation initiale du webhook |
| `GROQ_API_KEY` | Clé d'API Groq, serveur uniquement |
| `GROQ_MODEL` | `openai/gpt-oss-20b` par défaut |
| `GROQ_FREE_TIER_MODE` | Active le limiteur local de quota |
| `BOT_AUTO_REPLY_ENABLED` | Active les réponses automatiques, désactivées par défaut |
| `BOT_MAX_AUTO_REPLIES_PER_DAY` | Plafond journalier de réponses automatiques (50 par défaut) |
| `BOT_MAX_REPLIES_PER_CONTACT_PER_HOUR` | Plafond par contact et par heure (3 par défaut) |
| `BOT_PERSONA` | Ton et comportement général du bot |
| `BOT_BUSINESS_CONTEXT` | Informations vérifiées sur l'activité |

Les secrets se configurent dans Render Environment ou dans `.env` en local. Ils ne doivent jamais se trouver dans `public/`.

## Limiteur Groq

Valeurs de départ : 25 requêtes/min, 900 requêtes/jour, 7 000 tokens/min et 180 000 tokens/jour. Elles sont volontairement sous les valeurs de base actuellement documentées par Groq pour `openai/gpt-oss-20b` en Free tier (30 RPM, 1 000 RPD, 8 000 TPM, 200 000 TPD). Les limites propres à ton organisation dans Groq Console sont la source de vérité. Le compteur de WA Orbit est conservé dans la base PostgreSQL, mais il ne peut pas comptabiliser les appels effectués à Groq par d'autres applications utilisant la même organisation. Pour GPT-OSS 20B, les limites internes de départ (25 RPM, 900 RPD, 7 000 TPM et 180 000 TPD) gardent une marge sous les plafonds Free publiés ; les limites exactes visibles dans la console de ton organisation priment.

## Règles de messagerie

- WA Orbit répond aux personnes qui écrivent au numéro Business connecté ; il ne synchronise pas la liste de contacts du WhatsApp personnel.
- Les messages libres sont réservés aux réponses dans la fenêtre de service de 24 heures ouverte par le message du client.
- Hors fenêtre, il faut un modèle approuvé par Meta et respecter le consentement requis.
- Les contacts importés sont non confirmés par défaut.
- STOP / ARRÊT / UNSUBSCRIBE bloque le contact.
- L'application ne cherche pas à contourner les filtres anti-spam ni à varier artificiellement les messages pour éviter une détection.

## Vérifications

```bash
npm install
npm run check
```

`npm run check` vérifie la syntaxe des fichiers JavaScript du serveur et du navigateur. Ce n'est pas un test de bout en bout : l'installation des dépendances, un vrai PostgreSQL Supabase, les secrets Meta/Groq et le webhook public sont nécessaires pour valider les appels externes.

## Références officielles

- Render Free services: <https://render.com/docs/free>
- Supabase PostgreSQL connection strings: <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase project pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>
- Meta WhatsApp Cloud API: <https://developers.facebook.com/docs/whatsapp/cloud-api/>
- Groq rate limits: <https://console.groq.com/docs/rate-limits>
- Groq supported models: <https://console.groq.com/docs/models>
