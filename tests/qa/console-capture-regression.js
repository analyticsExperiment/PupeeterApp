const assert = require('node:assert/strict');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { auditDomain: puppeteerAudit } = require('../../src/audit/auditRunner');
const { auditDomain: playwrightAudit } = require('../../src/audit/playwrightRunner');
const { populateConsoleText } = require('../../src/audit/runnerShared');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') {
      res.end('<script>console.info("qa-frame-message");</script>');
      return;
    }
    if (req.url === '/second') {
      res.end('<title>Second</title><script>console.info("qa-second-page");</script>');
      return;
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.end(`<!doctype html><title>Console regression</title>
      <iframe src="/frame"></iframe><a href="/second">Second page</a>
      <script>
        console.log('qa-once');
        console.info('qa-repeat');
        console.info('qa-repeat');
        console.warn('qa-warning');
        console.error('qa-console-error');
        console.debug('qa-debug');
        console.log('qa-object', { nested: { value: 42 } });
        console.log('qa-formatted %s', 'value');
        setTimeout(() => { throw new Error('qa-runtime-error'); }, 20);
        setTimeout(() => Promise.reject(new Error('qa-rejection')), 30);
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

for (const [engine, audit] of [['puppeteer', puppeteerAudit], ['playwright', playwrightAudit]]) {
  test(`${engine}: console events are exact, structured and isolated across pages`, { timeout: 60000 }, async () => {
    const logs = [];
    const result = await audit({
      domain: baseUrl,
      maxPages: 2,
      headless: true,
      autoDismissConsent: false,
      findPagesInSitemaps: false,
      navigationTimeoutMs: 10000,
      postAuditActions: [{ action: 'executeJavaScript', value: "console.info('qa-post-action');" }],
      rules: [{
        name: 'Console remains available for evaluation',
        evaluationLimit: 50,
        assertions: [{ type: 'console', operator: 'contains', value: 'qa-post-action' }]
      }]
    }, () => {}, (entry) => logs.push(entry));
    assert.equal(result.pages.length, 2);
    const first = result.pages.find((page) => page.finalUrl === `${baseUrl}/`);
    const second = result.pages.find((page) => page.finalUrl === `${baseUrl}/second`);
    assert.ok(first && second);
    const count = (fragment) => first.console.filter((entry) => entry.text.includes(fragment)).length;
    assert.equal(count('qa-once'), 1, 'a single call must produce one report entry');
    assert.equal(count('qa-repeat'), 2, 'genuine repeated calls must not be deduplicated');
    for (const fragment of ['qa-warning', 'qa-console-error', 'qa-debug', 'qa-frame-message', 'qa-runtime-error', 'qa-rejection', 'qa-post-action']) {
      assert.equal(count(fragment), 1, fragment);
    }
    assert.equal(count('qa-object'), 1);
    assert.ok(first.console.find((entry) => entry.text.includes('qa-object')).text.includes('"value":42'), 'structured argument contents remain available');
    assert.deepEqual(second.console.map((entry) => entry.text), ['qa-second-page', 'qa-post-action']);
    assert.deepEqual(first.console.filter((entry) => entry.text.includes('qa-formatted')).map((entry) => entry.text),
      ['qa-formatted %s value'], 'native console-event text is retained for primitive arguments');
    assert.equal(first.console.length, 12);
    assert.equal(result.summary.consoleMessages, 14);
    assert.equal(result.summary.consoleErrors, 3);
    assert.equal(result.summary.ruleFailures, 0);
    assert.equal(result.summary.rulePasses, 2);
    assert.ok(first.console.every((entry) => typeof entry.type === 'string' && Number.isFinite(entry.ts)));
    assert.equal(logs.at(-1).msg, 'Browser closed');
  });
}

test('console retains native text when argument serialization fails', async () => {
  const entry = { text: 'original browser text' };
  await populateConsoleText({ args: () => [{ jsonValue: async () => { throw new Error('context closed'); } }] }, entry);
  assert.equal(entry.text, 'original browser text');
});

test('console retains native text for browser-generated events without arguments', async () => {
  const entry = { text: 'resource failed' };
  await populateConsoleText({ args: () => [] }, entry);
  assert.equal(entry.text, 'resource failed');
});
