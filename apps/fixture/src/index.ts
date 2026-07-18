import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

export const fixtureVersion = 1;

export const fixtureHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LaunchCart Demo</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #07110d; color: #e8fff3; }
    header, main { max-width: 960px; margin: auto; padding: 24px; }
    nav { display: flex; justify-content: space-between; align-items: center; }
    .brand { color: #54e58c; font-weight: 800; }
    .hero { padding: 72px 0 32px; }
    h1 { max-width: 650px; font-size: clamp(40px, 8vw, 72px); line-height: .98; }
    button { border: 0; border-radius: 10px; padding: 14px 20px; background: #54e58c; color: #06200f; font-weight: 700; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .card { padding: 24px; border: 1px solid #28513a; border-radius: 16px; background: #0c1c14; }
    .price-row { display: flex; gap: 12px; align-items: baseline; }
    .mobile-overflow { width: 720px; white-space: nowrap; padding: 16px; border: 1px dashed #ff6b7a; }
    @media (max-width: 600px) { .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header><nav><span class="brand">LaunchCart</span><a href="#pricing">Pricing</a></nav></header>
  <main>
    <section class="hero">
      <p>Ship your first storefront tonight</p>
      <h1>A tiny commerce starter for ambitious makers.</h1>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <button id="dead-start">Start selling</button>
    </section>
    <section id="pricing" class="cards">
      <article class="card">
        <h2>Starter widgets</h2>
        <p>Quantity: 2 · Unit price: $25</p>
        <div class="price-row"><strong>Total: $40</strong><span>Expected arithmetic: 2 × $25</span></div>
      </article>
      <article class="card">
        <h2>Campaign summary</h2>
        <p>TODO: replace this placeholder with real campaign data.</p>
      </article>
    </section>
    <section aria-label="Mobile feature strip" class="mobile-overflow">
      This intentionally fixed-width feature strip overflows a 375px mobile viewport.
    </section>
  </main>
  <script>document.querySelector('#dead-start').addEventListener('click', () => {});</script>
</body>
</html>`;

export function createFixtureServer(): Server {
  return createServer((request, response) => {
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(fixtureHtml);
      return;
    }
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, version: fixtureVersion }));
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  });
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 4173);
  createFixtureServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`e2ebuddy fixture listening on http://127.0.0.1:${port}\n`);
  });
}
