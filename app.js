import {
  collection, doc, addDoc, setDoc, updateDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import {
  getMessaging, isSupported as messagingIsSupported, getToken
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { db, functions, storage, firebaseApp } from "./firebase-init.js";
import { VAPID_KEY, firebaseConfig, FUNCTIONS_REGION } from "./firebase-config.js";
import { currentUser, onAuthReady, login, logout, bootstrapFirstAdmin, resetPassword, lastAuthError } from "./auth.js";

const DEFAULT_SETTINGS = {
  countermasters: [
    { id: crypto.randomUUID(), name: "CM 1", email: "", notifications: true },
    { id: crypto.randomUUID(), name: "CM 2", email: "", notifications: true },
    { id: crypto.randomUUID(), name: "CM 3", email: "", notifications: true },
    { id: crypto.randomUUID(), name: "CM 4", email: "", notifications: true }
  ],
  teams: [
    { id: crypto.randomUUID(), name: "MESQUITA / FERREIRA", technicians: "Fernando MESQUITA, FERREIRA", cm: "CM 1" },
    { id: crypto.randomUUID(), name: "PASTOR / ÉQUIPE", technicians: "Miguel PASTOR", cm: "CM 2" }
  ],
  prestations: ["AMELIO", "MESURES"],
  reasons: [
    "Propriété fermée", "Porte de cabine bloquée", "Poste non trouvé",
    "Accès impossible", "Refus du propriétaire", "Végétation",
    "Poste supprimé", "Mauvaise adresse", "Problème de clé", "Autre"
  ]
};

let state = { countermasters: [], teams: [], prestations: [], reasons: [], requests: [], history: [], users: [], sms: null };
let settingsLoaded = false;
let unsubscribers = [];

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
function nowLocalInput() {
  const d = new Date();
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function normalize(s=""){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();}
function statusClass(status) {
  return {"À traiter":"todo","En cours":"progress","En attente":"waiting","Traité":"done","Classé sans action":"archived"}[status] || "archived";
}
function fmtDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d);
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));}

/* ---------------------------------------------------------------------- */
/* Connexion / session                                                    */
/* ---------------------------------------------------------------------- */

const loginScreen = document.getElementById("loginScreen");
const appShell = document.querySelector(".app-shell");

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmit");
  btn.disabled = true;
  const ok = await login(email, password);
  btn.disabled = false;
  document.getElementById("loginError").textContent = ok ? "" : lastAuthError();
});

document.getElementById("showBootstrap").addEventListener("click", () => {
  document.getElementById("loginPanel").hidden = true;
  document.getElementById("bootstrapPanel").hidden = false;
});
document.getElementById("cancelBootstrap").addEventListener("click", () => {
  document.getElementById("bootstrapPanel").hidden = true;
  document.getElementById("loginPanel").hidden = false;
});
document.getElementById("bootstrapForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("bootstrapName").value;
  const email = document.getElementById("bootstrapEmail").value;
  const password = document.getElementById("bootstrapPassword").value;
  const btn = document.getElementById("bootstrapSubmit");
  btn.disabled = true;
  const ok = await bootstrapFirstAdmin(email, password, name);
  btn.disabled = false;
  document.getElementById("bootstrapError").textContent = ok ? "" : lastAuthError();
});

document.getElementById("showReset").addEventListener("click", () => {
  document.getElementById("loginPanel").hidden = true;
  document.getElementById("resetPanel").hidden = false;
});
document.getElementById("cancelReset").addEventListener("click", () => {
  document.getElementById("resetPanel").hidden = true;
  document.getElementById("loginPanel").hidden = false;
  document.getElementById("resetForm").reset();
  document.getElementById("resetError").textContent = "";
  document.getElementById("resetSuccess").textContent = "";
});
document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("resetEmail").value;
  const btn = document.getElementById("resetSubmit");
  btn.disabled = true;
  const ok = await resetPassword(email);
  btn.disabled = false;
  document.getElementById("resetError").textContent = ok ? "" : lastAuthError();
  document.getElementById("resetSuccess").textContent = ok ? "Email envoyé. Vérifiez votre boîte de réception (et vos indésirables)." : "";
});

document.getElementById("logoutBtn").addEventListener("click", () => logout());

