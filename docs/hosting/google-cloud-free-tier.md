# Hébergement WA Orbit — Google Cloud Free Tier

## Décision

Oracle Cloud est écarté pour ce projet en raison des blocages déjà rencontrés. L'alternative vérifiée est **Google Cloud Compute Engine e2-micro Free Tier**. C'est le seul candidat réaliste identifié ici pour une petite VM Linux persistante sans frais mensuels dans les quotas annoncés.

Source officielle : https://docs.cloud.google.com/free/docs/free-cloud-features

## Quotas gratuits vérifiés le 4 novembre 2026

- Une VM non préemptible `e2-micro` par mois.
- Régions éligibles uniquement : `us-west1` (Oregon), `us-central1` (Iowa), `us-east1` (Caroline du Sud).
- Jusqu'à 30 Go-mois de disque persistant standard.
- 1 Go/mois de trafic sortant depuis l'Amérique du Nord (hors Chine et Australie).
- L'offre Free Tier n'a pas de date d'expiration annoncée, mais Google peut modifier les limites avec préavis.
- Une facturation Cloud active est obligatoire. Les dépassements d'une facturation payante sont facturés.

## Ce que cela signifie pour WA Orbit

Le quota est adapté uniquement à un **runner Node.js léger**, pas à une stack complète. La VM e2-micro ne dispose que d'environ 1 Go de RAM. Elle ne doit pas héberger simultanément un modèle IA local, une base PostgreSQL, plusieurs services lourds ou des conteneurs inutiles.

Architecture cible :

```text
Dashboard / frontend  -> Cloudflare Pages (après raccordement)
API + données         -> Cloudflare Worker + D1 (source de vérité)
Runner persistant    -> Google Compute Engine e2-micro
Transport autorisé   -> WhatsApp Business Platform
IA                   -> fournisseur distant, désactivé par défaut
```

**État actuel du dépôt :** le dashboard Express et le Worker/D1 ne sont pas encore entièrement raccordés. Ne déploie pas le runner en production avant d'avoir terminé cette intégration et vérifié les parcours de bout en bout. Le runner actuel attend déjà une file d'actions alimentée par le Worker ; le dashboard Express ne pilote pas encore l'ensemble de cette API.

## Précautions de facturation

Google exige un compte Cloud Billing actif même pour les ressources Free Tier. Le budget et les alertes sont utiles, mais une alerte de budget ne bloque pas automatiquement les dépenses.

Avant de créer la VM :

1. Vérifier que le compte affiche explicitement l'éligibilité Free Tier pour Compute Engine.
2. Choisir uniquement `e2-micro` dans l'une des trois régions éligibles.
3. Ne pas ajouter de GPU, disque supplémentaire, IP statique, snapshot payant, load balancer ou ressource hors quota.
4. Ne pas passer le compte en facturation payante sans comprendre les coûts possibles.
5. Configurer des alertes à 50 %, 90 % et 100 % du budget, en sachant qu'elles ne constituent pas un plafond dur.
6. Vérifier chaque mois l'utilisation du disque et du trafic sortant.

La gratuité dépend du respect effectif des quotas et des conditions du compte. Elle ne constitue ni un SLA, ni une garantie d'absence de panne, ni une garantie que Google conservera les limites actuelles à vie.

## Préparation de l'instance (ne pas exécuter avant validation de la facturation)

Région suggérée : `us-east1` pour rester dans le quota Free Tier. La latence réelle depuis la Côte d'Ivoire doit être mesurée après création.

Configuration visée :

- Debian stable, image officielle.
- Machine : `e2-micro`.
- Disque de démarrage : disque persistant standard, 30 Go maximum dans le quota global.
- Process manager : `systemd` (pas PM2 + systemd en double).
- Pas de Docker dans cette VM minimale.
- Node.js LTS compatible avec `package.json`.
- Compte système dédié non-root.
- Fichier d'environnement hors dépôt, permissions `0600`.
- Pare-feu : SSH restreint, HTTP/HTTPS uniquement si un service web est exposé.
- Logs limités et rotation configurée.
- Redémarrage automatique du runner après crash et au démarrage.

## Contrôles avant mise en ligne

- [ ] Frontend raccordé à une seule API source de vérité.
- [ ] D1 migrations appliquées et sauvegarde/export testé.
- [ ] Secrets configurés uniquement dans le gestionnaire de secrets ou variables du serveur.
- [ ] Service Node exécuté sous utilisateur non-root.
- [ ] Unité systemd testée après reboot.
- [ ] Health check externe et alertes de disponibilité.
- [ ] Arrêt d'urgence testé.
- [ ] Idempotence et reprise après crash testées.
- [ ] Dépenses réseau et quotas vérifiés.
- [ ] Tests de bout en bout sur environnement et numéros de test autorisés.

## Pourquoi pas Render ou Koyeb Free ?

- Render Free s'arrête après 15 minutes sans trafic entrant et possède un système de fichiers éphémère.
- Koyeb Free fournit 512 Mo de RAM et se met à l'échelle zéro après une heure sans trafic ; il ne permet pas de volumes persistants.
- Ces services sont utiles pour des prototypes web, pas comme base fiable d'un connecteur qui doit maintenir un processus à long terme.

Sources officielles :
- Google Free Tier : https://docs.cloud.google.com/free/docs/free-cloud-features
- Google Cloud Billing : https://docs.cloud.google.com/billing/docs
- Google budgets : https://docs.cloud.google.com/billing/docs/how-to/budgets
- Render Free : https://render.com/docs/free
- Koyeb instances : https://www.koyeb.com/docs/reference/instances
