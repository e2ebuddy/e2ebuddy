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

export const loginDemoHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BuddyBoard Login Demo</title>
  <style>
    * { box-sizing: border-box; }
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 10%, #173b31 0, #08120f 38%, #050807 100%); color: #eefbf5; }
    button, input { font: inherit; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .login { width: min(100%, 440px); padding: 36px; border: 1px solid #25483a; border-radius: 24px; background: rgba(10, 24, 18, .92); box-shadow: 0 24px 80px rgba(0, 0, 0, .4); }
    .logo { display: inline-flex; align-items: center; gap: 10px; color: #75efa4; font-weight: 800; letter-spacing: -.02em; }
    .logo-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #75efa4; color: #092014; }
    h1 { margin: 32px 0 8px; font-size: 34px; letter-spacing: -.04em; }
    .muted { color: #a7bdb3; line-height: 1.55; }
    label { display: grid; gap: 8px; margin-top: 20px; color: #d8ece2; font-weight: 650; }
    input { width: 100%; padding: 13px 14px; border: 1px solid #365a4b; border-radius: 11px; outline: none; background: #08130f; color: #eefbf5; }
    input:focus { border-color: #75efa4; box-shadow: 0 0 0 3px rgba(117, 239, 164, .14); }
    button { cursor: pointer; border: 0; border-radius: 11px; padding: 13px 16px; background: #75efa4; color: #082014; font-weight: 800; }
    form > button { width: 100%; margin-top: 24px; }
    .credentials { margin-top: 24px; padding: 14px; border-radius: 12px; background: #10271e; color: #bfe7d1; font-size: 14px; line-height: 1.6; }
    .error { min-height: 24px; margin: 12px 0 0; color: #ff8791; font-size: 14px; }
    .app { min-height: 100vh; }
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 18px clamp(20px, 5vw, 64px); border-bottom: 1px solid #1e382e; background: rgba(7, 16, 13, .9); }
    .ghost { width: auto; padding: 10px 14px; border: 1px solid #365a4b; background: transparent; color: #dceee5; }
    main { width: min(1120px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0; }
    .hero { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
    .hero h1 { margin: 0 0 8px; }
    .hero button { white-space: nowrap; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 36px 0; }
    .card { padding: 22px; border: 1px solid #274438; border-radius: 16px; background: #0b1914; }
    .stat { margin-top: 8px; font-size: 30px; font-weight: 850; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { padding: 15px 10px; border-bottom: 1px solid #254036; text-align: left; }
    th { color: #91aa9f; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; }
    .passed { color: #75efa4; }
    .running { color: #ffd36e; }
    .notice { margin-top: 16px; min-height: 24px; color: #75efa4; }
    @media (max-width: 700px) { .stats { grid-template-columns: 1fr; } .hero { align-items: start; flex-direction: column; } .login { padding: 26px; } }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    const demoEmail = 'demo@e2ebuddy.dev';
    const demoPassword = 'DemoPass123!';
    const app = document.querySelector('#app');

    function renderLogin() {
      document.title = 'Sign in · BuddyBoard Demo';
      history.replaceState({}, '', '/demo/login');
      app.innerHTML = '<div class="shell"><section class="login" aria-labelledby="login-title">' +
        '<div class="logo"><span class="logo-mark">B</span>BuddyBoard</div>' +
        '<h1 id="login-title">Welcome back</h1><p class="muted">Sign in to manage your automated acceptance test runs.</p>' +
        '<form id="login-form"><label>Email address<input name="email" type="email" autocomplete="username" required></label>' +
        '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
        '<p id="login-error" class="error" role="alert" aria-live="polite"></p><button type="submit">Sign in</button></form>' +
        '<aside class="credentials" aria-label="Demo credentials"><strong>Demo account</strong><br>Email: demo@e2ebuddy.dev<br>Password: DemoPass123!</aside>' +
        '</section></div>';
      document.querySelector('#login-form').addEventListener('submit', function (event) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (data.get('email') !== demoEmail || data.get('password') !== demoPassword) {
          document.querySelector('#login-error').textContent = 'Email or password is incorrect.';
          return;
        }
        sessionStorage.setItem('buddyboard-authenticated', 'true');
        renderDashboard();
      });
    }

    function renderDashboard() {
      document.title = 'Dashboard · BuddyBoard Demo';
      history.replaceState({}, '', '/demo/dashboard');
      app.innerHTML = '<div class="app"><header class="topbar"><div class="logo"><span class="logo-mark">B</span>BuddyBoard</div>' +
        '<button id="logout" class="ghost">Log out</button></header><main>' +
        '<section class="hero"><div><p class="muted">Sunday, July 19</p><h1>Good morning, Demo User</h1><p class="muted">Your acceptance testing workspace is healthy.</p></div>' +
        '<button id="new-run">Create test run</button></section>' +
        '<section class="stats" aria-label="Workspace statistics"><article class="card"><span class="muted">Total runs</span><div id="run-count" class="stat">24</div></article>' +
        '<article class="card"><span class="muted">Pass rate</span><div class="stat">92%</div></article>' +
        '<article class="card"><span class="muted">Issues found</span><div class="stat">7</div></article></section>' +
        '<section class="card"><h2>Recent test runs</h2><table><thead><tr><th>Product</th><th>Status</th><th>Health</th></tr></thead>' +
        '<tbody id="runs"><tr><td>Checkout redesign</td><td class="passed">Passed</td><td>96</td></tr>' +
        '<tr><td>Account settings</td><td class="passed">Passed</td><td>88</td></tr></tbody></table>' +
        '<p id="notice" class="notice" role="status" aria-live="polite"></p></section></main></div>';
      document.querySelector('#logout').addEventListener('click', function () {
        sessionStorage.removeItem('buddyboard-authenticated');
        renderLogin();
      });
      document.querySelector('#new-run').addEventListener('click', function () {
        const runCount = document.querySelector('#run-count');
        const nextRunNumber = Number(runCount.textContent) + 1;
        const row = document.createElement('tr');
        row.innerHTML = '<td>New demo run #' + nextRunNumber + '</td><td class="running">Running</td><td>—</td>';
        document.querySelector('#runs').prepend(row);
        runCount.textContent = String(nextRunNumber);
        document.querySelector('#notice').textContent = 'Test run created successfully.';
      });
    }

    if (sessionStorage.getItem('buddyboard-authenticated') === 'true') renderDashboard();
    else renderLogin();
  </script>
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
    if (request.url === '/demo' || request.url === '/demo/login' || request.url === '/demo/dashboard') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(loginDemoHtml);
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
