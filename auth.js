import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { auth, db, functions } from "./firebase-init.js";

export let currentUser = null; // { uid, name, email, role, active }

const readyCallbacks = [];
export function onAuthReady(cb) { readyCallbacks.push(cb); }

let authErrorMessage = "";
export function lastAuthError() { return authErrorMessage; }

function friendlyAuthError(code) {
  return {
    "auth/invalid-email": "Adresse email invalide.",
    "auth/invalid-credential": "Identifiant ou mot de passe incorrect.",
    "auth/wrong-password": "Identifiant ou mot de passe incorrect.",
    "auth/user-not-found": "Identifiant ou mot de passe incorrect.",
    "auth/user-disabled": "Ce compte a été désactivé par l'administrateur.",
    "auth/too-many-requests": "Trop de tentatives, réessayez dans quelques minutes."
  }[code] || "Connexion impossible. Réessayez.";
}

export async function login(email, password) {
  authErrorMessage = "";
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return true;
  } catch (err) {
    authErrorMessage = friendlyAuthError(err.code);
    return false;
  }
}

export function logout() {
  return signOut(auth);
}

export async function bootstrapFirstAdmin(email, password, name) {
  authErrorMessage = "";
  const fn = httpsCallable(functions, "bootstrapFirstAdmin");
  try {
    await fn({ email: email.trim(), password, name: name.trim() });
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return true;
  } catch (err) {
    authErrorMessage = err.message || "Impossible de créer le compte administrateur.";
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    readyCallbacks.forEach(cb => cb(null));
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active === false) {
      authErrorMessage = "Ce compte n'est pas (ou plus) autorisé à accéder à l'application.";
      await signOut(auth);
      currentUser = null;
      readyCallbacks.forEach(cb => cb(null));
      return;
    }
    currentUser = { uid: user.uid, ...snap.data() };
    readyCallbacks.forEach(cb => cb(currentUser));
  } catch (err) {
    authErrorMessage = "Erreur de connexion au serveur. Réessayez.";
    await signOut(auth);
    currentUser = null;
    readyCallbacks.forEach(cb => cb(null));
  }
});
