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
- Installation possible comme application web sur téléphone (PWA).

## Architecture

- **Frontend** : HTML/CSS/JS natif (aucun framework, aucune étape de build), servi tel
  quel. Modules ES (`app.js`, `auth.js`, `firebase-init.js`).
- **Backend** : [Firebase](https://firebase.google.com)
  - **Authentication** : comptes email/mot de passe.
  - **Firestore** : base de données (`users`, `requests`, `history`, `settings`).
  - **Cloud Functions** (`functions/`) : gestion des comptes (création, rôle,
    activation/désactivation, suppression), exécutée côté serveur pour que ces
    opérations ne puissent jamais être faites depuis le navigateur.
  - **Firestore Security Rules** (`firestore.rules`) : appliquent les droits selon le
    rôle (`admin` / `contremaitre`) directement côté serveur.
- **Hébergement** : Firebase Hosting (ou tout hébergeur statique, puisque le frontend
  reste un site statique qui appelle l'API Firebase).

Prochaines étapes prévues : photos jointes aux actions/commentaires (Firebase
Storage), statistiques filtrables multi-critères, réception automatique des SMS via un
téléphone relais et routage automatique par préfixe de code GDO.

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
    contremaître depuis **Réglages > Comptes utilisateurs**.

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
