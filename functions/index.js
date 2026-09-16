const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Doit correspondre à FUNCTIONS_REGION dans firebase-config.js.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const VALID_ROLES = ["admin", "contremaitre"];

// Seul ce compte peut supprimer un autre compte administrateur. Codé en dur
// (pas dans un réglage modifiable par l'application) pour qu'aucun admin ne
// puisse s'attribuer ce statut lui-même.
const SUPER_ADMIN_EMAIL = "adam.teixeira89@gmail.com";

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
// Supprimer un autre compte administrateur est réservé au super admin.
exports.deleteUserAccount = onCall(async (request) => {
  await assertAdmin(request.auth);
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "Identifiant requis.");
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Vous ne pouvez pas supprimer votre propre compte.");
  }
  const targetSnap = await db.collection("users").doc(uid).get();
  if (targetSnap.exists && targetSnap.data().role === "admin" && request.auth.token.email !== SUPER_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Seul le compte administrateur principal peut supprimer un autre administrateur.");
  }
  await admin.auth().deleteUser(uid).catch(() => {});
  await db.collection("users").doc(uid).delete();
  return { ok: true };
});

/* ------------------------------------------------------------------------ */
/* Réception automatique des SMS                                            */
/* ------------------------------------------------------------------------ */

function normalize(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// Même logique que l'analyse manuelle côté client (app.js: analyzeMessage),
// mais sans repli sur la première équipe/prestation de la liste : si rien
// n'est reconnu de façon fiable, la demande reste non attribuée plutôt que
// d'être associée au mauvais contremaître.
function parseSms(raw, settings) {
  const n = normalize(raw);
  const posteMatch = raw.match(/\b\d{5}P\d{3,5}\b/i) || raw.match(/\b[A-Z0-9]{8,14}\b/i);
  const poste = posteMatch ? posteMatch[0] : "";
  const prestation = (settings.prestations || []).find(p => n.includes(normalize(p))) || "";
  const team = (settings.teams || []).find(t => {
    const names = (t.technicians || "").split(",").map(x => normalize(x.trim()));
    return names.some(name => name && name.split(" ").some(part => part.length > 1 && n.includes(part))) || n.includes(normalize(t.name));
  });
  let motif = (settings.reasons || []).find(r => n.includes(normalize(r)));
  if (!motif) {
    if (n.includes("PORTE") && n.includes("BLOQU")) motif = "Porte de cabine bloquée";
    else if (n.includes("PROPRIETE") && n.includes("FERM")) motif = "Propriété fermée";
    else if (n.includes("NON TROUV")) motif = "Poste non trouvé";
    else if (n.includes("PAS D'ACCES") || n.includes("PAS D ACCES")) motif = "Accès impossible";
    else motif = "Autre";
  }
  return { poste, prestation, motif, team };
}

// Analyse d'un SMS de rendement : chantier, CDT, tâches chiffrées et score
// pondéré par les points définis dans settings/rendement.
function parseRendement(raw, rendementSettings, generalSettings) {
  const n = normalize(raw);
  const chantierMatch = raw.match(/CHANTIER\s*:\s*(\S+)/i);
  const chantier = chantierMatch ? chantierMatch[1].trim() : "";
  const cdtMatch = raw.match(/CDT\s*:\s*([^\n\r]+)/i);
  const cdt = cdtMatch ? cdtMatch[1].trim() : "";
  const cdtNorm = normalize(cdt);
  const team = (generalSettings.teams || []).find(t => {
    const names = (t.technicians || "").split(",").map(x => normalize(x.trim()));
    return names.some(name => name && name.split(" ").some(part => part.length > 1 && cdtNorm.includes(part))) || cdtNorm.includes(normalize(t.name));
  });
  const tasks = rendementSettings.tasks || [];
  const values = {};
  tasks.forEach(task => {
    const labelNorm = normalize(task.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(labelNorm + "\\s*:\\s*(\\d+(?:[.,]\\d+)?)", "i");
    const m = n.match(re);
    values[task.id] = m ? parseFloat(m[1].replace(",", ".")) : 0;
  });
  const score = tasks.reduce((sum, t) => sum + (values[t.id] || 0) * (Number(t.points) || 0), 0);
  return { chantier, cdt, team, values, score };
}

async function notifyCountermaster(cmName, settings, requestSummary) {
  const cm = (settings.countermasters || []).find(c => c.name === cmName);
  if (!cm || !cm.email) return { notified: false, reason: "email non configuré" };
  const usersSnap = await db.collection("users").where("email", "==", cm.email).limit(1).get();
  if (usersSnap.empty) return { notified: false, reason: "aucun compte lié" };
  const uid = usersSnap.docs[0].id;
  const tokensSnap = await db.collection("users").doc(uid).collection("deviceTokens").get();
  const tokens = tokensSnap.docs.map(d => d.id);
  if (!tokens.length) return { notified: false, reason: "aucun appareil enregistré" };
  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: "Nouvelle demande", body: requestSummary }
  });
  return { notified: true, successCount: response.successCount, failureCount: response.failureCount };
}

