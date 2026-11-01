# Configuration rapide — WA Orbit (Render + Supabase + Groq)

## 1. Préparer les services gratuits

WA Orbit utilise un serveur Render et une base PostgreSQL externe. Le système de fichiers d'un Web Service Render Free est éphémère : les contacts, conversations, sessions et compteurs doivent donc être conservés dans PostgreSQL. Le PostgreSQL Free de Render expire après 30 jours ; on utilise donc Supabase pour le stockage externe.

1. Crée un projet Supabase Free : <https://supabase.com/dashboard>.
2. Dans le projet, ouvre **Connect** puis choisis **Session pooler** (IPv4, port 5432). Copie l'URI PostgreSQL et remplace `[YOUR-PASSWORD]` par le mot de passe de ta base. Ne partage pas cette URI.
3. Crée un dépôt GitHub avec le contenu du projet, sans `.env`.
4. Dans Render, sélectionne **New → Blueprint** et connecte le dépôt. Le fichier `render.yaml` configure le service et son plan Free.
5. Dans les variables d'environnement Render, renseigne `DATABASE_URL`, `ADMIN_PASSWORD`, puis tes valeurs Meta et Groq. `SESSION_SECRET` est généré par Render.

**Important :** le projet Supabase Free peut être mis en pause après une semaine d'activité insuffisante. Quelques requêtes réelles par jour contribuent à maintenir le projet actif, sans garantie absolue. Le projet conserve les données pendant une pause, mais le bot ne peut pas répondre tant que la base n’est pas réactivée. Vérifie les notifications Supabase et réactive le projet depuis son tableau de bord si nécessaire.

## 2. Variables Render essentielles

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` (déjà dans render.yaml) |
| `HOST` | `0.0.0.0` (déjà dans render.yaml) |
| `REQUIRE_DATABASE` | `true` (déjà dans render.yaml) |
| `DATABASE_URL` | URI Supabase **Session pooler** |
| `ADMIN_PASSWORD` | mot de passe unique d'au moins 16 caractères |
| `SESSION_SECRET` | généré automatiquement par Render |

Ne configure pas `DATABASE_URL` avec l'URI Direct si elle exige IPv6 : Render doit utiliser l'URI **Session pooler IPv4** fournie par Supabase.

## 3. Variables Meta

Dans Meta for Developers → ton application → WhatsApp → API Setup, récupère :

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID` (pas le numéro visible)
- `WHATSAPP_API_VERSION` (version Graph API actuellement supportée, format `vNN.N`)
- `WHATSAPP_APP_SECRET` (App settings → Basic → App Secret)
- `WHATSAPP_VERIFY_TOKEN` (secret personnel inventé par toi)

L'App Secret est nécessaire pour vérifier la signature des webhooks en production. Ne publie aucun de ces secrets.

## 4. Variables Groq

Crée une clé sur <https://console.groq.com/keys> puis renseigne :

```env
GROQ_API_KEY=ta_cle_groq
GROQ_MODEL=openai/gpt-oss-20b
GROQ_MAX_OUTPUT_TOKENS=160
GROQ_FREE_TIER_MODE=true
GROQ_FREE_RPM=25
GROQ_FREE_RPD=900
GROQ_FREE_TPM=7000
GROQ_FREE_TPD=180000
```

Le bot utilise `max_completion_tokens`, `reasoning_effort=low` et masque le champ de raisonnement pour limiter la génération superflue. Les limites internes sont volontairement plus basses que les plafonds Free publiés pour GPT-OSS 20B (30 RPM, 1 000 RPD, 8 000 TPM, 200 000 TPD). Les limites affichées dans la page **Limits** de ton organisation Groq priment toujours : elles peuvent varier selon le compte et évoluer.

Les compteurs de WA Orbit sont sauvegardés dans PostgreSQL et survivent aux redémarrages. Ils mesurent les appels effectués par cette application uniquement ; les appels Groq provenant d'autres applications utilisant la même organisation ne sont pas inclus.

## 5. Activer les réponses automatiques

Garde `BOT_AUTO_REPLY_ENABLED=false` au début. Après le déploiement, ouvre l'URL Render et connecte-toi avec `ADMIN_PASSWORD`. Vérifie les paramètres WhatsApp et Groq.

Dans Meta → Webhooks :

1. Callback URL : `https://TON-SERVICE.onrender.com/webhook`.
2. Verify token : la valeur exacte de `WHATSAPP_VERIFY_TOKEN`.
3. Abonne le produit WhatsApp aux événements `messages`.
4. Vérifie que `WHATSAPP_APP_SECRET` est renseigné dans Render.

Envoie ensuite un message de test à ton numéro Business. Lorsque le message apparaît dans l'Inbox, passe `BOT_AUTO_REPLY_ENABLED` à `true` dans Render puis redéploie le service.

## 6. Ce que le bot fait et ne fait pas

- Il répond aux messages entrants sur le numéro Business connecté.
- Les salutations, remerciements et commandes simples passent par des règles locales, sans appel Groq.
- Les demandes complexes passent par Groq, dans les limites configurées.
- Plafonds par défaut : 50 réponses automatiques par jour et 3 réponses par contact par heure, configurables dans Render.
- Un message STOP / ARRÊT / UNSUBSCRIBE bloque les réponses automatiques pour ce contact.
- Un message libre n'est envoyé qu'à l'intérieur de la fenêtre de service de 24 h. Hors fenêtre, un modèle WhatsApp approuvé et le consentement requis sont nécessaires.
- Un contact importé n'est pas considéré comme ayant donné son consentement.
- L'API ne lit pas la liste privée de contacts d'un WhatsApp personnel ni les vues de statuts.

## 7. Limites importantes du plan Render Free

Render Free met les Web Services en veille après 15 minutes sans trafic entrant, puis le réveil peut prendre environ une minute. Le système de fichiers local est temporaire et les instances gratuites peuvent redémarrer. Le PostgreSQL gratuit de Render expire après 30 jours ; c'est pourquoi le projet utilise une base Supabase externe. PostgreSQL protège les données, mais le réveil à froid peut retarder ou faire expirer un webhook Meta. Ce plan convient pour apprendre et tester, pas pour garantir une réception WhatsApp 24 h/24. Ne base pas une activité critique sur cette configuration gratuite.

## 8. Lancer en local (facultatif)

```bash
npm install
cp .env.example .env
npm start
```

En local, `DATABASE_URL` peut rester vide : WA Orbit utilise `data/db.json`. Ce mode fichier n'est pas adapté à Render Free.
