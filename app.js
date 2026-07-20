
const DEFAULTS = {
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
  ],
  requests: [],
  history: []
};

let state = loadState();

function loadState() {
  const saved = localStorage.getItem("suivi-cm-state");
  return saved ? JSON.parse(saved) : structuredClone(DEFAULTS);
}
function saveState() {
  localStorage.setItem("suivi-cm-state", JSON.stringify(state));
  renderAll();
}
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
  return new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));
}
function escapeHtml(s=""){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));}

const titles = {
  dashboard:["Tableau de bord","Vue globale des demandes et des traitements"],
  new:["Nouveau message","Coller et analyser un SMS reçu"],
  requests:["Demandes à traiter","Suivi partagé entre les contremaîtres"],
  history:["Historique","Traçabilité de toutes les actions"],
  settings:["Réglages","Modifier les équipes, contremaîtres, prestations et motifs"]
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

document.getElementById("requestForm").addEventListener("submit",e=>{
  e.preventDefault();
  const req={
    id:crypto.randomUUID(),
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
    createdAt:new Date().toISOString()
  };
  state.requests.unshift(req);
  state.history.unshift({id:crypto.randomUUID(),requestId:req.id,text:`Demande ${req.poste} créée`,user:"Adao Teixeira",date:new Date().toISOString()});
  saveState();
  document.getElementById("rawMessage").value="";
  document.getElementById("requestForm").reset();
  toast("Demande enregistrée.");
  switchView("requests");
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
    </div>
    <div class="dialog-actions">
      <button type="button" class="secondary status-action" data-status="En cours">Passer en cours</button>
      <button type="button" class="secondary status-action" data-status="En attente">Mettre en attente</button>
      <button type="button" class="primary status-action" data-status="Traité">Marquer comme traité</button>
      <button type="button" class="secondary status-action" data-status="Classé sans action">Classer sans action</button>
    </div>`;
  document.querySelectorAll(".status-action").forEach(btn=>btn.addEventListener("click",()=>{
    const action=prompt("Action ou commentaire du contremaître :",r.action||"") ?? r.action;
    const old=r.status; r.status=btn.dataset.status; r.action=action;
    if(r.status==="Traité"){r.treatedBy="Adao Teixeira";r.treatedAt=new Date().toISOString();}
    state.history.unshift({id:crypto.randomUUID(),requestId:r.id,text:`${r.poste} : ${old} → ${r.status}`,user:"Adao Teixeira",date:new Date().toISOString()});
    saveState(); d.close(); toast("Statut mis à jour.");
  }));
  d.showModal();
}
function renderHistory(){
  const el=document.getElementById("historyList");
  el.innerHTML=state.history.length?state.history.map(h=>`<div class="timeline-item"><strong>${escapeHtml(h.text)}</strong><span>${escapeHtml(h.user)} · ${fmtDate(h.date)}</span></div>`).join(""):`<div class="empty-state">Aucun historique</div>`;
}

function renderSettings(){
  document.getElementById("cmSettings").innerHTML=state.countermasters.map((c,i)=>`<div class="setting-row"><input class="cm-name" data-i="${i}" value="${escapeHtml(c.name)}"><button class="danger-button delete-cm" data-i="${i}">×</button></div>`).join("");
  document.getElementById("teamSettings").innerHTML=state.teams.map((t,i)=>`<div class="setting-row team"><input class="team-name" data-i="${i}" value="${escapeHtml(t.name)}"><select class="team-cm" data-i="${i}">${state.countermasters.map(c=>`<option ${c.name===t.cm?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select><button class="danger-button delete-team" data-i="${i}">×</button></div>`).join("");
  document.getElementById("prestationSettings").innerHTML=state.prestations.map((p,i)=>`<div class="setting-row"><input class="prestation-name" data-i="${i}" value="${escapeHtml(p)}"><button class="danger-button delete-prestation" data-i="${i}">×</button></div>`).join("");
  document.getElementById("reasonSettings").innerHTML=state.reasons.map((p,i)=>`<div class="setting-row"><input class="reason-name" data-i="${i}" value="${escapeHtml(p)}"><button class="danger-button delete-reason" data-i="${i}">×</button></div>`).join("");
  bindSettings();
}
function bindSettings(){
  document.querySelectorAll(".cm-name").forEach(x=>x.addEventListener("change",()=>{const old=state.countermasters[x.dataset.i].name;state.countermasters[x.dataset.i].name=x.value;state.teams.forEach(t=>{if(t.cm===old)t.cm=x.value});saveState()}));
  document.querySelectorAll(".team-name").forEach(x=>x.addEventListener("change",()=>{state.teams[x.dataset.i].name=x.value;saveState()}));
  document.querySelectorAll(".team-cm").forEach(x=>x.addEventListener("change",()=>{state.teams[x.dataset.i].cm=x.value;saveState()}));
  document.querySelectorAll(".prestation-name").forEach(x=>x.addEventListener("change",()=>{state.prestations[x.dataset.i]=x.value;saveState()}));
  document.querySelectorAll(".reason-name").forEach(x=>x.addEventListener("change",()=>{state.reasons[x.dataset.i]=x.value;saveState()}));
  [[".delete-cm","countermasters"],[".delete-team","teams"],[".delete-prestation","prestations"],[".delete-reason","reasons"]].forEach(([sel,key])=>document.querySelectorAll(sel).forEach(x=>x.addEventListener("click",()=>{state[key].splice(Number(x.dataset.i),1);saveState()})));
}
document.getElementById("addCM").addEventListener("click",()=>{state.countermasters.push({id:crypto.randomUUID(),name:"Nouveau contremaître",email:"",notifications:true});saveState()});
document.getElementById("addTeam").addEventListener("click",()=>{state.teams.push({id:crypto.randomUUID(),name:"Nouvelle équipe",technicians:"",cm:state.countermasters[0]?.name||""});saveState()});
document.getElementById("addPrestation").addEventListener("click",()=>{state.prestations.push("Nouvelle prestation");saveState()});
document.getElementById("addReason").addEventListener("click",()=>{state.reasons.push("Nouveau motif");saveState()});

document.getElementById("seedDemo").addEventListener("click",()=>{
  if(state.requests.length && !confirm("Ajouter quand même les exemples ?")) return;
  const demo=[
    {poste:"13071P0069",commune:"",prestation:"AMELIO",equipe:"MESQUITA / FERREIRA",cm:"CM 1",motif:"Porte de cabine bloquée",status:"À traiter",date:"2026-07-20T19:27",action:"",original:"AMELIO\nPoste en visite\nFernando MESQUITA\n13071P0069\nPAS D’ACCES → PORTE DE CABINE BLOQUÉE"},
    {poste:"04096P0523",commune:"",prestation:"AMELIO",equipe:"PASTOR / ÉQUIPE",cm:"CM 2",motif:"Autre",status:"En cours",date:"2026-07-20T18:10",action:"Vérification des mesures en cours",original:"AMELIO\nPoste non travaillable\nMiguel PASTOR\n04096P0523\nAUTRES...\nRM Avant_T: 5.3"},
    {poste:"13071P0070",commune:"",prestation:"MESURES",equipe:"MESQUITA / FERREIRA",cm:"CM 1",motif:"Accès impossible",status:"Traité",date:"2026-07-19T16:40",action:"Accès reprogrammé avec l’agence",original:"Poste non travaillable\nFernando MESQUITA\n13071P0070"}
  ].map(x=>({...x,id:crypto.randomUUID(),treatedBy:x.status==="Traité"?"Adao Teixeira":"",treatedAt:x.status==="Traité"?new Date().toISOString():"",createdAt:new Date().toISOString()}));
  state.requests.unshift(...demo);
  demo.forEach(r=>state.history.unshift({id:crypto.randomUUID(),requestId:r.id,text:`Demande ${r.poste} créée`,user:"Adao Teixeira",date:new Date().toISOString()}));
  saveState();toast("Exemples ajoutés.");
});

function renderAll(){
  hydrateFormOptions();
  renderFilters();
  renderDashboard();
  renderRequests();
  renderHistory();
  renderSettings();
}
renderAll();

if("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