onAuthReady((user) => {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  if (!user) {
    settingsLoaded = false;
    loginScreen.style.display = "flex";
    appShell.style.display = "none";
    document.getElementById("loginForm").reset();
    document.getElementById("bootstrapForm").reset();
    document.getElementById("resetForm").reset();
    document.getElementById("bootstrapPanel").hidden = true;
    document.getElementById("resetPanel").hidden = true;
    document.getElementById("resetSuccess").textContent = "";
    document.getElementById("loginPanel").hidden = false;
    const err = lastAuthError();
    if (err) document.getElementById("loginError").textContent = err;
    return;
  }
  loginScreen.style.display = "none";
  appShell.style.display = "";
  document.getElementById("userBarName").textContent = user.name;
  document.getElementById("userBarRole").textContent = user.role === "admin" ? "Administrateur" : "Contremaître";
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", user.role !== "admin"));
  refreshNotificationStatus();
  subscribeData(user);
});

function subscribeData(user) {
  unsubscribers.push(onSnapshot(doc(db, "settings", "general"), async (snap) => {
    if (!snap.exists()) {
      if (user.role === "admin") {
        await setDoc(doc(db, "settings", "general"), { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp(), updatedBy: user.uid });
      }
      return;
    }
    const d = snap.data();
    state.countermasters = d.countermasters || [];
    state.teams = d.teams || [];
    state.prestations = d.prestations || [];
    state.reasons = d.reasons || [];
    settingsLoaded = true;
    renderAll();
  }, () => toast("Erreur de synchronisation des réglages.")));

  unsubscribers.push(onSnapshot(query(collection(db, "requests"), orderBy("createdAt", "desc")), (snap) => {
    state.requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, () => toast("Erreur de synchronisation des demandes.")));

  unsubscribers.push(onSnapshot(query(collection(db, "history"), orderBy("date", "desc"), limit(300)), (snap) => {
    state.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistory();
  }, () => toast("Erreur de synchronisation de l'historique.")));

  if (user.role === "admin") {
    unsubscribers.push(onSnapshot(query(collection(db, "users"), orderBy("createdAt", "asc")), (snap) => {
      state.users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      renderUserAccounts();
    }, () => toast("Erreur de synchronisation des comptes.")));

    unsubscribers.push(onSnapshot(doc(db, "settings", "sms"), (snap) => {
      state.sms = snap.exists() ? snap.data() : null;
      renderSmsSettings();
    }, () => toast("Erreur de synchronisation des réglages SMS.")));
  }
}

async function saveSettings() {
  await setDoc(doc(db, "settings", "general"), {
    countermasters: state.countermasters,
    teams: state.teams,
    prestations: state.prestations,
    reasons: state.reasons,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.uid || null
  }, { merge: true });
}

async function logHistory(requestId, text) {
  await addDoc(collection(db, "history"), {
    requestId, text,
    user: currentUser?.name || "Inconnu",
    userId: currentUser?.uid || null,
    date: serverTimestamp()
  });
}

/* ---------------------------------------------------------------------- */
/* Navigation                                                              */
/* ---------------------------------------------------------------------- */

const titles = {
  dashboard:["Tableau de bord","Vue globale des demandes et des traitements"],
  new:["Nouveau message","Coller et analyser un SMS reçu"],
  requests:["Demandes à traiter","Suivi partagé entre les contremaîtres"],
  history:["Historique","Traçabilité de toutes les actions"],
  stats:["Statistiques","Analyser les rejets par équipe, zone et motif"],
  settings:["Réglages","Notifications, et pour l'administrateur : comptes, équipes, contremaîtres, prestations et motifs"]
};

document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.view)));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.go)));
document.getElementById("mobileMenu").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));

function switchView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.getElementById("pageTitle").textContent=titles[name][0];
  document.getElementById("pageSubtitle").textContent=titles[name][1];
  document.querySelector(".sidebar").classList.remove("open");
  if(name==="new") hydrateFormOptions();
}

function hydrateFormOptions(){
  const fill=(id,items)=>document.getElementById(id).innerHTML=items.map(x=>`<option>${escapeHtml(x)}</option>`).join("");
  fill("fieldPrestation",state.prestations);
  fill("fieldEquipe",state.teams.map(t=>t.name));
  fill("fieldCM",state.countermasters.map(c=>c.name));
  fill("fieldMotif",state.reasons);
  if(!document.getElementById("fieldDate").value) document.getElementById("fieldDate").value=nowLocalInput();
}
document.getElementById("fieldEquipe").addEventListener("change",e=>{
  const team=state.teams.find(t=>t.name===e.target.value);
  if(team) document.getElementById("fieldCM").value=team.cm;
});

