
const CACHE="app-cm-v10";
const ASSETS=["./","./index.html","./styles.css","./app.js","./auth.js","./firebase-init.js","./firebase-config.js","./manifest.webmanifest"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  // Ne jamais intercepter les appels vers Firebase (Auth/Firestore/Functions) :
  // ils doivent atteindre le réseau directement pour la synchronisation temps réel.
  if(new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
