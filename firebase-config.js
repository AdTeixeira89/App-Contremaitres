/*
  Configuration du projet Firebase.
  1. Créer un projet sur https://console.firebase.google.com
  2. Activer Authentication (fournisseur Email/Mot de passe), Firestore et Functions
     (passer au plan Blaze, nécessaire pour les Cloud Functions).
  3. Dans Paramètres du projet > Général > Vos applications, ajouter une application Web
     et copier ici les valeurs affichées (elles ne sont pas secrètes : c'est la config
     publique du client, la sécurité réelle est assurée par les règles Firestore et
     les Cloud Functions, pas par ce fichier).
*/
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Région utilisée pour les Cloud Functions (doit correspondre à functions/index.js).
export const FUNCTIONS_REGION = "europe-west1";
