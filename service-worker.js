import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-sw.js";
import { firebaseConfig } from "./firebase-config.js";

// Un seul service worker gère à la fois le cache PWA et les notifications
// push : deux service workers enregistrés séparément se disputent le
// contrôle de la page (le dernier activé gagne), ce qui coupait les
// notifications en arrière-plan dès que celui-ci se réactivait.
const messagingApp = initializeApp(firebaseConfig);
const messaging = getMessaging(messagingApp);
onBackgroundMessage(messaging, (payload) => {
  const title = payload.notification?.title || "App CM";
  self.registration.showNotification(title, {
    body: payload.notification?.body || "",
    data: payload.data || {}
  });
});

const CACHE="app-cm-v12";
const ASSETS=["./","./index.html","./styles.css","./app.js","./auth.js","./firebase-init.js","./firebase-config.js","./manifest.webmanifest"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  // Ne jamais intercepter les appels vers Firebase (Auth/Firestore/Functions) :
  // ils doivent atteindre le réseau directement pour la synchronisation temps réel.
  if(new URL(e.request.url).origin !== location.origin) return;
  // Réseau prioritaire (toujours la dernière version déployée), cache en
  // secours hors-ligne uniquement : un cache prioritaire figeait l'app sur
  // une version périmée tant que ce fichier lui-même ne changeait pas
  // d'un déploiement à l'autre.
  e.respondWith(
    fetch(e.request)
      .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
      .catch(() => caches.match(e.request))
  );
});
