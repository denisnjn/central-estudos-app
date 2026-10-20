/* Central de Estudos — service worker do app.
   A casca (este repositório público) só tem index.html, boot.js, ícones e este arquivo.
   Todo o resto (app/ e cursos/) vem do repositório PRIVADO via API do GitHub, com o token
   do usuário, e fica guardado no Cache Storage para funcionar sem internet. */
const VER = "1";
const SHELL_CACHE = "central-casca-" + VER;
const CONTEUDO = "central-conteudo";
const FONTES = "central-fontes";
const SHELL = ["index.html", "boot.js", "manifest.webmanifest", "icone-192.png", "icone-512.png", "icone-mask.png"];
const BASE = new URL("./", self.location).pathname;

const TIPOS = {
  js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", mp3: "audio/mpeg", wav: "audio/wav"
};
const tipo = p => TIPOS[p.split(".").pop().toLowerCase()] || "application/octet-stream";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("central-casca-") && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function config() {
  const c = await caches.open(CONTEUDO);
  const r = await c.match("__config");
  return r ? r.json() : null;
}
async function doGitHub(p) {
  const k = await config();
  if (!k || !k.token) return null;
  const caminho = p.split("/").map(encodeURIComponent).join("/");
  const r = await fetch("https://api.github.com/repos/" + k.owner + "/" + k.repo + "/contents/" + caminho + "?ref=" + k.branch,
    { headers: { Authorization: "Bearer " + k.token, Accept: "application/vnd.github.raw" } });
  if (!r.ok) return null;
  return new Response(await r.blob(), { headers: { "Content-Type": tipo(p) } });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    let p = decodeURIComponent(url.pathname.slice(BASE.length));
    if (p === "") p = "index.html";
    if (SHELL.includes(p) || p === "sw.js") {
      // casca: rede primeiro (para receber atualizações), cache se estiver offline
      e.respondWith(fetch(req).then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(SHELL_CACHE).then(c => c.put(p, copia)); }
        return r;
      }).catch(() => caches.match(p, { cacheName: SHELL_CACHE })));
      return;
    }
    // conteúdo privado: cache primeiro; se faltar, busca no GitHub e guarda
    e.respondWith((async () => {
      const c = await caches.open(CONTEUDO);
      const hit = await c.match(p);
      if (hit) return hit;
      try {
        const r = await doGitHub(p);
        if (r) { await c.put(p, r.clone()); return r; }
      } catch (err) {}
      return new Response("Arquivo indisponível: " + p, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })());
    return;
  }

  // fontes do Google: guarda para usar offline
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const c = await caches.open(FONTES);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
});
