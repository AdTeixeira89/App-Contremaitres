# Suivi Contremaîtres

Application interne de suivi des postes non travaillables, avec comptes utilisateurs
et base de données partagée (Firebase).

## Fonctionnalités

- Collage d'un SMS reçu, analyse automatique (poste, prestation, équipe, motif).
- Fiche modifiable, attribution automatique au contremaître de l'équipe.
- Statuts : À traiter, En cours, En attente, Traité, Classé sans action.
- Historique de toutes les actions, partagé entre tous les comptes.
- Tableau de bord avec statistiques par motif et par équipe.
- Réglages (contremaîtres, équipes, prestations, motifs) modifiables par l'administrateur.
- **Comptes utilisateurs avec rôles** : un compte Administrateur gère les accès
  (création, changement de rôle, désactivation, suppression) ; chaque contremaître a
  son propre compte email/mot de passe.
- **Données centralisées en temps réel** (Firestore) : plusieurs contremaîtres peuvent
  travailler simultanément, chacun voit les mises à jour des autres instantanément.
- **Photos jointes** aux actions/commentaires (prise de photo ou sélection depuis la
  galerie), conservées définitivement avec l'historique de la demande concernée.
- **Statistiques** des rejets par équipe, par zone (2 premiers chiffres du code GDO) et
  par motif, avec filtres combinables (période, équipe, zone, motif).
- **Réception automatique des SMS** : un téléphone dédié transfère chaque SMS reçu vers
  l'application, qui reconnaît le technicien concerné (même logique que l'analyse
  manuelle), crée la fiche automatiquement et notifie le bon contremaître.
- **Rendement** : domaine séparé des rejets, avec ses propres statuts, sa fenêtre
  d'action (commentaire + photo), son historique et ses statistiques (par CDT et par
  chantier). Un SMS titré « RENDEMENT » est reconnu automatiquement : chaque tâche
  chiffrée est pondérée par un barème de points modifiable dans Réglages, et une
  notification n'est envoyée au contremaître que si le score total tombe sous le seuil
  configuré — le rendement est toujours enregistré, alerte ou non, pour le suivi dans
  le temps.
- Installation possible comme application web sur téléphone (PWA).

## Architecture

- **Frontend** : HTML/CSS/JS natif (aucun framework, aucune étape de build), servi tel
  quel. Modules ES (`app.js`, `auth.js`, `firebase-init.js`).
- **Backend** : [Firebase](https://firebase.google.com)
  - **Authentication** : comptes email/mot de passe.
  - **Firestore** : base de données (`users`, `requests`, `yieldAlerts`, `history`,
    `settings`). `yieldAlerts` (rendement) reste entièrement séparée de `requests`
    (rejets), y compris dans l'historique (champ `kind`).
  - **Cloud Functions** (`functions/`) : gestion des comptes (création, rôle,
    activation/désactivation, suppression) ; `receiveSms` reçoit les SMS transférés par
    le téléphone dédié, distingue un SMS de rejet d'un SMS de rendement (titré
    « RENDEMENT »), reconnaît le technicien/l'équipe ou le CDT, crée la fiche
    correspondante et notifie le contremaître concerné.
  - **Firestore Security Rules** (`firestore.rules`) : appliquent les droits selon le
    rôle (`admin` / `contremaitre`) directement côté serveur.
  - **Firebase Storage** (`storage.rules`) : stockage des photos jointes aux actions,
    limité aux images de moins de 10 Mo.
  - **Firebase Cloud Messaging** : notifications push envoyées au contremaître concerné
    quand une demande lui est attribuée automatiquement par SMS.
- **Hébergement** : Firebase Hosting (ou tout hébergeur statique, puisque le frontend
  reste un site statique qui appelle l'API Firebase).

## Mise en place (une seule fois)

1. Créer un projet sur [console.firebase.google.com](https://console.firebase.google.com).
2. Activer **Authentication** > Fournisseur **Email/Mot de passe**.
3. Activer **Firestore Database** (mode production).
4. Passer au plan **Blaze** (paiement à l'usage) — nécessaire pour les Cloud Functions.
   Le coût reste quasi nul pour ce volume d'utilisation (4 contremaîtres).
5. Dans **Paramètres du projet > Général > Vos applications**, ajouter une application
   Web et copier la configuration dans `firebase-config.js` (remplacer les
   `REPLACE_ME`).
6. Remplacer `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` dans `.firebaserc` par l'ID du
   projet.
7. Installer l'outil Firebase CLI puis se connecter :
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
8. Déployer les règles, les fonctions et le site :
   ```bash
   cd functions && npm install && cd ..
   firebase deploy
   ```
9. Ouvrir le site déployé (URL affichée à la fin du déploiement), cliquer sur
   **« Premier démarrage : créer le compte administrateur »** et créer le tout premier
   compte. Cette action ne fonctionne qu'une seule fois : dès qu'un administrateur
   existe, elle se désactive automatiquement.
10. Se connecter avec ce compte administrateur, puis créer un compte pour chaque
    contremaître depuis **Réglages > Comptes utilisateurs**, et renseigner l'email de
    chacun sur sa fiche dans le panneau **Contremaîtres** (doit correspondre à l'email
    de son compte, sert à savoir où envoyer les notifications).

## Activer les notifications push (une seule fois)

1. Dans la console Firebase : **Paramètres du projet > Cloud Messaging** > onglet
   **Web configuration** > **« Generate key pair »** (si aucune clé n'existe déjà).
2. Copier la clé affichée dans `firebase-config.js`, à la place de `REPLACE_ME` pour
   `VAPID_KEY`.
3. Redéployer (`firebase deploy` ou push sur `main`).
4. Chaque contremaître clique ensuite sur **« Activer les notifications »** depuis
   Réglages, sur chacun de ses appareils.

## Configurer la réception automatique des SMS

1. Se connecter en tant qu'administrateur, aller dans **Réglages > SMS automatique**,
   cliquer sur **« Régénérer la clé »** pour générer la première clé secrète, puis noter
   l'URL du webhook et la clé affichées.
2. Sur le téléphone Android dédié qui recevra tous les SMS professionnels, installer une
   application capable de transférer chaque SMS reçu vers une adresse web (« webhook »)
   en HTTP POST. Deux options :
   - **Tasker** (payant, ~3,50 €, le plus fiable et documenté) : créer un profil
     déclenché par « Received Text », avec une action « HTTP Request » (POST) vers
     l'URL du webhook, en-tête `X-Webhook-Secret` avec la clé, corps JSON
     `{"text": "%SMSRB", "from": "%SMSRF"}`.
   - Une application gratuite de transfert de SMS vers webhook (chercher « SMS forwarder
     webhook » sur le Play Store) — vérifier qu'elle permet de définir un en-tête HTTP
     personnalisé pour la clé secrète.
3. Envoyer un SMS de test contenant un nom de technicien connu et un code GDO, vérifier
   qu'une fiche apparaît automatiquement dans **Demandes à traiter**.

Un SMS **titré « RENDEMENT »** (avec les lignes `CHANTIER:` et `CDT:`) est reconnu comme
un rendement plutôt qu'un rejet et suit le même webhook — voir **Réglages > Barème
rendement** pour définir les tâches, leurs points, et le seuil d'alerte avant de tester.

## Développement local

Comme le frontend utilise des modules ES (`import`/`export`), il ne peut pas être
ouvert directement en `file://`. Utiliser soit les émulateurs Firebase :

```bash
firebase emulators:start
```

soit un simple serveur local (dans ce cas les appels continueront de cibler le vrai
projet Firebase configuré dans `firebase-config.js`) :

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.
