# WA Orbit — connexion distante, sécurité et feuille de route

> Statut : spécification de mise en œuvre. Ce document ne prétend pas qu'un appareil WhatsApp est déjà appairé ni qu'un serveur est déjà déployé.

## Décision d'architecture

WA Orbit conserve son transport WhatsApp Business Cloud API existant comme voie de production. Le dépôt actuel est une application Node.js/Express conçue autour des webhooks Meta et de l'API Graph. Un QR de type WhatsApp Web n'est pas un simple composant d'interface : il exige un client lié, une bibliothèque de protocole et la conservation d'une session sensible. Les bibliothèques non officielles peuvent être déconnectées et leur usage peut contrevenir aux conditions WhatsApp.

En conséquence, cette branche prépare l'interface et les contrôles de sécurité, mais n'ajoute ni client WhatsApp Web non officiel, ni automatisation de messages privés en masse, ni mécanisme destiné à contourner les systèmes anti-spam. Le QR ne doit jamais être présenté comme connecté tant qu'un adaptateur autorisé et réellement opérationnel n'a pas confirmé l'état.

## Les étapes à mener en parallèle

### 1. Interface de connexion

- Afficher les états explicites : non configuré, en attente, connecté, déconnecté, erreur.
- Le QR éventuel est éphémère, affiché uniquement dans une session administrateur authentifiée, et jamais journalisé.
- Ne jamais stocker une image QR, un code d'appairage ou un secret de session dans le navigateur, les logs ou une URL.
- Ajouter une action de révocation/déconnexion et afficher la date de dernière vérification.
- Tant qu'aucun adaptateur réel n'est disponible, afficher « Connexion QR non activée » plutôt qu'un faux QR.

### 2. Sessions et secrets

- Stocker les secrets exclusivement côté serveur, chiffrés au repos avec une clé de chiffrement fournie par variable d'environnement / gestionnaire de secrets.
- Ne jamais réutiliser SESSION_SECRET comme clé de chiffrement.
- Restreindre l'accès aux sessions à un compte de service et au seul processus qui en a besoin.
- Prévoir rotation de clé, révocation, suppression complète de session et sauvegardes protégées.
- Ne jamais exposer de données de session via une route API, même à l'administrateur.

### 3. Moteur de conformité et consentement

- L'import d'un numéro ne vaut jamais consentement.
- Aucun message sortant sans preuve de consentement enregistrée, finalité claire et possibilité de retrait.
- STOP, ARRÊT, UNSUBSCRIBE et demandes équivalentes déclenchent immédiatement la suppression de l'éligibilité.
- Les contacts désinscrits ou bloqués sont exclus de toutes les files de travail.
- Les messages initiés par une entreprise suivent les règles Meta applicables, notamment les modèles approuvés et la fenêtre de service.
- L'IA peut signaler une demande ambiguë, proposer un brouillon ou recommander une pause ; elle ne peut pas certifier qu'un message ne sera pas signalé ou qu'un compte ne sera pas restreint.
- Une validation humaine reste requise pour les nouveaux contacts et les messages initiés par l'administrateur.

### 4. Garde-fous opérationnels

- Arrêt d'urgence global et pause par contact.
- File d'envoi désactivée par défaut.
- Déduplication des événements et idempotence des actions.
- Journal d'audit minimisé : qui a autorisé quoi, quand, sur quelle base de consentement ; pas de QR ni de secrets.
- Détection d'anomalies pour suspendre les actions en cas d'erreur, de hausse des refus, de désinscriptions ou de réponses négatives.
- Les limites de débit servent à protéger le service et les destinataires ; elles ne doivent pas être utilisées pour masquer une activité interdite ou contourner une détection.

### 5. Hébergement distant

- Déployer le serveur Express sur un service Node.js compatible.
- Utiliser PostgreSQL externe pour les contacts, événements, preuves de consentement et sessions applicatives.
- Utiliser un gestionnaire de secrets pour les clés Meta, Groq, base de données et chiffrement.
- Exiger HTTPS, cookies Secure/HttpOnly/SameSite, authentification forte, contrôle d'origine et sauvegardes.
- Le téléphone sert à ouvrir le tableau de bord et, si un jour un parcours d'appairage autorisé est disponible, à effectuer l'action demandée par WhatsApp. Il n'héberge pas le processus serveur.
- Un hébergement gratuit qui dort ou perd son disque n'est pas adapté à une disponibilité permanente ; vérifier les limites du fournisseur avant mise en production.

### 6. Tests de validation

- Tests unitaires du consentement, de STOP, des listes de suppression, de l'arrêt d'urgence et des permissions.
- Tests d'intégration avec PostgreSQL et webhooks Meta signés.
- Tests de sécurité : accès non authentifié, fuite de secrets, CSRF/origine, XSS, session fixation, révocation.
- Test mobile réel sur le Galaxy A06 pour le tableau de bord.
- Test de bout en bout uniquement avec un numéro de test / environnement autorisé et des destinataires ayant explicitement accepté.
- Un résultat « tests réussis » doit correspondre à une exécution réelle des commandes et non à une simple revue de code.

## Conditions de mise en service

- [ ] Variables de production générées et stockées hors Git.
- [ ] PostgreSQL persistant configuré et sauvegarde vérifiée.
- [ ] HTTPS et domaine de production actifs.
- [ ] Consentement explicite vérifié avant tout envoi.
- [ ] STOP testé de bout en bout.
- [ ] Auto-réponse désactivée jusqu'à validation.
- [ ] Arrêt d'urgence testé.
- [ ] Webhook Meta signé testé avec un événement réel de test.
- [ ] Aucun secret ou QR dans les logs.
- [ ] Déploiement et tests externes vérifiés.

## Ce qui n'est pas encore fait

La création de cette spécification ne déploie pas l'application, ne crée pas de session WhatsApp, ne génère pas de QR réel, ne connecte pas Groq/Meta et ne réalise pas de test sur un navigateur ou un téléphone. Ces opérations nécessitent l'accès au fournisseur d'hébergement, à la base de données, aux secrets et à un environnement de test autorisé.