document.getElementById("analyzeMessage").addEventListener("click",()=>{
  const raw=document.getElementById("rawMessage").value.trim();
  if(!raw) return toast("Collez d’abord un message.");
  const n=normalize(raw);
  const poste=(raw.match(/\b\d{5}P\d{3,5}\b/i)||raw.match(/\b[A-Z0-9]{8,14}\b/i)||[""])[0];
  const prestation=state.prestations.find(p=>n.includes(normalize(p))) || state.prestations[0];
  const team=state.teams.find(t=>{
    const names=t.technicians.split(",").map(x=>normalize(x.trim()));
    return names.some(name=>name && n.includes(name.split(" ")[0])) || n.includes(normalize(t.name));
  }) || state.teams[0];
  let reason=state.reasons.find(r=>n.includes(normalize(r)));
  if(!reason){
    if(n.includes("PORTE") && n.includes("BLOQU")) reason="Porte de cabine bloquée";
    else if(n.includes("PROPRIETE") && n.includes("FERM")) reason="Propriété fermée";
    else if(n.includes("NON TROUV")) reason="Poste non trouvé";
    else if(n.includes("PAS D'ACCES") || n.includes("PAS D ACCES")) reason="Accès impossible";
    else reason="Autre";
  }
  document.getElementById("fieldPoste").value=poste;
  document.getElementById("fieldPrestation").value=prestation;
  document.getElementById("fieldEquipe").value=team?.name||"";
  document.getElementById("fieldCM").value=team?.cm||state.countermasters[0]?.name||"";
  document.getElementById("fieldMotif").value=reason;
  document.getElementById("fieldStatus").value="À traiter";
  document.getElementById("fieldDate").value=nowLocalInput();
  document.getElementById("fieldOriginal").value=raw;
  toast("Message analysé. Vérifiez la fiche.");
});

document.getElementById("clearMessage").addEventListener("click",()=>{
  document.getElementById("rawMessage").value="";
  document.getElementById("requestForm").reset();
  hydrateFormOptions();
});

document.getElementById("requestForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const req={
      poste:document.getElementById("fieldPoste").value.trim(),
      commune:document.getElementById("fieldCommune").value.trim(),
      prestation:document.getElementById("fieldPrestation").value,
      equipe:document.getElementById("fieldEquipe").value,
      cm:document.getElementById("fieldCM").value,
      motif:document.getElementById("fieldMotif").value,
      status:document.getElementById("fieldStatus").value,
      date:document.getElementById("fieldDate").value,
      action:document.getElementById("fieldAction").value.trim(),
      original:document.getElementById("fieldOriginal").value,
      treatedBy:"",
      treatedAt:"",
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || null,
      createdByName: currentUser?.name || ""
    };
    const ref = await addDoc(collection(db,"requests"), req);
    await logHistory(ref.id, `Demande ${req.poste} créée`);
    document.getElementById("rawMessage").value="";
    document.getElementById("requestForm").reset();
    toast("Demande enregistrée.");
    switchView("requests");
  } catch (err) {
    toast("Erreur d'enregistrement : " + err.message);
  } finally {
    btn.disabled = false;
  }
});

function renderDashboard(){
  const counts=s=>state.requests.filter(r=>r.status===s).length;
  document.getElementById("statTodo").textContent=counts("À traiter");
  document.getElementById("statProgress").textContent=counts("En cours");
  document.getElementById("statWaiting").textContent=counts("En attente");
  document.getElementById("statDone").textContent=counts("Traité");
  renderBars("reasonChart",groupCount(state.requests,"motif"));
  renderBars("teamChart",groupCount(state.requests,"equipe"));
  document.getElementById("recentRequests").innerHTML=requestTable(state.requests.slice(0,5),false);
}
function groupCount(items,key){
  return items.reduce((acc,x)=>{const k=x[key]||"Non renseigné";acc[k]=(acc[k]||0)+1;return acc;},{});
}
function renderBars(id,data){
  const el=document.getElementById(id), entries=Object.entries(data).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){el.className="bar-chart empty-state";el.textContent="Aucune donnée";return;}
  const max=Math.max(...entries.map(x=>x[1]));
  el.className="bar-chart";
  el.innerHTML=entries.map(([label,val])=>`<div class="bar-row"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(val/max)*100}%"></div></div><strong>${val}</strong></div>`).join("");
}
/* ---------------------------------------------------------------------- */
/* Statistiques                                                           */
/* ---------------------------------------------------------------------- */