// Point d'entrée pour l'application de transfert de SMS installée sur le
// téléphone dédié. Sécurisé par une clé secrète (settings/sms.webhookSecret,
// régénérable par l'administrateur depuis Réglages), pas par une session
// utilisateur puisque l'appelant n'est pas un utilisateur de l'application.
exports.receiveSms = onRequest({ invoker: "public" }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Méthode non autorisée, utilisez POST." });
      return;
    }

    const providedSecret = req.get("X-Webhook-Secret") || req.body?.secret || req.query?.secret;
    const smsConfig = (await db.collection("settings").doc("sms").get()).data();
    if (!smsConfig?.webhookSecret || providedSecret !== smsConfig.webhookSecret) {
      res.status(401).json({ error: "Clé secrète invalide ou manquante." });
      return;
    }

    const body = req.body;
    const raw = (typeof body === "string" ? body : (body?.text || body?.message || "")).toString().trim();
    if (!raw) {
      res.status(400).json({ error: "Message vide ou mal formaté." });
      return;
    }
    const from = (typeof body === "object" && body?.from) || null;

    const isRendement = normalize(raw).includes("RENDEMENT");
    const targetCollection = isRendement ? "yieldAlerts" : "requests";

    const smsHash = crypto.createHash("sha256").update(raw).digest("hex");
    const dupSnap = await db.collection(targetCollection).where("smsHash", "==", smsHash).limit(1).get();
    if (!dupSnap.empty) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const settingsSnap = await db.collection("settings").doc("general").get();
    if (!settingsSnap.exists) {
      res.status(500).json({ error: "Réglages de l'application non initialisés." });
      return;
    }
    const settings = settingsSnap.data();

    if (isRendement) {
      const rendementSnap = await db.collection("settings").doc("rendement").get();
      const rendementSettings = rendementSnap.exists ? rendementSnap.data() : { tasks: [], threshold: 0 };
      const { chantier, cdt, team, values, score } = parseRendement(raw, rendementSettings, settings);
      const threshold = typeof rendementSettings.threshold === "number" ? rendementSettings.threshold : 0;
      const belowThreshold = score < threshold;

      const alertData = {
        chantier, cdt, equipe: team?.name || "", cm: team?.cm || "",
        tasks: values, score, threshold, belowThreshold,
        status: "À traiter", date: new Date().toISOString(),
        action: "", original: raw, treatedBy: "", treatedAt: "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: null, createdByName: "SMS automatique",
        smsHash, smsFrom: from
      };
      const ref = await db.collection("yieldAlerts").add(alertData);
      await db.collection("history").add({
        kind: "yield", yieldAlertId: ref.id,
        text: team
          ? `Rendement ${chantier || "—"}/${cdt || "—"} créé automatiquement par SMS, attribué à ${team.cm}`
          : `Rendement ${chantier || "—"}/${cdt || "—"} créé automatiquement par SMS, non attribué (CDT non reconnu)`,
        user: "Système (SMS)", userId: null,
        date: admin.firestore.FieldValue.serverTimestamp()
      });

      let notifyResult = { notified: false };
      if (belowThreshold && team?.cm) {
        try {
          notifyResult = await notifyCountermaster(
            team.cm, settings,
            `Rendement en alerte — chantier ${chantier || "?"}, CDT ${cdt || "?"} (score ${score}/${threshold})`
          );
        } catch (err) {
          logger.error("Échec d'envoi de la notification push (rendement)", err);
        }
      }

      res.status(200).json({ ok: true, yieldAlertId: ref.id, attributed: !!team, belowThreshold, notified: notifyResult.notified });
      return;
    }

    const { poste, prestation, motif, team } = parseSms(raw, settings);

    const requestData = {
      poste, commune: "", prestation,
      equipe: team?.name || "", cm: team?.cm || "",
      motif, status: "À traiter",
      date: new Date().toISOString(),
      action: "", original: raw,
      treatedBy: "", treatedAt: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: null, createdByName: "SMS automatique",
      smsHash, smsFrom: from
    };
    const ref = await db.collection("requests").add(requestData);
    await db.collection("history").add({
      requestId: ref.id,
      text: team ? `Demande ${poste || "(sans code)"} créée automatiquement par SMS, attribuée à ${team.cm}`
                  : `Demande ${poste || "(sans code)"} créée automatiquement par SMS, non attribuée (technicien non reconnu)`,
      user: "Système (SMS)", userId: null,
      date: admin.firestore.FieldValue.serverTimestamp()
    });

    let notifyResult = { notified: false };
    if (team?.cm) {
      try {
        notifyResult = await notifyCountermaster(team.cm, settings, `${poste || "Poste"} — ${motif}`);
      } catch (err) {
        logger.error("Échec d'envoi de la notification push", err);
      }
    }

    res.status(200).json({ ok: true, requestId: ref.id, attributed: !!team, notified: notifyResult.notified });
  } catch (err) {
    logger.error("Erreur receiveSms", err);
    res.status(500).json({ error: "Erreur interne du serveur." });
  }
});
