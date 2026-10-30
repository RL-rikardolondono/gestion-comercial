// Permite instalar Agente-IA en el celular. No guarda datos: todo viene del servidor.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",()=>{});