function gdoZone(poste=""){
  const m = String(poste).match(/^(\d{2})/);
  return m ? m[1] : "Non renseigné";
}

function renderStatsFilters(){
  const teamSel = document.getElementById("statsTeam"), curTeam = teamSel.value;
  teamSel.innerHTML = `<option value="">Toutes les équipes</option>` + state.teams.map(t=>`<option>${escapeHtml(t.name)}</option>`).join("");
  teamSel.value = curTeam;

  const zones = [...new Set(state.requests.map(r=>gdoZone(r.poste)))].sort();
  const zoneSel = document.getElementById("statsZone"), curZone = zoneSel.value;
  zoneSel.innerHTML = `<option value="">Toutes les zones</option>` + zones.map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
  zoneSel.value = curZone;

  const motifSel = document.getElementById("statsMotif"), curMotif = motifSel.value;
  motifSel.innerHTML = `<option value="">Tous les motifs</option>` + state.reasons.map(m=>`<option>${escapeHtml(m)}</option>`).join("");
  motifSel.value = curMotif;
}

function statsFilteredRequests(){
  const from = document.getElementById("statsFrom").value;
  const to = document.getElementById("statsTo").value;
  const team = document.getElementById("statsTeam").value;
  const zone = document.getElementById("statsZone").value;
  const motif = document.getElementById("statsMotif").value;
  return state.requests.filter(r=>{
    if(team && r.equipe!==team) return false;
    if(zone && gdoZone(r.poste)!==zone) return false;
    if(motif && r.motif!==motif) return false;
    if(from || to){
      const d = r.date ? new Date(r.date) : (r.createdAt?.toDate ? r.createdAt.toDate() : null);
      if(!d || Number.isNaN(d.getTime())) return false;
      const day = d.toISOString().slice(0,10);
      if(from && day<from) return false;
      if(to && day>to) return false;
    }
    return true;
  });
}

function renderStats(){
  const rows = statsFilteredRequests();
  document.getElementById("statsCount").textContent = `${rows.length} rejet${rows.length>1?"s":""} correspondant${rows.length>1?"s":""} aux filtres`;
  renderBars("statsTeamChart", groupCount(rows,"equipe"));
  renderBars("statsZoneChart", groupCount(rows.map(r=>({zone:gdoZone(r.poste)})),"zone"));
  renderBars("statsMotifChart", groupCount(rows,"motif"));
}
["statsFrom","statsTo","statsTeam","statsZone","statsMotif"].forEach(id=>document.getElementById(id).addEventListener("input", renderStats));
document.getElementById("statsReset").addEventListener("click", ()=>{
  ["statsFrom","statsTo"].forEach(id=>document.getElementById(id).value="");
  ["statsTeam","statsZone","statsMotif"].forEach(id=>document.getElementById(id).value="");
  renderStats();
});

