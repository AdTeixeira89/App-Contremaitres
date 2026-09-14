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
  apiKey: "AIzaSyDODhl5m2ncZHHODOFanIFWS86vYlq1vdU",
  authDomain: "app-cm-ff5a4.firebaseapp.com",
  projectId: "app-cm-ff5a4",
  storageBucket: "app-cm-ff5a4.firebasestorage.app",
  messagingSenderId: "603145790876",
  appId: "1:603145790876:web:abd2924d94d8eebdd4d459"
};

// Région utilisée pour les Cloud Functions (doit correspondre à functions/index.js).
export const FUNCTIONS_REGION = "europe-west1";
