# WA Orbit — groupes et modération

## Objectif produit

WA Orbit doit proposer un centre de configuration par groupe : règles anti-liens, domaines autorisés/interdits, anti-flood, détection des répétitions, exemptions des administrateurs, seuils d'avertissements, journal de modération et pause d'urgence.

## État du code

La branche ajoute un moteur de règles **indépendant du transport**, une simulation administrateur et un adaptateur Baileys Node.js. Baileys est désactivé par défaut et ne peut passer en enforcement réel que lorsque les garde-fous du connecteur et de la politique sont explicitement activés. Ce moteur :

- extrait les domaines des liens ;
- vérifie les domaines autorisés et interdits sans accepter les faux suffixes ;
- détecte un volume excessif de messages d'un même expéditeur dans une fenêtre configurable ;
- détecte les répétitions normalisées ;
- permet d'exempter les administrateurs ;
- produit une décision et les capacités requises.

Le connecteur Baileys peut lire les messages des groupes auxquels le compte est connecté et, en mode enforcement, supprimer un message lorsque la règle le signale et que le bot est administrateur. Il n'effectue pas de sanction de membre ni d'expulsion. Le tableau de bord doit présenter explicitement cet état. Aucune action n'est annoncée comme active sans connecteur réel, groupe synchronisé, droits vérifiés et test de capacité réussi.

## Limites WhatsApp à respecter

- Les conditions WhatsApp interdisent certains usages automatisés/non autorisés, les clients non officiels et les messages automatiques ou en masse qui ne sont pas autorisés.
- La Groups API officielle est une voie distincte de l'application WhatsApp Messenger personnelle. Elle est réservée aux comptes Business éligibles et aux groupes créés via ce parcours ; elle ne transforme pas un groupe personnel existant en groupe administrable par Cloud API.
- La documentation de la Groups API indique des limites fonctionnelles, notamment l'absence de suppression des messages de groupe via cette API. Une règle anti-lien peut alors détecter et signaler, mais pas supprimer automatiquement le message via cette capacité.
- L'administration des membres (ex. retrait d'un participant) est une capacité différente et doit être réservée aux groupes/numéros qui y sont officiellement éligibles, après vérification des droits et avec des garde-fous explicites.

Avant d'activer un transport de groupe, vérifier la documentation Meta la plus récente et les capacités exactes du numéro.

Sources de référence :
- WhatsApp Terms of Service : https://www.whatsapp.com/legal/terms-of-service
- WhatsApp Messaging Guidelines : https://www.whatsapp.com/legal/messaging-guidelines
- Meta WhatsApp Groups API getting started : https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started/
- Group API feature/limitations overview (360dialog) : https://docs.360dialog.com/docs/messaging/groups

## Politique de sécurité

1. La modération est désactivée par défaut.
2. Le mode initial est observation/simulation.
3. Aucune sanction irréversible n'est activée par défaut.
4. Les administrateurs peuvent être exemptés des règles.
5. Les règles ne doivent jamais être utilisées pour cibler un membre en raison de caractéristiques protégées ou d'opinions.
6. Les changements de politique et les décisions devront être journalisés.
7. Les liens légitimes des domaines explicitement autorisés peuvent être laissés passer.
8. Une règle ne doit jamais prétendre avoir supprimé un message si le fournisseur n'a pas confirmé cette suppression.

## Prochaines étapes pour une modération réellement opérationnelle

1. Confirmer si le cas d'usage porte sur un groupe WhatsApp personnel existant ou sur un groupe créé via la Groups API Business officielle.
2. Pour la voie officielle, vérifier l'éligibilité OBA et les permissions Group API du numéro.
3. Implémenter uniquement les événements et actions documentés par Meta.
4. Ajouter un adaptateur de groupe avec un contrat de capacités explicite : réception, lecture des métadonnées, retrait de participant, suppression de message, etc.
5. Refuser toute action si la capacité n'est pas fournie ou si le compte n'est pas admin/autorisé.
6. Tester sur un groupe privé de test avant activation.

Ne pas ajouter un client non officiel ni de mécanisme anti-détection pour contourner les restrictions de la plateforme.


## Adaptateur Baileys

Le connecteur `connector/baileys.js` utilise la politique centrale, vérifie l'arrêt d'urgence et journalise les décisions. L'enforcement est volontairement doublement verrouillé :

- `BAILEYS_GROUP_ENFORCEMENT=true` côté runner ;
- politique de groupe `enabled=true` et `mode=enforce` côté dashboard ;
- bot administrateur du groupe ;
- arrêt d'urgence global non activé.

Les credentials Baileys ne doivent jamais être commités. Pour la production, le stockage d'authentification intégré est un compromis ; la documentation Baileys recommande un store durable personnalisé pour les déploiements sérieux.