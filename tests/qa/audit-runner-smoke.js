const http = require('http');
const assert = require('node:assert/strict');
const { auditDomain: auditWithPuppeteer } = require('../../src/audit/auditRunner');
const { auditDomain: auditWithPlaywright } = require('../../src/audit/playwrightRunner');

const port = Number(process.env.QA_RUNNER_TARGET_PORT || 4577);
const baseUrl = `http://127.0.0.1:${port}`;

function pageHtml(title) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <h1>${title}</h1>
    <button id="acceptCookies">Accept</button>
    <a href="/page-2">Page Two</a>
    <script>
      document.cookie = 'qa_session=runner; path=/';
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'qa_runner_view' });
      console.info('qa runner page loaded');
      fetch('/pixel?event=' + encodeURIComponent(location.pathname));
      document.getElementById('acceptCookies')?.addEventListener('click', () => {
        window.dataLayer.push({ event: 'qa_runner_accept' });
        document.getElementById('acceptCookies').style.display = 'none';
      });
    </script>
  </body></html>`;
}

function startTarget() {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt' || req.url === '/sitemap.xml') {
      if (String(req.headers['user-agent'] || '').includes('FreeAudit/1.0')) {
        res.writeHead(403);
        res.end('Denied to standalone fetch');
        return;
      }
      res.writeHead(200, { 'Content-Type': req.url === '/robots.txt' ? 'text/plain' : 'application/xml' });
      res.end(req.url === '/robots.txt'
        ? `User-agent: *\nSitemap: ${baseUrl}/sitemap.xml\n`
        : `<?xml version="1.0"?><urlset><url><loc>${baseUrl}/sitemap-only</loc></url><url><loc>${baseUrl}/blocked</loc></url></urlset>`);
      return;
    }
    if (req.url === '/blocked') {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Access Denied</title>');
      return;
    }
    if (req.url === '/sitemap-home' || req.url === '/sitemap-only' || req.url === '/early-only') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><title>${req.url}</title>`);
      return;
    }
    if (req.url === '/early-home') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Early Links</title><a href="/early-only">Next</a><script>setTimeout(() => { location.href = "/blocked"; }, 800)</script>');
      return;
    }
    if (req.url.startsWith('/pixel')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const title = req.url.startsWith('/page-2') ? 'QA Runner Page Two' : 'QA Runner Home';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml(title));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function runDiscoveryRegression(name, runner) {
  const sitemapLogs = [];
  const sitemapResult = await runner({
    domain: `${baseUrl}/sitemap-home`,
    maxPages: 3,
    sameOriginOnly: true,
    headless: true,
    findPagesInSitemaps: true,
    autoDismissConsent: false,
    rules: [],
  }, () => {}, (log) => sitemapLogs.push(log));
  assert.equal(sitemapResult.pages.length, 3, 'browser-readable sitemap should seed two additional pages');
  assert.equal(sitemapLogs.find((log) => log.msg === 'Sitemap discovery completed')?.discovered, 2);
  assert.equal(sitemapResult.pages.find((page) => page.initialUrl === `${baseUrl}/blocked`)?.error, 'Final document returned HTTP 403');
  assert.equal(sitemapResult.summary.errors, 1);

  const earlyResult = await runner({
    domain: `${baseUrl}/early-home`,
    maxPages: 2,
    sameOriginOnly: true,
    headless: true,
    waitUntil: 'networkidle2',
    findPagesInSitemaps: false,
    autoDismissConsent: false,
    rules: [],
  });
  assert.equal(earlyResult.pages.length, 2, 'links found before a later denial should remain in the crawl queue');
  assert.equal(earlyResult.pages[0].finalStatusCode, 403);
  assert.equal(earlyResult.pages[0].linksFound, 1);
  console.log(JSON.stringify({ engine: name, regression: 'sitemap and early links', sitemapPages: sitemapResult.pages.length, earlyPages: earlyResult.pages.length }));
}

async function runOne(name, runner) {
  const logs = [];
  const started = Date.now();
  let lastProgress = null;
  const runPromise = runner({
    domain: baseUrl,
    maxPages: 2,
    maxDepth: null,
    sameOriginOnly: true,
    headless: true,
    waitUntil: 'domcontentloaded',
    findPagesInSitemaps: false,
    preAuditActions: [
      { action: 'waitForSelector', selector: '#acceptCookies', timeout: 5000 },
      { action: 'click', selector: '#acceptCookies', timeout: 5000 }
    ],
    postAuditActions: [
      { action: 'executeJavaScript', value: "window.dataLayer.push({event:'qa_runner_post'});" }
    ],
    rules: [
      {
        name: 'Runner title passes',
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: baseUrl }],
        assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'QA Runner' }]
      }
    ]
  }, (progress) => { lastProgress = progress; }, (log) => logs.push(log));
  const results = await Promise.race([
    runPromise,
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error(`${name} timed out. Last progress: ${JSON.stringify(lastProgress)}. Last logs: ${JSON.stringify(logs.slice(-12))}`));
    }, Number(process.env.QA_RUNNER_TIMEOUT_MS || 45000)))
  ]);
  const durationMs = Date.now() - started;
  if (!results || !Array.isArray(results.pages) || results.pages.length < 1) {
    throw new Error(`${name} did not return page results`);
  }
  assert.equal(results.pages.length, 2, `${name} should discover and audit a second page without explicit URLs`);
  assert.equal(results.summary.pageTarget, 2);
  assert.equal(results.summary.targetMet, true);
  assert.equal(results.summary.crawlStopReason, 'target-reached');
  console.log(JSON.stringify({
    engine: name,
    durationMs,
    pages: results.pages.length,
    networkRequests: results.summary.networkRequests,
    consoleMessages: results.summary.consoleMessages,
    ruleFailures: results.summary.ruleFailures,
    lastLog: logs[logs.length - 1] || null
  }));
}

(async () => {
  const server = await startTarget();
  try {
    await runOne('puppeteer', auditWithPuppeteer);
    await runOne('playwright', auditWithPlaywright);
    await runDiscoveryRegression('puppeteer', auditWithPuppeteer);
    await runDiscoveryRegression('playwright', auditWithPlaywright);
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
