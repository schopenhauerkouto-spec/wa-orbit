# WA Orbit — connecteur Baileys

Le connecteur Baileys est un **adaptateur séparé** pour un compte WhatsApp personnel/WhatsApp Web. Il ne remplace pas le transport Meta Cloud API officiel.

## Architecture

`WhatsApp Web/Baileys → connector/baileys-runner.js → API Express → politique de groupe`

- Le serveur Express reste la source de vérité pour la politique de modération et l'arrêt d'urgence.
- Baileys maintient une seule session persistante.
- Les événements de groupe sont analysés par `src/group-moderation-policy.js`.
- L'enforcement réel est doublement verrouillé : `BAILEYS_GROUP_ENFORCEMENT=true` **et** politique `enabled=true, mode=enforce`.
- Le bot ne tente une suppression que s'il est administrateur du groupe.
- Une pause globale bloque l'enforcement.
- Aucun mécanisme de contournement anti-détection, de rotation de messages ou d'envoi de masse n'est intégré.

## Authentification

Pour une première liaison, renseigner `BAILEYS_PAIRING_NUMBER` au format international sans `+`, puis lancer :

```bash
npm run connector:baileys
```

Le code d'appairage apparaît dans le terminal du runner. Après liaison, les credentials sont conservés dans `BAILEYS_AUTH_DIR`.

**Ne committe jamais ce dossier.** Les credentials et clés Signal sont des secrets de longue durée. La documentation Baileys recommande un stockage persistant et rappelle que le stockage fichier intégré est surtout adapté au développement/petits bots, pas à une architecture de production à grande échelle. citeturn384888search2

## Sécurité

1. Commencer avec `BAILEYS_GROUP_ENFORCEMENT=false`.
2. Laisser la politique en `observe`.
3. Tester les décisions dans le simulateur du dashboard.
4. Vérifier que le bot est administrateur du groupe de test.
5. Passer la politique en `enforce` puis activer `BAILEYS_GROUP_ENFORCEMENT=true` seulement après validation.
6. Tester immédiatement l'arrêt d'urgence.
7. Ne pas utiliser ce connecteur pour le spam, le messaging de masse ou la contournement des protections WhatsApp. Les mainteneurs de Baileys déconseillent explicitement ces usages. citeturn919692search0

## VM Google Cloud

La VM Free Tier `e2-micro` fournit 1 Go de RAM et 1 instance non préemptive éligible par mois dans `us-east1`, `us-central1` ou `us-west1`, avec 30 Go-mois de disque standard et 1 Go/mois de sortie depuis l'Amérique du Nord. Une facturation Cloud active reste nécessaire. citeturn324449search0

Pour WA Orbit, garder la VM minimale : un seul runner Baileys, Node.js, systemd, pas de Docker ni de base locale lourde.

## Variables

```env
ORBIT_API_URL=https://...
BAILEYS_CONNECTOR_TOKEN=...
BAILEYS_ENABLED=true
BAILEYS_AUTH_DIR=/opt/wa-orbit/data/baileys-auth
BAILEYS_PAIRING_NUMBER=2250...
BAILEYS_GROUP_ENFORCEMENT=false
BAILEYS_CONTROL_POLL_MS=30000
```

Le token doit être identique à `BAILEYS_CONNECTOR_TOKEN` du serveur Express et du runner.