function requestTable(rows,actions=true){
  if(!rows.length) return `<div class="empty-state">Aucune demande</div>`;
  return `<table class="data-table"><thead><tr><th>Poste</th><th>Prestation</th><th>Équipe</th><th>Motif</th><th>Responsable</th><th>Statut</th><th>Date</th>${actions?"<th></th>":""}</tr></thead><tbody>
  ${rows.map(r=>`<tr><td><strong>${escapeHtml(r.poste||"—")}</strong><br><small>${escapeHtml(r.commune||"Commune non renseignée")}</small></td><td>${escapeHtml(r.prestation)}</td><td>${escapeHtml(r.equipe)}</td><td>${escapeHtml(r.motif)}</td><td>${escapeHtml(r.cm)}</td><td><span class="badge ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td><td>${fmtDate(r.date)}</td>${actions?`<td><button class="link-button open-request" data-id="${r.id}">Ouvrir</button></td>`:""}</tr>`).join("")}
  </tbody></table>`;
}
function renderRequests(){
  const status=document.getElementById("filterStatus").value;
  const team=document.getElementById("filterTeam").value;
  const q=normalize(document.getElementById("filterSearch").value);
  const rows=state.requests.filter(r=>(!status||r.status===status)&&(!team||r.equipe===team)&&(!q||normalize(JSON.stringify(r)).includes(q)));
  document.getElementById("requestsTable").innerHTML=requestTable(rows,true);
  document.querySelectorAll(".open-request").forEach(b=>b.addEventListener("click",()=>openRequest(b.dataset.id)));
}
function renderFilters(){
  const statuses=["À traiter","En cours","En attente","Traité","Classé sans action"];
  const s=document.getElementById("filterStatus"), current=s.value;
  s.innerHTML=`<option value="">Tous les statuts</option>`+statuses.map(x=>`<option>${x}</option>`).join("");s.value=current;
  const t=document.getElementById("filterTeam"), cur=t.value;
  t.innerHTML=`<option value="">Toutes les équipes</option>`+state.teams.map(x=>`<option>${escapeHtml(x.name)}</option>`).join("");t.value=cur;
}
["filterStatus","filterTeam","filterSearch"].forEach(id=>document.getElementById(id).addEventListener("input",renderRequests));

function requestHistoryHtml(requestId){
  const entries = state.history.filter(h=>h.requestId===requestId);
  if(!entries.length) return `<div class="empty-state">Aucun historique</div>`;
  return entries.map(h=>`<div class="timeline-item">
    <strong>${escapeHtml(h.text)}</strong>
    <span>${escapeHtml(h.user)} · ${fmtDate(h.date)}</span>
    ${h.photoURL?`<a href="${escapeHtml(h.photoURL)}" target="_blank" rel="noopener"><img class="history-photo" src="${escapeHtml(h.photoURL)}" alt="Photo jointe" loading="lazy" /></a>`:""}
  </div>`).join("");
}

function openRequest(id){
  const r=state.requests.find(x=>x.id===id); if(!r)return;
  const d=document.getElementById("requestDialog");
  document.getElementById("dialogContent").innerHTML=`
    <h2>${escapeHtml(r.poste||"Demande")}</h2>
    <p><span class="badge ${statusClass(r.status)}">${escapeHtml(r.status)}</span></p>
    <div class="detail-grid">
      <div class="detail-box"><span>Commune</span><strong>${escapeHtml(r.commune||"À compléter")}</strong></div>
      <div class="detail-box"><span>Prestation</span><strong>${escapeHtml(r.prestation)}</strong></div>
      <div class="detail-box"><span>Équipe</span><strong>${escapeHtml(r.equipe)}</strong></div>
      <div class="detail-box"><span>Contremaître</span><strong>${escapeHtml(r.cm)}</strong></div>
      <div class="detail-box"><span>Motif</span><strong>${escapeHtml(r.motif)}</strong></div>
      <div class="detail-box"><span>Date</span><strong>${fmtDate(r.date)}</strong></div>
      <div class="detail-box full"><span>Action du contremaître</span><strong>${escapeHtml(r.action||"Aucune action renseignée")}</strong></div>
      <div class="detail-box full"><span>Traité par</span><strong>${escapeHtml(r.treatedBy||"—")}</strong></div>
      <div class="detail-box full"><span>Message original</span><pre>${escapeHtml(r.original||"—")}</pre></div>
      <div class="detail-box full"><span>Historique de cette demande</span><div class="timeline">${requestHistoryHtml(r.id)}</div></div>
    </div>
    <div class="dialog-actions">
      <button type="button" class="secondary status-action" data-status="En cours">Passer en cours</button>
      <button type="button" class="secondary status-action" data-status="En attente">Mettre en attente</button>
      <button type="button" class="primary status-action" data-status="Traité">Marquer comme traité</button>
      <button type="button" class="secondary status-action" data-status="Classé sans action">Classer sans action</button>
    </div>`;
  document.querySelectorAll(".status-action").forEach(btn=>btn.addEventListener("click", ()=>{
    d.close();
    openActionDialog(r, btn.dataset.status);
  }));
  d.showModal();
}

let actionContext = null;
const actionDialog = document.getElementById("actionDialog");

function openActionDialog(request, newStatus){
  actionContext = { request, newStatus };
  document.getElementById("actionDialogTitle").textContent = `${newStatus} — ${request.poste||"Demande"}`;
  document.getElementById("actionText").value = request.action || "";
  document.getElementById("actionPhoto").value = "";
  document.getElementById("actionPhotoPreview").innerHTML = "";
  document.getElementById("actionError").textContent = "";
  actionDialog.showModal();
}
document.getElementById("actionCancel").addEventListener("click", ()=>{ actionDialog.close(); actionContext = null; });
document.getElementById("actionPhoto").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  const preview = document.getElementById("actionPhotoPreview");
  preview.innerHTML = file ? `<img src="${URL.createObjectURL(file)}" alt="Aperçu" />` : "";
});
document.getElementById("actionForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  if(!actionContext) return;
  const { request: r, newStatus } = actionContext;
  const action = document.getElementById("actionText").value.trim();
  const file = document.getElementById("actionPhoto").files[0];
  const btn = document.getElementById("actionSubmit");
  const errEl = document.getElementById("actionError");
  btn.disabled = true; errEl.textContent = "";
  try {
    let photoURL = null;
    if(file){
      if(!file.type.startsWith("image/")) throw new Error("Le fichier choisi n'est pas une image.");
      if(file.size > 10*1024*1024) throw new Error("Photo trop volumineuse (max 10 Mo).");
      const path = `requests/${r.id}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      photoURL = await getDownloadURL(storageRef);
    }
    const old = r.status;
    const patch = { status: newStatus, action };
    if(newStatus==="Traité"){ patch.treatedBy = currentUser?.name || ""; patch.treatedAt = serverTimestamp(); }
    await updateDoc(doc(db,"requests",r.id), patch);
    await addDoc(collection(db,"history"), {
      requestId: r.id,
      text: `${r.poste} : ${old} → ${newStatus}`,
      user: currentUser?.name || "Inconnu",
      userId: currentUser?.uid || null,
      date: serverTimestamp(),
      photoURL: photoURL || null
    });
    actionDialog.close();
    actionContext = null;
    toast("Statut mis à jour.");
  } catch(err) {
    errEl.textContent = err.message || "Erreur lors de l'enregistrement.";
  }
  btn.disabled = false;
});

