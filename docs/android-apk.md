# Application Android WA Orbit

WA Orbit fournit une application Android légère qui affiche le tableau de bord hébergé sur ton serveur. Le connecteur Baileys reste un processus Node.js côté serveur/VM : il ne tourne pas dans l'APK et ne stocke pas les identifiants WhatsApp sur le téléphone.

## Première ouverture

1. Installe l'APK sur Android.
2. Au premier lancement, colle l'URL HTTPS racine de ton service (par exemple `https://ton-service.onrender.com`).
3. Appuie sur **Connecter WA Orbit**, puis connecte-toi avec ton mot de passe administrateur.
4. L'adresse du serveur est mémorisée. Les cookies de session et le stockage web sont gérés par Android WebView.

Le bouton **Serveur** dans la barre supérieure permet de changer l'adresse. L'application n'accepte que les URL HTTPS racine : pas de chemin `/api`, pas de paramètres et pas de contenu HTTP non chiffré.

## Fonctionnalités Android prises en charge

- Navigation dans le tableau de bord responsive.
- Sessions et stockage local WebView persistants.
- Sélecteur de fichiers pour importer un carnet CSV/VCF.
- Téléchargement de fichiers vers le dossier Téléchargements Android.
- Bouton natif de changement de serveur.
- Navigation retour Android.
- Refus des certificats HTTPS invalides et du contenu mixte HTTP/HTTPS.

L'application ne contient aucune clé Meta/Groq, aucun mot de passe admin et aucune session Baileys.

## Génération automatique

Le workflow GitHub Actions `.github/workflows/android-apk.yml` construit un APK debug sur chaque push qui modifie `android/`, ou depuis l'onglet **Actions** avec **Run workflow**.

Après un build vert :

1. Ouvre le run **WA Orbit Android APK**.
2. Dans **Artifacts**, télécharge `WA-Orbit-Android-APK`.
3. Décompresse l'archive et installe `app-debug.apk` sur Android.

L'APK debug est signée avec la clé temporaire de la machine GitHub. Pour les mises à jour, désinstalle d'abord l'ancienne version debug avant d'installer une nouvelle APK si Android signale une signature différente. Une clé de signature de production persistante devra être créée et conservée séparément avant une distribution publique.

## PWA

Le site hébergé expose aussi un manifeste et un service worker réseau uniquement. Depuis Chrome Android, ouvre l'URL HTTPS du serveur, puis utilise **Installer l'application** ou **Ajouter à l'écran d'accueil**. Aucune route API ni donnée privée n'est mise en cache par le service worker.
