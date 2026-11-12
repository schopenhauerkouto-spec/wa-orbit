# SCHOPENHAUER-WA — Relationship Engine

Le moteur transforme WA Orbit en assistant de relation conversationnelle. Il est volontairement indépendant du transport WhatsApp et de l'IA.

## Cycle

Message entrant -> mémoire -> intention -> score -> annulation des relances -> réponse ou handoff -> planification -> contrôle d'éligibilité -> génération -> safety check -> envoi -> journal.

## Règles non négociables

- optedIn doit être explicitement true pour toute prospection proactive.
- blocked=true interdit tout envoi.
- STOP, ARRÊT et UNSUBSCRIBE retirent immédiatement le consentement.
- Une réponse entrante annule le prochain follow-up.
- Une relance possède une échéance et une limite maximale.
- Les permissions d'envoi restent déterministes.
- L'IA ne reçoit jamais les secrets.
- Les logs ne contiennent pas de tokens.

## Scoring

0-20 froid, 21-45 faible, 46-65 intéressé, 66-80 chaud, 81-100 très chaud.

## Politique par défaut

1er suivi: 48 h; 2e: 5 jours; 3e: 10 jours; puis arrêt. Les valeurs restent configurables.

## Sécurité

Le moteur ne contourne aucune protection WhatsApp et ne sert pas à envoyer des messages non sollicités en masse.
