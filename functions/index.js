const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Doit correspondre à FUNCTIONS_REGION dans firebase-config.js.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const VALID_ROLES = ["admin", "contremaitre"];

async function assertAdmin(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "Connexion requise.");
  const snap = await db.collection("users").doc(auth.uid).get();
  const data = snap.data();
  if (!snap.exists || !data || data.role !== "admin" || data.active === false) {
    throw new HttpsError("permission-denied", "Réservé à l'administrateur.");
  }
}

// Premier démarrage uniquement : crée le tout premier compte administrateur.
// Se refuse dès qu'un utilisateur existe déjà dans Firestore.
exports.bootstrapFirstAdmin = onCall(async (request) => {
  const existing = await db.collection("users").limit(1).get();
  if (!existing.empty) {
    throw new HttpsError("failed-precondition", "Un administrateur existe déjà. Demandez-lui de créer votre accès.");
  }
  const { email, password, name } = request.data || {};
  if (!email || !password || !name) {
    throw new HttpsError("invalid-argument", "Email, mot de passe et nom sont requis.");
  }
  if (String(password).length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: name });
  } catch (err) {
    throw new HttpsError("already-exists", "Impossible de créer ce compte : " + err.message);
  }
  await admin.auth().setCustomUserClaims(userRecord.uid, { role: "admin" });
  await db.collection("users").doc(userRecord.uid).set({
    name, email, role: "admin", active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: userRecord.uid
  });
  return { ok: true, uid: userRecord.uid };
});

// Création d'un compte contremaître ou administrateur, réservée à l'administrateur.
exports.createUserAccount = onCall(async (request) => {
  await assertAdmin(request.auth);
  const { email, password, name, role } = request.data || {};
  if (!email || !password || !name) {
    throw new HttpsError("invalid-argument", "Email, mot de passe et nom sont requis.");
  }
  if (String(password).length < 6) {
    throw new HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères.");
  }
  const finalRole = VALID_ROLES.includes(role) ? role : "contremaitre";
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: name });
  } catch (err) {
    throw new HttpsError("already-exists", "Impossible de créer ce compte : " + err.message);
  }
  await admin.auth().setCustomUserClaims(userRecord.uid, { role: finalRole });
  await db.collection("users").doc(userRecord.uid).set({
    name, email, role: finalRole, active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid
  });
  return { ok: true, uid: userRecord.uid };
});

// Changement de rôle, réservé à l'administrateur.
exports.setUserRole = onCall(async (request) => {
  await assertAdmin(request.auth);
  const { uid, role } = request.data || {};
  if (!uid || !VALID_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Vous ne pouvez pas modifier votre propre rôle.");
  }
  await admin.auth().setCustomUserClaims(uid, { role });
  await db.collection("users").doc(uid).update({ role });
  return { ok: true };
});

// Activation / désactivation d'un compte, réservée à l'administrateur.
exports.setUserActive = onCall(async (request) => {
  await assertAdmin(request.auth);
  const { uid, active } = request.data || {};
  if (!uid || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "Paramètres invalides.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Vous ne pouvez pas désactiver votre propre compte.");
  }
  await admin.auth().updateUser(uid, { disabled: !active });
  await db.collection("users").doc(uid).update({ active });
  return { ok: true };
});

// Suppression définitive d'un compte, réservée à l'administrateur.
exports.deleteUserAccount = onCall(async (request) => {
  await assertAdmin(request.auth);
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "Identifiant requis.");
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Vous ne pouvez pas supprimer votre propre compte.");
  }
  await admin.auth().deleteUser(uid).catch(() => {});
  await db.collection("users").doc(uid).delete();
  return { ok: true };
});