function renderHistory(){
  const el=document.getElementById("historyList");
  el.innerHTML=state.history.length?state.history.map(h=>`<div class="timeline-item">
    <strong>${escapeHtml(h.text)}</strong>
    <span>${escapeHtml(h.user)} · ${fmtDate(h.date)}</span>
    ${h.photoURL?`<a href="${escapeHtml(h.photoURL)}" target="_blank" rel="noopener"><img class="history-photo" src="${escapeHtml(h.photoURL)}" alt="Photo jointe" loading="lazy" /></a>`:""}
  </div>`).join(""):`<div class="empty-state">Aucun historique</div>`;
}

/* ---------------------------------------------------------------------- */
/* Réglages (admin uniquement)                                            */
/* ---------------------------------------------------------------------- */

function renderSettings(){
  if (currentUser?.role !== "admin") return;
  document.getElementById("cmSettings").innerHTML=state.countermasters.map((c,i)=>`<div class="setting-row cm"><input class="cm-name" data-i="${i}" value="${escapeHtml(c.name)}" placeholder="Nom"><input class="cm-email" data-i="${i}" value="${escapeHtml(c.email||"")}" type="email" placeholder="Email du compte lié"><button class="danger-button delete-cm" data-i="${i}">×</button></div>`).join("");
  document.getElementById("teamSettings").innerHTML=state.teams.map((t,i)=>`<div class="setting-row team"><input class="team-name" data-i="${i}" value="${escapeHtml(t.name)}"><select class="team-cm" data-i="${i}">${state.countermasters.map(c=>`<option ${c.name===t.cm?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select><button class="danger-button delete-team" data-i="${i}">×</button></div>`).join("");
  document.getElementById("prestationSettings").innerHTML=state.prestations.map((p,i)=>`<div class="setting-row"><input class="prestation-name" data-i="${i}" value="${escapeHtml(p)}"><button class="danger-button delete-prestation" data-i="${i}">×</button></div>`).join("");
  document.getElementById("reasonSettings").innerHTML=state.reasons.map((p,i)=>`<div class="setting-row"><input class="reason-name" data-i="${i}" value="${escapeHtml(p)}"><button class="danger-button delete-reason" data-i="${i}">×</button></div>`).join("");
  bindSettings();
}
function bindSettings(){
  document.querySelectorAll(".cm-name").forEach(x=>x.addEventListener("change",()=>{const old=state.countermasters[x.dataset.i].name;state.countermasters[x.dataset.i].name=x.value;state.teams.forEach(t=>{if(t.cm===old)t.cm=x.value});saveSettings()}));
  document.querySelectorAll(".cm-email").forEach(x=>x.addEventListener("change",()=>{state.countermasters[x.dataset.i].email=x.value.trim();saveSettings()}));
  document.querySelectorAll(".team-name").forEach(x=>x.addEventListener("change",()=>{state.teams[x.dataset.i].name=x.value;saveSettings()}));
  document.querySelectorAll(".team-cm").forEach(x=>x.addEventListener("change",()=>{state.teams[x.dataset.i].cm=x.value;saveSettings()}));
  document.querySelectorAll(".prestation-name").forEach(x=>x.addEventListener("change",()=>{state.prestations[x.dataset.i]=x.value;saveSettings()}));
  document.querySelectorAll(".reason-name").forEach(x=>x.addEventListener("change",()=>{state.reasons[x.dataset.i]=x.value;saveSettings()}));
  [[".delete-cm","countermasters"],[".delete-team","teams"],[".delete-prestation","prestations"],[".delete-reason","reasons"]].forEach(([sel,key])=>document.querySelectorAll(sel).forEach(x=>x.addEventListener("click",()=>{state[key].splice(Number(x.dataset.i),1);saveSettings()})));
}
document.getElementById("addCM").addEventListener("click",()=>{state.countermasters.push({id:crypto.randomUUID(),name:"Nouveau contremaître",email:"",notifications:true});saveSettings()});
document.getElementById("addTeam").addEventListener("click",()=>{state.teams.push({id:crypto.randomUUID(),name:"Nouvelle équipe",technicians:"",cm:state.countermasters[0]?.name||""});saveSettings()});
document.getElementById("addPrestation").addEventListener("click",()=>{state.prestations.push("Nouvelle prestation");saveSettings()});
document.getElementById("addReason").addEventListener("click",()=>{state.reasons.push("Nouveau motif");saveSettings()});

/* ---------------------------------------------------------------------- */
/* Comptes utilisateurs (admin uniquement)                                */
/* ---------------------------------------------------------------------- */

function renderUserAccounts(){
  if (currentUser?.role !== "admin") return;
  const el = document.getElementById("userAccounts");
  if (!state.users.length) { el.innerHTML = `<div class="empty-state">Aucun compte</div>`; return; }
  el.innerHTML = state.users.map(u => `
    <div class="setting-row user-row">
      <div class="user-row-info">
        <strong>${escapeHtml(u.name)}</strong>
        <span>${escapeHtml(u.email)}</span>
      </div>
      <select class="user-role" data-uid="${u.uid}" ${u.uid===currentUser.uid?"disabled":""}>
        <option value="contremaitre" ${u.role==="contremaitre"?"selected":""}>Contremaître</option>
        <option value="admin" ${u.role==="admin"?"selected":""}>Administrateur</option>
      </select>
      <button type="button" class="secondary user-toggle-active" data-uid="${u.uid}" data-active="${u.active}" ${u.uid===currentUser.uid?"disabled":""}>${u.active?"Désactiver":"Réactiver"}</button>
      <button type="button" class="danger-button user-delete" data-uid="${u.uid}" ${u.uid===currentUser.uid?"disabled":""}>×</button>
    </div>`).join("");

  el.querySelectorAll(".user-role").forEach(sel => sel.addEventListener("change", async () => {
    sel.disabled = true;
    try {
      await httpsCallable(functions,"setUserRole")({ uid: sel.dataset.uid, role: sel.value });
      toast("Rôle mis à jour.");
    } catch(err) { toast("Erreur : " + err.message); }
    sel.disabled = false;
  }));
  el.querySelectorAll(".user-toggle-active").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await httpsCallable(functions,"setUserActive")({ uid: btn.dataset.uid, active: btn.dataset.active !== "true" });
      toast("Statut du compte mis à jour.");
    } catch(err) { toast("Erreur : " + err.message); btn.disabled = false; }
  }));
  el.querySelectorAll(".user-delete").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement ce compte ?")) return;
    btn.disabled = true;
    try {
      await httpsCallable(functions,"deleteUserAccount")({ uid: btn.dataset.uid });
      toast("Compte supprimé.");
    } catch(err) { toast("Erreur : " + err.message); btn.disabled = false; }
  }));
}

document.getElementById("addUserForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("addUserSubmit");
  const name = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role = document.getElementById("newUserRole").value;
  const errEl = document.getElementById("addUserError");
  btn.disabled = true; errEl.textContent = "";
  try {
    await httpsCallable(functions,"createUserAccount")({ name, email, password, role });
    e.target.reset();
    toast("Compte créé.");
  } catch(err) {
    errEl.textContent = err.message || "Erreur lors de la création du compte.";
  }
  btn.disabled = false;
});

/* ---------------------------------------------------------------------- */
/* SMS automatique (admin uniquement)                                     */
/* ---------------------------------------------------------------------- */

const WEBHOOK_URL = `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/receiveSms`;

function renderSmsSettings(){
  if (currentUser?.role !== "admin") return;
  document.getElementById("smsWebhookUrl").value = WEBHOOK_URL;
  document.getElementById("smsWebhookSecret").value = state.sms?.webhookSecret || "(aucune clé générée)";
}
document.getElementById("smsShowSecret").addEventListener("click", (e) => {
  const input = document.getElementById("smsWebhookSecret");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  e.target.textContent = show ? "Masquer" : "Afficher";
});
document.getElementById("smsRegenerateSecret").addEventListener("click", async () => {
  if(!confirm("Régénérer la clé ? L'ancienne cessera immédiatement de fonctionner tant que l'application de transfert de SMS n'est pas mise à jour.")) return;
  const btn = document.getElementById("smsRegenerateSecret");
  btn.disabled = true;
  try {
    await setDoc(doc(db,"settings","sms"), {
      webhookSecret: crypto.randomUUID(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null
    }, { merge: true });
    toast("Nouvelle clé générée.");
  } catch(err) {
    toast("Erreur : " + err.message);
  }
  btn.disabled = false;
});

/* ---------------------------------------------------------------------- */
/* Notifications push                                                     */
/* ---------------------------------------------------------------------- */

function refreshNotificationStatus(){
  const btn = document.getElementById("enableNotifications");
  const statusEl = document.getElementById("notificationsStatus");
  if(!("Notification" in window)){ statusEl.textContent = "Notifications non prises en charge par ce navigateur."; btn.disabled = true; return; }
  if(Notification.permission === "denied"){ statusEl.textContent = "Notifications bloquées : autorisez-les dans les réglages du navigateur, puis réessayez."; }
  else if(Notification.permission === "granted"){ statusEl.textContent = "Notifications activées sur cet appareil."; }
  else { statusEl.textContent = ""; }
}

document.getElementById("enableNotifications").addEventListener("click", async () => {
  const btn = document.getElementById("enableNotifications");
  const statusEl = document.getElementById("notificationsStatus");
  btn.disabled = true;
  try {
    if(!(await messagingIsSupported())) throw new Error("Les notifications ne sont pas prises en charge par ce navigateur.");
    if(VAPID_KEY === "REPLACE_ME") throw new Error("Clé de notification non configurée par l'administrateur.");
    const permission = await Notification.requestPermission();
    if(permission !== "granted") throw new Error("Autorisation refusée.");
    const swReg = await navigator.serviceWorker.register("firebase-messaging-sw.js", { type: "module" });
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    await setDoc(doc(db, "users", currentUser.uid, "deviceTokens", token), {
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent
    });
    statusEl.textContent = "Notifications activées sur cet appareil.";
  } catch(err) {
    statusEl.textContent = "Erreur : " + (err.message || "impossible d'activer les notifications.");
  }
  btn.disabled = false;
});

/* ---------------------------------------------------------------------- */

function renderAll(){
  if (!settingsLoaded) return;
  hydrateFormOptions();
  renderFilters();
  renderDashboard();
  renderRequests();
  renderHistory();
  renderStatsFilters();
  renderStats();
  renderSettings();
}

if("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
