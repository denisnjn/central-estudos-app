/* Central de Estudos — inicialização do app (PWA).
   1. registra o service worker;  2. pede o token do GitHub na primeira vez;
   3. baixa o conteúdo do repositório privado para o aparelho (só o que mudou);
   4. carrega o app normal (app/*.js, cursos/catalogo.js), que passa a vir do cache. */
(function () {
"use strict";
const APP = { owner: "denisnjn", repo: "central-estudos", branch: "main", progresso: "progresso" };
const CONTEUDO = "central-conteudo";
const API = "https://api.github.com/repos/" + APP.owner + "/" + APP.repo;
const TOKEN_KEY = "central:token";
const view = document.getElementById("view");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function tela(html) { view.innerHTML = '<div class="boot">' + html + "</div>"; }
function gh(path, token, accept) {
  return fetch(API + path, { headers: { Authorization: "Bearer " + token, Accept: accept || "application/vnd.github+json" }, cache: "no-store" });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function salvarConfig(token) {
  const c = await caches.open(CONTEUDO);
  await c.put("__config", new Response(JSON.stringify({ owner: APP.owner, repo: APP.repo, branch: APP.branch, token })));
}
async function lerManifesto() {
  const c = await caches.open(CONTEUDO);
  const r = await c.match("__manifesto");
  return r ? r.json() : null;
}

/* ---------- login ---------- */
function pedirToken(msg) {
  return new Promise(resolve => {
    tela(
      "<h1>Central de Estudos</h1>" +
      "<p>Primeira vez neste aparelho. Cole o seu <b>token do GitHub</b> para baixar os cursos do repositório privado.</p>" +
      (msg ? '<p class="erro">' + esc(msg) + "</p>" : "") +
      '<form id="f"><input id="tk" type="password" autocomplete="off" placeholder="github_pat_..." required>' +
      '<button type="submit">Entrar</button></form>' +
      "<details><summary>Como gerar o token</summary><ol>" +
      '<li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.</li>' +
      "<li>Nome: <i>central-estudos</i>. Validade: a maior que houver (ou sem validade).</li>" +
      "<li>Repository access: <b>Only select repositories</b> → <b>" + esc(APP.repo) + "</b>.</li>" +
      "<li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>" +
      "<li>Gere, copie e cole aqui. O token fica só neste aparelho.</li></ol></details>"
    );
    document.getElementById("f").addEventListener("submit", async ev => {
      ev.preventDefault();
      const token = document.getElementById("tk").value.trim();
      tela("<p>Conferindo o token…</p>");
      try {
        const r = await gh("", token);
        if (r.status === 401) return resolve(pedirToken("Token inválido ou expirado."));
        if (r.status === 404) return resolve(pedirToken("O token não tem acesso ao repositório " + APP.repo + "."));
        if (!r.ok) return resolve(pedirToken("O GitHub respondeu " + r.status + ". Tente de novo."));
        localStorage.setItem(TOKEN_KEY, token);
        await salvarConfig(token);
        resolve(token);
      } catch (e) {
        resolve(pedirToken("Sem conexão com o GitHub. Conecte-se à internet para o primeiro acesso."));
      }
    });
  });
}

/* ---------- baixar e atualizar o conteúdo ---------- */
async function atualizar(token, mostrar) {
  const r = await gh("/commits/" + APP.branch, token, "application/vnd.github.sha");
  if (r.status === 401) throw Object.assign(new Error("token"), { token: true });
  if (!r.ok) throw new Error("GitHub " + r.status);
  const commit = (await r.text()).trim();
  const man = (await lerManifesto()) || { commit: "", files: {} };
  if (man.commit === commit) return { mudou: 0, commit };

  const t = await gh("/git/trees/" + commit + "?recursive=1", token);
  if (!t.ok) throw new Error("GitHub " + t.status);
  const tree = (await t.json()).tree.filter(x => x.type === "blob" && /^(app|cursos)\//.test(x.path));
  const novos = tree.filter(x => man.files[x.path] !== x.sha);
  const atuais = new Set(tree.map(x => x.path));
  const c = await caches.open(CONTEUDO);
  let feitos = 0;
  const fila = novos.slice();
  async function trabalhador() {
    while (fila.length) {
      const x = fila.shift();
      for (let tentativa = 0; ; tentativa++) {
        try {
          const b = await gh("/git/blobs/" + x.sha, token, "application/vnd.github.raw");
          if (!b.ok) throw new Error("GitHub " + b.status);
          await c.put(x.path, new Response(await b.blob(), { headers: { "Content-Type": tipoDe(x.path) } }));
          man.files[x.path] = x.sha;
          break;
        } catch (e) {
          if (tentativa >= 3) throw e;
          await sleep(1000 * (tentativa + 1));
        }
      }
      feitos++;
      if (mostrar) mostrar(feitos, novos.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  for (const p of Object.keys(man.files)) if (!atuais.has(p)) { await c.delete(p); delete man.files[p]; }
  man.commit = commit;
  man.quando = Date.now();
  await c.put("__manifesto", new Response(JSON.stringify(man)));
  return { mudou: novos.length, commit };
}
const TIPOS = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", gif: "image/gif", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", mp3: "audio/mpeg" };
const tipoDe = p => TIPOS[p.split(".").pop().toLowerCase()] || "application/octet-stream";

/* ---------- carregar o app ---------- */
function css(href) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
function script(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); });
}
async function iniciarApp(commit) {
  window.CENTRAL_V = (commit || "").slice(0, 8);
  css("app/lib/katex.min.css");
  css("app/app.css");
  document.body.classList.remove("carregando");
  for (const s of ["app/lib/katex.min.js", "app/app.js", "app/stem.js", "app/lang.js", "app/ia.js", "cursos/catalogo.js"]) await script(s);
}

function aviso(texto, acao) {
  const d = document.createElement("div");
  d.className = "boot-aviso";
  d.innerHTML = esc(texto) + (acao ? ' <button type="button">' + esc(acao) + "</button>" : "");
  document.body.appendChild(d);
  const b = d.querySelector("button");
  if (b) b.addEventListener("click", () => location.reload());
  else setTimeout(() => d.remove(), 6000);
}

async function main() {
  if (!("serviceWorker" in navigator) || !window.caches) { tela("<p>Este navegador não suporta o app. Use o Google Chrome.</p>"); return; }
  await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    if (!sessionStorage.getItem("central:recarregou")) { sessionStorage.setItem("central:recarregou", "1"); location.reload(); return; }
  }
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) token = await pedirToken();
  else await salvarConfig(token);
  APP.token = token;
  window.CENTRAL_APP = APP;

  const man = await lerManifesto();
  if (!man || !man.commit) {
    tela('<h1>Central de Estudos</h1><p>Baixando os cursos para usar sem internet…</p><div class="barra"><i id="bar"></i></div><p id="cnt" class="peq"></p>');
    for (;;) {
      try {
        const r = await atualizar(token, (f, n) => {
          document.getElementById("bar").style.width = (100 * f / n).toFixed(1) + "%";
          document.getElementById("cnt").textContent = f + " de " + n + " arquivos";
        });
        await iniciarApp(r.commit);
        return;
      } catch (e) {
        if (e.token) { localStorage.removeItem(TOKEN_KEY); token = await pedirToken("O token expirou ou foi revogado."); APP.token = token; continue; }
        tela('<p class="erro">Não consegui baixar os cursos (' + esc(e.message) + ").</p><p>Confira a internet e toque para tentar de novo.</p><button onclick=\"location.reload()\">Tentar de novo</button>");
        return;
      }
    }
  }
  await iniciarApp(man.commit);
  if (navigator.onLine) {
    try {
      const r = await atualizar(token);
      if (r.mudou) aviso(r.mudou + " arquivo(s) novo(s) ou atualizado(s).", "Recarregar");
    } catch (e) {
      if (e.token) aviso("O token do GitHub expirou. Gere outro em Ajustes.");
    }
  }
}

window.CENTRAL_BOOT = {
  atualizar: async () => { const r = await atualizar(APP.token); return r.mudou; },
  sair: async () => { localStorage.removeItem(TOKEN_KEY); await caches.delete(CONTEUDO); location.reload(); }
};
main().catch(e => tela('<p class="erro">Erro ao iniciar: ' + esc(e.message) + "</p>"));
})();
