# WA Orbit WhatsApp Connector

Le connector est la couche transport séparée du cerveau Cloudflare.

## Contrat

Le connector doit :
1. recevoir les événements WhatsApp autorisés ;
2. les normaliser vers WA Orbit ;
3. récupérer les décisions/brouillons du Worker ;
4. demander une validation lorsque la politique l'exige ;
5. transmettre uniquement les actions autorisées ;
6. renvoyer le résultat au Worker.

## Sécurité

- jamais de contournement anti-spam ;
- pause globale respectée avant toute action sortante ;
- opt-out respecté ;
- quotas locaux + serveur ;
- logs d'action avec identifiant externe ;
- reconnexion contrôlée ;
- secrets uniquement côté serveur.

Le transport concret (Cloud API officielle ou connecteur expérimental compatible avec le compte utilisé) est volontairement découplé du moteur relationnel.
