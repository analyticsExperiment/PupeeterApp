const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const auditStore = require('./src/db');
const { hashPassword, verifyPasswordHash } = require('./src/auth/passwords');
const { auditDomain: auditDomainWithPuppeteer } = require('./src/audit/auditRunner');
const { auditDomain: auditDomainWithPlaywright } = require('./src/audit/playwrightRunner');
const { assembleAuditPayload, buildConfigSnapshot } = require('./src/audit/configAssembler');
const { startUrlForConfig, sanitizePage, buildAttachedResults } = require('./src/audit/attachedAudit');
const { getRuleTagOptions } = require('./src/audit/tagCatalog');
const { runInteraction } = require('./src/interaction/interactionRunner');
const {
  buildAgentSchema,
  createAgentAudit,
  createAgentInteraction
} = require('./src/api/agentOrchestrator');
const https = require('https');
const http = require('http');

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const USERS = [
  { username: ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD || 'audit123', displayName: 'Administrator' }
];

const app = express();
const PORT = process.env.PORT || 3000;

app.use(session({
  name: 'audit.sid',
  secret: process.env.SESSION_SECRET || 'audit-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, sameSite: 'lax' }
}));

app.use(express.json({ limit: '1mb' }));
app.use(cors());
// Respect reverse proxies/load balancers for IP detection
// This enables Express to use X-Forwarded-For when present.
app.set('trust proxy', true);

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function normalizeAuthUsername(username) {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase();
}

function findUser(username) {
  const normalized = normalizeAuthUsername(username);
  if (!normalized) return null;

  const storedUser = auditStore.getUser(normalized);
  if (storedUser) {
    return {
      username: storedUser.username,
      displayName: storedUser.displayName || storedUser.username,
      passwordHash: storedUser.passwordHash
    };
  }

  return USERS.find((u) => u.username === normalized) || null;
}

function verifyPassword(user, password) {
  if (!user) return false;
  if (user.passwordHash) {
    return verifyPasswordHash(password, user.passwordHash);
  }
  return String(user.password) === String(password);
}

function currentUser(req) {
  return req.session?.user || null;
}

function currentUsername(req) {
  return currentUser(req)?.username || 'guest';
}

function requireAuthPage(req, res, next) {
  if (currentUser(req)) return next();
  setNoStore(res);
  return res.redirect('/login');
}

function requireAuthJson(req, res, next) {
  if (currentUser(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function requireExtensionAuth(req, res, next) {
  const token = bearerToken(req);
  const resolved = auditStore.getUserForExtensionToken(token);
  if (!resolved) return res.status(401).json({ error: 'Invalid or missing extension pairing token' });
  req.extensionUser = { username: resolved.username, token: resolved.token };
  return next();
}

function extensionUsername(req) {
  return req.extensionUser?.username || 'guest';
}

// Function to get geo location data
async function getGeoLocation(ip) {
  return new Promise((resolve) => {
    // Skip geo lookup for localhost/private IPs
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      resolve({ country: 'Local', city: 'Local', region: 'Local', timezone: 'Local' });
      return;
    }

    const options = {
      hostname: 'ipinfo.io',
      path: `/${ip}/json`,
      method: 'GET',
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const geoData = JSON.parse(data);
          resolve({
            country: geoData.country || 'Unknown',
            city: geoData.city || 'Unknown',
            region: geoData.region || 'Unknown',
            timezone: geoData.timezone || 'Unknown',
            org: geoData.org || 'Unknown'
          });
        } catch (err) {
          resolve({ country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' });
        }
      });
    });

    req.on('error', () => {
      resolve({ country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' });
    });

    req.end();
  });
}

// Function to capture request headers information
function captureRequestHeaders(req) {
  const hdr = (k) => (req.headers[k.toLowerCase()] ?? req.headers[k] ?? '');
  const forwarded = hdr('x-forwarded-for');
  const realIp = hdr('x-real-ip') || hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('fastly-client-ip') || hdr('x-client-ip');
  const remote = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || req.ip || '';

  // Parse first candidate from X-Forwarded-For chain
  let clientIp = '';
  if (forwarded) {
    clientIp = String(forwarded).split(',')[0].trim();
  }
  if (!clientIp) clientIp = realIp || '';
  if (!clientIp) clientIp = remote || '';

  const out = {
    ipAddress: clientIp || 'Unknown',
    ipChain: forwarded ? String(forwarded).split(',').map((s) => s.trim()) : undefined,
    protocol: req.protocol,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    userAgent: hdr('user-agent') || 'Unknown',
    acceptLanguage: hdr('accept-language') || 'Unknown',
    acceptEncoding: hdr('accept-encoding') || 'Unknown',
    referer: hdr('referer') || hdr('referrer') || 'Direct',
    host: hdr('host') || 'Unknown',
    connection: hdr('connection') || 'Unknown',
    timestamp: new Date().toISOString(),
    allHeaders: { ...req.headers },
  };
  return out;
}

// In-memory job store (simple)
const jobs = new Map();
const interactionJobs = new Map();
function ensureJob(id, username) {
  const j = jobs.get(id);
  if (!j) return null;
  if (username && j.username && j.username !== username) return null;
  return j;
}

function ensureInteractionJob(id, username) {
  const job = interactionJobs.get(id);
  if (!job) return null;
  if (username && job.username && job.username !== username) return null;
  return job;
}

function getStoredAudit(id, username) {
  try {
    return auditStore.getAudit(id, username);
  } catch (err) {
    console.error('Failed to load saved audit', err);
    return null;
  }
}

function getCompletedResults(id, username) {
  const job = ensureJob(id, username);
  if (job) {
    if (job.status !== 'completed') return { status: job.status, results: null, error: job.error || null };
    const results = job.results || {};
    if (!results.requestHeaders && job.requestHeaders) {
      results.requestHeaders = job.requestHeaders;
    }
    return { status: 'completed', results, error: null };
  }
  const stored = getStoredAudit(id, username);
  if (!stored) return { status: 'missing', results: null, error: null };
  if (stored.status !== 'completed' || !stored.results) {
    return { status: stored.status, results: stored.results || null, error: stored.error || null };
  }
  const results = stored.results || {};
  if (!results.requestHeaders && stored.requestHeaders) {
    results.requestHeaders = stored.requestHeaders;
  }
  return { status: 'completed', results, error: null };
}

function pushLog(job, entry) {
  const e = { ts: Date.now(), level: 'info', msg: '', ...entry };
  job.logs.push(e);
  // keep last 2000
  if (job.logs.length > 2000) job.logs.splice(0, job.logs.length - 2000);
  for (const res of job.sseClients) {
    try {
      res.write(`event: log\n`);
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch (_) {}
  }
}

function getCompletedInteractionResults(id, username) {
  const job = ensureInteractionJob(id, username);
  if (job) {
    if (job.status !== 'completed') return { status: job.status, results: job.results || null, error: job.error || null };
    return { status: 'completed', results: job.results || null, error: null };
  }
  const stored = auditStore.getInteractionRun(id, username);
  if (!stored) return { status: 'missing', results: null, error: null };
  if (stored.status !== 'completed' || !stored.results) {
    return { status: stored.status, results: stored.results || null, error: stored.error || null };
  }
  return { status: 'completed', results: stored.results || null, error: null };
}

function sendJsonError(res, status, message, details) {
  const payload = { error: message || 'Request failed' };
  if (details !== undefined) payload.details = details;
  return res.status(status).json(payload);
}

function sanitizeAuditPayload(body = {}) {
  const { configId, configSnapshot, ...payload } = body || {};
  return payload;
}

function normalizeWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle0' || normalized === 'networkidle') return 'networkidle2';
  if (['domcontentloaded', 'load', 'networkidle2'].includes(normalized)) return normalized;
  return 'domcontentloaded';
}

function normalizeBrowserEngine(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'playwright' ? 'playwright' : 'puppeteer';
}

function getAuditRunner(browserEngine) {
  return normalizeBrowserEngine(browserEngine) === 'playwright'
    ? { engine: 'playwright', run: auditDomainWithPlaywright }
    : { engine: 'puppeteer', run: auditDomainWithPuppeteer };
}

function validateAuditPayload(payload = {}) {
  const domain = String(payload.domain || '').trim();
  const startingUrls = Array.isArray(payload.startingUrls) ? payload.startingUrls : [];
  if (!domain && !startingUrls.length) {
    return 'Please enter a domain/URL or provide at least one starting URL.';
  }
  return null;
}

function summarizeConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    name: config.name,
    description: config.description || '',
    domain: config.domain || '',
    maxPages: config.maxPages,
    maxDepth: config.maxDepth == null ? null : config.maxDepth,
    sameOriginOnly: config.sameOriginOnly !== false,
    waitUntil: normalizeWaitUntil(config.waitUntil),
    showBrowser: config.showBrowser !== false,
    browserEngine: normalizeBrowserEngine(config.options?.browserEngine),
    workerMode: config.options?.workerMode || 'ram-protected',
    simultaneousWorkers: config.options?.simultaneousWorkers || 2,
    urlSources: Array.isArray(config.urlSources) ? config.urlSources : [],
    includeSitemaps: config.includeSitemaps !== false,
    options: config.options || {},
    isDefault: Boolean(config.isDefault),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    auditCount: config.auditCount || 0,
    preActionTemplates: config.preActionTemplates || [],
    postActionTemplates: config.postActionTemplates || [],
    ruleSets: config.ruleSets || []
  };
}

function summarizeInteractionConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    name: config.name,
    description: config.description || '',
    startingUrl: config.startingUrl || '',
    waitUntil: normalizeWaitUntil(config.waitUntil),
    showBrowser: config.showBrowser !== false,
    generalSettings: config.generalSettings || {},
    steps: Array.isArray(config.steps) ? config.steps : [],
    flowTemplates: config.flowTemplates || [],
    ruleSets: config.ruleSets || [],
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    runCount: config.runCount || 0,
    lastRunStatus: config.lastRunStatus || null,
    lastRunAt: config.lastRunAt || null
  };
}

function buildInteractionConfigSnapshot(config) {
  return {
    id: config.id,
    name: config.name,
    description: config.description || '',
    startingUrl: config.startingUrl || '',
    waitUntil: normalizeWaitUntil(config.waitUntil),
    showBrowser: config.showBrowser !== false,
    generalSettings: config.generalSettings || {},
    steps: Array.isArray(config.steps) ? config.steps : [],
    flowTemplates: (config.flowTemplates || []).map((item) => ({ id: item.id, name: item.name, steps: Array.isArray(item.steps) ? item.steps : [] })),
    ruleSets: (config.ruleSets || []).map((item) => ({ id: item.id, name: item.name, rules: Array.isArray(item.rules) ? item.rules : [] }))
  };
}

function startAuditForUser({ username, payload, requestHeaders, configId = null, configSnapshot = null }) {
  const id = uuidv4();
  const startedAt = Date.now();
  const options = sanitizeAuditPayload(payload || {});

  const validationError = validateAuditPayload(options);
  if (validationError) {
    const err = new Error(validationError);
    err.statusCode = 400;
    throw err;
  }

  auditStore.recordAuditStart({
    id,
    username,
    domain: options.domain || (Array.isArray(options.startingUrls) ? options.startingUrls[0] : '') || '',
    startedAt,
    payload: options,
    requestHeaders,
    configId,
    configSnapshot
  });

  const job = {
    id,
    status: 'running',
    progress: { processed: 0 },
    options,
    startedAt,
    logs: [],
    sseClients: new Set(),
    requestHeaders,
    username,
    configId,
    configSnapshot
  };
  jobs.set(id, job);

  (async () => {
    try {
      pushLog(job, { level: 'info', msg: 'Job started', options, configId });
      try { pushLog(job, { level: 'info', msg: 'Captured request headers', requestHeaders }); } catch (_) {}

      pushLog(job, { level: 'info', msg: 'Fetching geo location data', ip: requestHeaders.ipAddress });
      const geoLocation = await getGeoLocation(requestHeaders.ipAddress);
      job.requestHeaders.geoLocation = geoLocation;
      try {
        auditStore.updateAuditHeaders(id, job.requestHeaders);
      } catch (err) {
        console.error('Failed to update audit headers', err);
      }
      pushLog(job, { level: 'info', msg: 'Geo location data fetched', geoLocation });

      const runner = getAuditRunner(options.browserEngine);
      pushLog(job, { level: 'info', msg: 'Audit engine selected', browserEngine: runner.engine });

      const results = await runner.run(options,
        (p) => { job.progress = p; },
        (log) => pushLog(job, log)
      );

      results.requestHeaders = job.requestHeaders;

      job.status = 'completed';
      job.results = results;
      job.finishedAt = Date.now();
      try {
        auditStore.recordAuditCompletion({
          id,
          completedAt: job.finishedAt,
          results
        });
      } catch (err) {
        console.error('Failed to persist audit completion', err);
      }
      pushLog(job, { level: 'info', msg: 'Job completed', summary: results.summary });
      for (const client of job.sseClients) {
        try {
          client.write(`event: done\n`);
          client.write(`data: {"status":"completed"}\n\n`);
        } catch (_) {}
      }
    } catch (err) {
      job.status = 'failed';
      job.error = (err && (err.message || err.stack)) ? (err.message || err.stack) : String(err);
      job.finishedAt = Date.now();
      try {
        auditStore.recordAuditFailure({
          id,
          completedAt: job.finishedAt,
          error: job.error,
          requestHeaders: job.requestHeaders
        });
      } catch (dbErr) {
        console.error('Failed to persist audit failure', dbErr);
      }
      pushLog(job, { level: 'error', msg: 'Job failed', error: job.error });
      for (const client of job.sseClients) {
        try {
          client.write(`event: done\n`);
          client.write(`data: {"status":"failed"}\n\n`);
        } catch (_) {}
      }
    }
  })();

  return { id, job };
}

function startInteractionForUser({ username, config }) {
  const id = uuidv4();
  const startedAt = Date.now();
  const configSnapshot = buildInteractionConfigSnapshot(config);
  auditStore.recordInteractionRunStart({
    id,
    username,
    interactionConfigId: config.id || null,
    configSnapshot,
    startedAt
  });

  const job = {
    id,
    username,
    status: 'running',
    progress: { processed: 0, total: Array.isArray(configSnapshot.steps) ? configSnapshot.steps.length : 0, progress: 0 },
    startedAt,
    finishedAt: null,
    configSnapshot,
    logs: [],
    sseClients: new Set(),
    results: null,
    error: null
  };
  interactionJobs.set(id, job);

  (async () => {
    try {
      pushLog(job, { level: 'info', msg: 'Interaction run started', configId: config.id, configName: config.name });
      const results = await runInteraction(config, (progress) => {
        job.progress = progress;
        try {
          auditStore.updateInteractionRunProgress(id, username, progress.progress || progress.processed || 0);
        } catch (_) {}
      }, (log) => pushLog(job, log));

      job.status = results.status === 'failed' ? 'failed' : 'completed';
      job.results = results;
      job.finishedAt = Date.now();
      if (job.status === 'failed') {
        const failedStep = results.steps?.find((step) => step.status === 'failed');
        job.error = failedStep ? `Step ${failedStep.stepNumber} (${failedStep.stepName}) failed: ${failedStep.error}` : 'One or more interaction rules failed';
        auditStore.recordInteractionRunFailure({ id, username, completedAt: job.finishedAt, error: job.error, results });
      } else {
        auditStore.recordInteractionRunCompletion({ id, username, completedAt: job.finishedAt, results });
      }
      pushLog(job, { level: job.status === 'failed' ? 'warn' : 'info', msg: 'Interaction run finished', status: job.status, summary: results.summary });
      for (const client of job.sseClients) {
        try {
          client.write(`event: done\n`);
          client.write(`data: ${JSON.stringify({ status: job.status })}\n\n`);
        } catch (_) {}
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err && err.message ? err.message : String(err);
      job.finishedAt = Date.now();
      try {
        auditStore.recordInteractionRunFailure({ id, username, completedAt: job.finishedAt, error: job.error, results: job.results || null });
      } catch (_) {}
      pushLog(job, { level: 'error', msg: 'Interaction run failed', error: job.error });
      for (const client of job.sseClients) {
        try {
          client.write(`event: done\n`);
          client.write(`data: ${JSON.stringify({ status: 'failed', error: job.error })}\n\n`);
        } catch (_) {}
      }
    }
  })();

  return { id, job };
}

app.get('/api/auth/csrf', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = uuidv4();
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.get(['/login', '/login.html'], (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  setNoStore(res);
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/register', '/register.html', '/signup', '/signup.html'], (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  setNoStore(res);
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.post('/auth/login', (req, res) => {
  const username = normalizeAuthUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findUser(username);
  if (!verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error('Failed to regenerate session', err);
      return res.status(500).json({ error: 'Failed to initialize session' });
    }
    req.session.user = { username: user.username, displayName: user.displayName || user.username };
    setNoStore(res);
    res.json({ ok: true, user: req.session.user });
  });
});

app.post('/auth/register', (req, res) => {
  const username = normalizeAuthUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || '').trim();

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!/^[a-z0-9_.-]{3,32}$/i.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 chars and use letters, numbers, ., _, or -' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (findUser(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  try {
    const passwordHash = hashPassword(password);
    const created = auditStore.createUser({
      username,
      passwordHash,
      displayName: displayName || username
    });

    req.session.regenerate((err) => {
      if (err) {
        console.error('Failed to regenerate session after register', err);
        return res.status(500).json({ error: 'Failed to initialize session' });
      }
      req.session.user = {
        username: created.username,
        displayName: created.displayName || created.username
      };
      setNoStore(res);
      res.status(201).json({ ok: true, user: req.session.user });
    });
  } catch (err) {
    console.error('Failed to register user', err);
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/auth/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('audit.sid', { path: '/', httpOnly: true, sameSite: 'lax' });
    setNoStore(res);
    return res.json({ ok: true });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Failed to destroy session', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('audit.sid', { path: '/', httpOnly: true, sameSite: 'lax' });
    setNoStore(res);
    res.json({ ok: true });
  });
});

app.get(['/auth/me', '/api/auth/me'], requireAuthJson, (req, res) => {
  setNoStore(res);
  res.json({ user: currentUser(req) });
});

app.get('/', requireAuthPage, (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', requireAuthPage, (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/audits.html', requireAuthPage, (req, res) => {
  setNoStore(res);
  res.sendFile(path.join(__dirname, 'public', 'audits.html'));
});

app.get(['/dashboard.html', '/create-audit.html', '/audit-configs.html', '/action-templates.html', '/rule-sets.html', '/interaction-configs.html', '/interaction-flow-templates.html', '/interaction-report.html', '/interaction-runs.html', '/settings.html'], requireAuthPage, (req, res) => {
  setNoStore(res);
  const requested = path.basename(req.path);
  const fileName = requested === 'create-audit.html' ? 'index.html' : requested;
  res.sendFile(path.join(__dirname, 'public', fileName));
});

app.post('/api/audit/start', requireAuthJson, async (req, res) => {
  try {
    const body = req.body || {};
    const username = currentUsername(req);
    let configId = body.configId || null;
    let configSnapshot = null;
    if (configId) {
      const config = auditStore.getAuditConfig(configId, username);
      if (!config) return sendJsonError(res, 404, 'Audit config not found');
      configSnapshot = body.configSnapshot || buildConfigSnapshot(config, sanitizeAuditPayload(body));
    }
    const { id } = startAuditForUser({
      username,
      payload: body,
      requestHeaders: captureRequestHeaders(req),
      configId,
      configSnapshot
    });
    res.json({ id });
  } catch (err) {
    console.error('Failed to start audit', err);
    return sendJsonError(res, err.statusCode || 500, err.message || 'Failed to start audit');
  }
});

// Health endpoint to quickly confirm server code version and route presence
app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasLogsRoute: true, time: Date.now() });
});

app.get('/api/tag-catalog', requireAuthJson, (req, res) => {
  try {
    res.json({ ruleOptions: getRuleTagOptions() });
  } catch (err) {
    console.error('Failed to load tag catalog', err);
    res.status(500).json({ error: 'Failed to load tag catalog' });
  }
});

app.get('/api/extension/status', requireExtensionAuth, (req, res) => {
  res.json({
    ok: true,
    user: { username: extensionUsername(req) },
    token: req.extensionUser.token
  });
});

app.delete('/api/extension/current-token', requireExtensionAuth, (req, res) => {
  try {
    auditStore.revokeExtensionToken(req.extensionUser.token.id, extensionUsername(req));
    res.json({ ok: true });
  } catch (err) {
    sendJsonError(res, 500, 'Failed to disconnect extension');
  }
});

app.get('/api/extension/audit-configs', requireExtensionAuth, (req, res) => {
  try {
    const configs = auditStore.listAuditConfigs(extensionUsername(req)).map((config) => ({
      id: config.id, name: config.name, domain: config.domain,
      startingUrl: config.urlSources?.[0] || config.domain,
      maxPages: config.maxPages, isDefault: config.isDefault,
      urlSourceCount: config.urlSources?.length || 0,
      includeSitemaps: config.includeSitemaps !== false
    }));
    res.json({ configs });
  } catch (err) {
    sendJsonError(res, 500, 'Failed to load audit configs');
  }
});

app.post('/api/extension/attached-audits', requireExtensionAuth, (req, res) => {
  try {
    const config = auditStore.getAuditConfig(req.body?.configId, extensionUsername(req));
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    const assembled = assembleAuditPayload(config);
    const startUrl = startUrlForConfig(assembled);
    const maxPages = Math.min(100, Math.max(1, Number.parseInt(assembled.maxPages, 10) || 15));
    const autoCrawl = req.body?.autoCrawl === true;
    const payload = { ...assembled, maxPages, browserEngine: 'attached-chrome', attachedMode: true, autoCrawl };
    const id = uuidv4();
    auditStore.recordAuditStart({
      id, username: extensionUsername(req), domain: startUrl, startedAt: Date.now(),
      payload, requestHeaders: {}, configId: config.id,
      configSnapshot: { ...buildConfigSnapshot(config, payload), captureMode: 'attached-chrome' }
    });
    res.status(201).json({ id, startUrl, maxPages, configName: config.name,
      autoCrawl, startingUrls: assembled.startingUrls, includeSitemaps: assembled.findPagesInSitemaps });
  } catch (err) {
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to start attached audit');
  }
});

function getRunningAttachedAudit(req, res) {
  const audit = auditStore.getAudit(req.params.id, extensionUsername(req));
  if (!audit) { sendJsonError(res, 404, 'Attached audit not found'); return null; }
  if (!audit.payload?.attachedMode) { sendJsonError(res, 400, 'Not an attached audit'); return null; }
  if (audit.status !== 'running') { sendJsonError(res, 409, 'Attached audit is no longer running'); return null; }
  return audit;
}

app.get('/api/extension/attached-audits/:id', requireExtensionAuth, (req, res) => {
  const audit = auditStore.getAudit(req.params.id, extensionUsername(req));
  if (!audit || !audit.payload?.attachedMode) return sendJsonError(res, 404, 'Attached audit not found');
  res.json({ id: audit.id, status: audit.status, pageCount: audit.results?.pages?.length || 0,
    maxPages: audit.payload.maxPages, startUrl: startUrlForConfig(audit.payload) });
});

app.post('/api/extension/attached-audits/:id/pages', requireExtensionAuth, (req, res) => {
  try {
    const audit = getRunningAttachedAudit(req, res);
    if (!audit) return;
    const page = sanitizePage(req.body, startUrlForConfig(audit.payload));
    const pages = audit.results?.pages || [];
    if (pages.some((item) => item.pageId === page.pageId)) {
      return res.json({ ok: true, pageCount: pages.length, duplicate: true });
    }
    if (pages.length >= audit.payload.maxPages) return sendJsonError(res, 409, 'Configured page limit reached');
    const results = buildAttachedResults([...pages, page], audit.payload, audit.requestHeaders);
    auditStore.recordAuditProgress({ id: audit.id, results });
    res.json({ ok: true, pageCount: results.pages.length, maxPages: audit.payload.maxPages });
  } catch (err) {
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to save captured page');
  }
});

app.post('/api/extension/attached-audits/:id/finish', requireExtensionAuth, (req, res) => {
  try {
    const audit = getRunningAttachedAudit(req, res);
    if (!audit) return;
    const allowedReasons = new Set(['target-reached', 'no-more-discoverable-pages', 'site-denied-access', 'manual-stop']);
    const stopReason = allowedReasons.has(req.body?.stopReason) ? req.body.stopReason : 'manual-stop';
    const results = buildAttachedResults(audit.results?.pages || [], audit.payload, audit.requestHeaders,
      { stopReason, discoveredCandidateCount: req.body?.discoveredCandidateCount });
    auditStore.recordAuditCompletion({ id: audit.id, completedAt: Date.now(), results });
    res.json({ id: audit.id, status: 'completed', pageCount: results.pages.length,
      reportUrl: `/?auditId=${encodeURIComponent(audit.id)}` });
  } catch (err) {
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to finish attached audit');
  }
});

app.get('/api/extension/tokens', requireAuthJson, (req, res) => {
  try {
    res.json({ tokens: auditStore.listExtensionTokens(currentUsername(req)) });
  } catch (err) {
    console.error('Failed to list extension tokens', err);
    sendJsonError(res, 500, 'Failed to list extension tokens');
  }
});

app.post('/api/extension/tokens', requireAuthJson, (req, res) => {
  try {
    const token = auditStore.createExtensionToken(currentUsername(req), req.body || {});
    res.status(201).json({ token: token.token, tokenRecord: { ...token, token: undefined } });
  } catch (err) {
    console.error('Failed to create extension token', err);
    sendJsonError(res, 500, 'Failed to create extension token');
  }
});

app.delete('/api/extension/tokens/:id', requireAuthJson, (req, res) => {
  try {
    if (!auditStore.revokeExtensionToken(req.params.id, currentUsername(req))) {
      return sendJsonError(res, 404, 'Extension token not found');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to revoke extension token', err);
    sendJsonError(res, 500, 'Failed to revoke extension token');
  }
});

app.post('/api/extension/interaction-flow-template', requireExtensionAuth, (req, res) => {
  try {
    const template = auditStore.createFlowTemplate(extensionUsername(req), {
      name: req.body?.name,
      description: req.body?.description || 'Saved from Free Audit Recorder',
      steps: Array.isArray(req.body?.steps) ? req.body.steps : []
    });
    res.status(201).json({ template });
  } catch (err) {
    logUnexpectedAgentError('Failed to save extension flow template', err);
    sendJsonError(res, err.statusCode || 400, err.message || 'Failed to save interaction flow template');
  }
});

app.post('/api/extension/interaction-config', requireExtensionAuth, (req, res) => {
  try {
    const config = auditStore.createInteractionConfig(extensionUsername(req), {
      name: req.body?.name,
      description: req.body?.description || 'Saved from Free Audit Recorder',
      startingUrl: req.body?.startingUrl || req.body?.starting_url,
      waitUntil: req.body?.waitUntil || 'domcontentloaded',
      showBrowser: req.body?.showBrowser !== false,
      generalSettings: req.body?.generalSettings && typeof req.body.generalSettings === 'object' ? req.body.generalSettings : { browserEngine: 'playwright' },
      steps: Array.isArray(req.body?.steps) ? req.body.steps : [],
      flowTemplateIds: Array.isArray(req.body?.flowTemplateIds) ? req.body.flowTemplateIds : [],
      ruleSetIds: Array.isArray(req.body?.ruleSetIds) ? req.body.ruleSetIds : []
    });
    res.status(201).json({ config: summarizeInteractionConfig(config) });
  } catch (err) {
    logUnexpectedAgentError('Failed to save extension interaction config', err);
    sendJsonError(res, err.statusCode || 400, err.message || 'Failed to save interaction config');
  }
});

function auditRunLinks(id) {
  return {
    id,
    statusUrl: `/api/audit/${encodeURIComponent(id)}/status`,
    logsUrl: `/api/audit/${encodeURIComponent(id)}/logs`,
    resultsUrl: `/api/audit/${encodeURIComponent(id)}/results`,
    csvUrl: `/api/audit/${encodeURIComponent(id)}/csv`,
    jsonUrl: `/api/audit/${encodeURIComponent(id)}/json`
  };
}

function interactionRunLinks(id) {
  return {
    id,
    statusUrl: `/api/interaction-runs/${encodeURIComponent(id)}/status`,
    logsUrl: `/api/interaction-runs/${encodeURIComponent(id)}/logs`,
    resultsUrl: `/api/interaction-runs/${encodeURIComponent(id)}/results`,
    csvUrl: `/api/interaction-runs/${encodeURIComponent(id)}/csv`,
    jsonUrl: `/api/interaction-runs/${encodeURIComponent(id)}/json`
  };
}

function logUnexpectedAgentError(label, err) {
  if (!err?.statusCode || err.statusCode >= 500) {
    console.error(label, err);
  }
}

app.get('/api/agent/schema', requireAuthJson, (req, res) => {
  try {
    res.json(buildAgentSchema());
  } catch (err) {
    console.error('Failed to load agent API schema', err);
    sendJsonError(res, 500, 'Failed to load agent API schema');
  }
});

app.post('/api/agent/audits', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const built = createAgentAudit(username, req.body || {});
    let auditRun = null;
    if (req.body?.run === true || req.body?.start === true) {
      const started = startAuditForUser({
        username,
        payload: built.assembledPayload,
        requestHeaders: captureRequestHeaders(req),
        configId: built.auditConfig.id,
        configSnapshot: built.configSnapshot
      });
      auditRun = auditRunLinks(started.id);
    }
    res.status(201).json({
      ok: true,
      auditConfig: summarizeConfig(built.auditConfig),
      assembledPayload: built.assembledPayload,
      configSnapshot: built.configSnapshot,
      auditRun,
      created: built.created
    });
  } catch (err) {
    logUnexpectedAgentError('Failed to create agent audit', err);
    sendJsonError(res, err.statusCode || 400, err.message || 'Failed to create agent audit');
  }
});

app.post('/api/agent/audits/:id/run', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const config = auditStore.getAuditConfig(req.params.id, username);
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    const payload = assembleAuditPayload(config);
    const configSnapshot = buildConfigSnapshot(config, payload);
    const started = startAuditForUser({
      username,
      payload,
      requestHeaders: captureRequestHeaders(req),
      configId: config.id,
      configSnapshot
    });
    res.json({
      ok: true,
      auditConfig: summarizeConfig(config),
      assembledPayload: payload,
      configSnapshot,
      auditRun: auditRunLinks(started.id)
    });
  } catch (err) {
    logUnexpectedAgentError('Failed to run agent audit config', err);
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to run agent audit config');
  }
});

app.post('/api/agent/interactions', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const built = createAgentInteraction(username, req.body || {});
    let interactionRun = null;
    if (req.body?.run === true || req.body?.start === true) {
      const started = startInteractionForUser({ username, config: built.interactionConfig });
      interactionRun = interactionRunLinks(started.id);
    }
    res.status(201).json({
      ok: true,
      interactionConfig: summarizeInteractionConfig(built.interactionConfig),
      configSnapshot: buildInteractionConfigSnapshot(built.interactionConfig),
      interactionRun,
      created: built.created
    });
  } catch (err) {
    logUnexpectedAgentError('Failed to create agent interaction', err);
    sendJsonError(res, err.statusCode || 400, err.message || 'Failed to create agent interaction');
  }
});

app.post('/api/agent/interactions/:id/run', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const config = auditStore.getInteractionConfig(req.params.id, username);
    if (!config) return sendJsonError(res, 404, 'Interaction config not found');
    const started = startInteractionForUser({ username, config });
    res.json({
      ok: true,
      interactionConfig: summarizeInteractionConfig(config),
      configSnapshot: buildInteractionConfigSnapshot(config),
      interactionRun: interactionRunLinks(started.id)
    });
  } catch (err) {
    logUnexpectedAgentError('Failed to run agent interaction config', err);
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to run agent interaction config');
  }
});

app.get('/api/audit-configs', requireAuthJson, (req, res) => {
  try {
    res.json({ configs: auditStore.listAuditConfigs(currentUsername(req)) });
  } catch (err) {
    console.error('Failed to list audit configs', err);
    sendJsonError(res, 500, 'Failed to load audit configs');
  }
});

app.post('/api/audit-configs', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.createAuditConfig(currentUsername(req), req.body || {});
    const payload = assembleAuditPayload(config);
    res.status(201).json({ config: summarizeConfig(config), assembledPayload: payload });
  } catch (err) {
    console.error('Failed to create audit config', err);
    sendJsonError(res, 400, err.message || 'Failed to create audit config');
  }
});

app.get('/api/audit-configs/:id', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.getAuditConfig(req.params.id, currentUsername(req));
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    const assembledPayload = assembleAuditPayload(config);
    res.json({ config: summarizeConfig(config), assembledPayload });
  } catch (err) {
    console.error('Failed to load audit config', err);
    sendJsonError(res, 500, 'Failed to load audit config');
  }
});

app.put('/api/audit-configs/:id', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.updateAuditConfig(req.params.id, currentUsername(req), req.body || {});
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    const assembledPayload = assembleAuditPayload(config);
    res.json({ config: summarizeConfig(config), assembledPayload });
  } catch (err) {
    console.error('Failed to update audit config', err);
    sendJsonError(res, 400, err.message || 'Failed to update audit config');
  }
});

app.delete('/api/audit-configs/:id', requireAuthJson, (req, res) => {
  try {
    if (!auditStore.deleteAuditConfig(req.params.id, currentUsername(req))) {
      return sendJsonError(res, 404, 'Audit config not found');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete audit config', err);
    sendJsonError(res, 500, 'Failed to delete audit config');
  }
});

app.post('/api/audit-configs/:id/duplicate', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.duplicateAuditConfig(req.params.id, currentUsername(req));
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    res.status(201).json({ config: summarizeConfig(config), assembledPayload: assembleAuditPayload(config) });
  } catch (err) {
    console.error('Failed to duplicate audit config', err);
    sendJsonError(res, 500, 'Failed to duplicate audit config');
  }
});

app.post('/api/audit-configs/:id/run', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const config = auditStore.getAuditConfig(req.params.id, username);
    if (!config) return sendJsonError(res, 404, 'Audit config not found');
    const payload = assembleAuditPayload(config);
    const configSnapshot = buildConfigSnapshot(config, payload);
    const { id } = startAuditForUser({
      username,
      payload,
      requestHeaders: captureRequestHeaders(req),
      configId: config.id,
      configSnapshot
    });
    res.json({ id });
  } catch (err) {
    console.error('Failed to run audit config', err);
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to run audit config');
  }
});

app.get('/api/action-templates', requireAuthJson, (req, res) => {
  try {
    const type = req.query.type || 'pre';
    res.json({ templates: auditStore.listActionTemplates(currentUsername(req), type) });
  } catch (err) {
    console.error('Failed to list action templates', err);
    sendJsonError(res, 500, 'Failed to load action templates');
  }
});

app.post('/api/action-templates', requireAuthJson, (req, res) => {
  try {
    const template = auditStore.createActionTemplate(currentUsername(req), req.body || {});
    res.status(201).json({ template });
  } catch (err) {
    console.error('Failed to create action template', err);
    sendJsonError(res, 400, err.message || 'Failed to create action template');
  }
});

app.get('/api/action-templates/:id', requireAuthJson, (req, res) => {
  const template = auditStore.getActionTemplate(req.params.id, currentUsername(req));
  if (!template) return sendJsonError(res, 404, 'Action template not found');
  res.json({ template });
});

app.put('/api/action-templates/:id', requireAuthJson, (req, res) => {
  try {
    const template = auditStore.updateActionTemplate(req.params.id, currentUsername(req), req.body || {});
    if (!template) return sendJsonError(res, 404, 'Action template not found');
    res.json({ template });
  } catch (err) {
    console.error('Failed to update action template', err);
    sendJsonError(res, 400, err.message || 'Failed to update action template');
  }
});

app.delete('/api/action-templates/:id', requireAuthJson, (req, res) => {
  if (!auditStore.deleteActionTemplate(req.params.id, currentUsername(req))) {
    return sendJsonError(res, 404, 'Action template not found');
  }
  res.json({ ok: true });
});

app.post('/api/action-templates/:id/duplicate', requireAuthJson, (req, res) => {
  const template = auditStore.duplicateActionTemplate(req.params.id, currentUsername(req));
  if (!template) return sendJsonError(res, 404, 'Action template not found');
  res.status(201).json({ template });
});

app.get('/api/rule-sets', requireAuthJson, (req, res) => {
  try {
    res.json({ ruleSets: auditStore.listRuleSets(currentUsername(req)) });
  } catch (err) {
    console.error('Failed to list rule sets', err);
    sendJsonError(res, 500, 'Failed to load rule sets');
  }
});

app.post('/api/rule-sets', requireAuthJson, (req, res) => {
  try {
    const ruleSet = auditStore.createRuleSet(currentUsername(req), req.body || {});
    res.status(201).json({ ruleSet });
  } catch (err) {
    console.error('Failed to create rule set', err);
    sendJsonError(res, 400, err.message || 'Failed to create rule set');
  }
});

app.get('/api/rule-sets/:id', requireAuthJson, (req, res) => {
  const ruleSet = auditStore.getRuleSet(req.params.id, currentUsername(req));
  if (!ruleSet) return sendJsonError(res, 404, 'Rule set not found');
  res.json({ ruleSet });
});

app.put('/api/rule-sets/:id', requireAuthJson, (req, res) => {
  try {
    const ruleSet = auditStore.updateRuleSet(req.params.id, currentUsername(req), req.body || {});
    if (!ruleSet) return sendJsonError(res, 404, 'Rule set not found');
    res.json({ ruleSet });
  } catch (err) {
    console.error('Failed to update rule set', err);
    sendJsonError(res, 400, err.message || 'Failed to update rule set');
  }
});

app.delete('/api/rule-sets/:id', requireAuthJson, (req, res) => {
  if (!auditStore.deleteRuleSet(req.params.id, currentUsername(req))) {
    return sendJsonError(res, 404, 'Rule set not found');
  }
  res.json({ ok: true });
});

app.post('/api/rule-sets/:id/duplicate', requireAuthJson, (req, res) => {
  const ruleSet = auditStore.duplicateRuleSet(req.params.id, currentUsername(req));
  if (!ruleSet) return sendJsonError(res, 404, 'Rule set not found');
  res.status(201).json({ ruleSet });
});

app.get('/api/interaction-flow-templates', requireAuthJson, (req, res) => {
  try {
    res.json({ templates: auditStore.listFlowTemplates(currentUsername(req)) });
  } catch (err) {
    console.error('Failed to list interaction flow templates', err);
    sendJsonError(res, 500, 'Failed to load interaction flow templates');
  }
});

app.post('/api/interaction-flow-templates', requireAuthJson, (req, res) => {
  try {
    const template = auditStore.createFlowTemplate(currentUsername(req), req.body || {});
    res.status(201).json({ template });
  } catch (err) {
    console.error('Failed to create interaction flow template', err);
    sendJsonError(res, 400, err.message || 'Failed to create interaction flow template');
  }
});

app.get('/api/interaction-flow-templates/:id', requireAuthJson, (req, res) => {
  const template = auditStore.getFlowTemplate(req.params.id, currentUsername(req));
  if (!template) return sendJsonError(res, 404, 'Interaction flow template not found');
  res.json({ template });
});

app.put('/api/interaction-flow-templates/:id', requireAuthJson, (req, res) => {
  try {
    const template = auditStore.updateFlowTemplate(req.params.id, currentUsername(req), req.body || {});
    if (!template) return sendJsonError(res, 404, 'Interaction flow template not found');
    res.json({ template });
  } catch (err) {
    console.error('Failed to update interaction flow template', err);
    sendJsonError(res, 400, err.message || 'Failed to update interaction flow template');
  }
});

app.delete('/api/interaction-flow-templates/:id', requireAuthJson, (req, res) => {
  if (!auditStore.deleteFlowTemplate(req.params.id, currentUsername(req))) {
    return sendJsonError(res, 404, 'Interaction flow template not found');
  }
  res.json({ ok: true });
});

app.post('/api/interaction-flow-templates/:id/duplicate', requireAuthJson, (req, res) => {
  const template = auditStore.duplicateFlowTemplate(req.params.id, currentUsername(req));
  if (!template) return sendJsonError(res, 404, 'Interaction flow template not found');
  res.status(201).json({ template });
});

app.get('/api/interaction-configs', requireAuthJson, (req, res) => {
  try {
    res.json({ configs: auditStore.listInteractionConfigs(currentUsername(req)).map(summarizeInteractionConfig) });
  } catch (err) {
    console.error('Failed to list interaction configs', err);
    sendJsonError(res, 500, 'Failed to load interaction configs');
  }
});

app.post('/api/interaction-configs', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.createInteractionConfig(currentUsername(req), req.body || {});
    res.status(201).json({ config: summarizeInteractionConfig(config) });
  } catch (err) {
    console.error('Failed to create interaction config', err);
    sendJsonError(res, 400, err.message || 'Failed to create interaction config');
  }
});

app.get('/api/interaction-configs/:id', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.getInteractionConfig(req.params.id, currentUsername(req));
    if (!config) return sendJsonError(res, 404, 'Interaction config not found');
    res.json({ config: summarizeInteractionConfig(config) });
  } catch (err) {
    console.error('Failed to load interaction config', err);
    sendJsonError(res, 500, 'Failed to load interaction config');
  }
});

app.put('/api/interaction-configs/:id', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.updateInteractionConfig(req.params.id, currentUsername(req), req.body || {});
    if (!config) return sendJsonError(res, 404, 'Interaction config not found');
    res.json({ config: summarizeInteractionConfig(config) });
  } catch (err) {
    console.error('Failed to update interaction config', err);
    sendJsonError(res, 400, err.message || 'Failed to update interaction config');
  }
});

app.delete('/api/interaction-configs/:id', requireAuthJson, (req, res) => {
  try {
    if (!auditStore.deleteInteractionConfig(req.params.id, currentUsername(req))) {
      return sendJsonError(res, 404, 'Interaction config not found');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete interaction config', err);
    sendJsonError(res, 500, 'Failed to delete interaction config');
  }
});

app.post('/api/interaction-configs/:id/duplicate', requireAuthJson, (req, res) => {
  try {
    const config = auditStore.duplicateInteractionConfig(req.params.id, currentUsername(req));
    if (!config) return sendJsonError(res, 404, 'Interaction config not found');
    res.status(201).json({ config: summarizeInteractionConfig(config) });
  } catch (err) {
    console.error('Failed to duplicate interaction config', err);
    sendJsonError(res, 500, 'Failed to duplicate interaction config');
  }
});

app.post('/api/interaction-configs/:id/run', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const config = auditStore.getInteractionConfig(req.params.id, username);
    if (!config) return sendJsonError(res, 404, 'Interaction config not found');
    const { id } = startInteractionForUser({ username, config });
    res.json({ id });
  } catch (err) {
    console.error('Failed to run interaction config', err);
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to run interaction config');
  }
});

app.get('/api/interaction-runs', requireAuthJson, (req, res) => {
  try {
    const limitParam = Number.parseInt(req.query.limit, 10);
    const safeLimit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
    res.json({ runs: auditStore.listInteractionRuns(currentUsername(req), safeLimit) });
  } catch (err) {
    console.error('Failed to list interaction runs', err);
    sendJsonError(res, 500, 'Failed to load interaction runs');
  }
});

app.get('/api/interaction-runs/:id', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureInteractionJob(req.params.id, username);
  if (job) {
    return res.json({
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.finishedAt || null,
      progress: job.progress,
      configSnapshot: job.configSnapshot,
      results: job.results || null,
      error: job.error || null
    });
  }
  const stored = auditStore.getInteractionRun(req.params.id, username);
  if (!stored) return sendJsonError(res, 404, 'Interaction run not found');
  res.json(stored);
});

app.get('/api/interaction-runs/:id/status', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureInteractionJob(req.params.id, username);
  if (job) {
    return res.json({ status: job.status, progress: job.progress, error: job.error || null });
  }
  const stored = auditStore.getInteractionRun(req.params.id, username);
  if (!stored) return sendJsonError(res, 404, 'Interaction run not found');
  res.json({ status: stored.status, progress: stored.progress, error: stored.error || null });
});

app.get('/api/interaction-runs/:id/logs', requireAuthJson, (req, res) => {
  const job = ensureInteractionJob(req.params.id, currentUsername(req));
  if (!job) return sendJsonError(res, 404, 'Interaction run not found or no longer live');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  for (const log of job.logs) {
    try {
      res.write(`event: log\n`);
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    } catch (_) {}
  }
  job.sseClients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    } catch (_) {}
  }, 15000);
  req.on('close', () => {
    job.sseClients.delete(res);
    clearInterval(ping);
    try { res.end(); } catch (_) {}
  });
});

app.get('/api/interaction-runs/:id/results', requireAuthJson, (req, res) => {
  const { status, results, error } = getCompletedInteractionResults(req.params.id, currentUsername(req));
  if (status === 'missing') return sendJsonError(res, 404, 'Interaction run not found');
  if (status !== 'completed' || !results) {
    if (status === 'failed' && results) return res.json(results);
    if (status === 'failed') return res.status(422).json({ status, error: error || 'Unknown error' });
    return res.status(202).json({ status });
  }
  res.json(results);
});

app.get('/api/interaction-runs/:id/json', requireAuthJson, (req, res) => {
  const { status, results, error } = getCompletedInteractionResults(req.params.id, currentUsername(req));
  if (status === 'missing') return sendJsonError(res, 404, 'Interaction run not found');
  if (!results) return sendJsonError(res, status === 'failed' ? 422 : 202, error || 'Interaction results are not ready');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="interaction-${req.params.id}.json"`);
  res.send(JSON.stringify(results, null, 2));
});

app.get('/api/interaction-runs/:id/csv', requireAuthJson, (req, res) => {
  const { status, results, error } = getCompletedInteractionResults(req.params.id, currentUsername(req));
  if (status === 'missing') return sendJsonError(res, 404, 'Interaction run not found');
  if (!results) return sendJsonError(res, status === 'failed' ? 422 : 202, error || 'Interaction results are not ready');
  const rows = [];
  rows.push(['Step', 'Name', 'Action', 'Status', 'DurationMs', 'UrlBefore', 'UrlAfter', 'Requests', 'ConsoleMessages', 'RulePasses', 'RuleFailures', 'Error']);
  for (const step of results.steps || []) {
    rows.push([
      step.stepNumber,
      step.stepName,
      step.action,
      step.status,
      step.durationMs,
      step.urlBefore,
      step.urlAfter,
      (step.networkRequests || []).length,
      (step.console || []).length,
      (step.ruleResults || []).filter((rule) => rule.status === 'passed').length,
      (step.ruleResults || []).filter((rule) => rule.status === 'failed').length,
      step.error || ''
    ]);
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="interaction-${req.params.id}.csv"`);
  res.send(csv);
});

app.get('/api/audit/my', requireAuthJson, (req, res) => {
  const limitParam = Number.parseInt(req.query.limit, 10);
  const safeLimit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  const username = currentUsername(req);
  try {
    res.json({ audits: auditStore.listAudits(username, safeLimit) });
  } catch (err) {
    console.error('Failed to list audits from store', err);
    sendJsonError(res, 500, 'Failed to load audits');
  }
});

app.get('/api/audit/:id', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureJob(req.params.id, username);
  if (job) {
    return res.json({
      id: job.id,
      domain: job.options?.domain || job.options?.url || '',
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.finishedAt || null,
      payload: job.options || null,
      summary: job.results?.summary || null,
      requestHeaders: job.requestHeaders || null,
      results: job.results || null,
      error: job.error || null,
      configId: job.configId || null,
      configSnapshot: job.configSnapshot || null,
      configName: job.configSnapshot?.name || null
    });
  }
  const stored = getStoredAudit(req.params.id, username);
  if (!stored) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: stored.id,
    domain: stored.domain,
    status: stored.status,
    startedAt: stored.startedAt,
    completedAt: stored.completedAt,
    payload: stored.payload,
    summary: stored.summary,
    requestHeaders: stored.requestHeaders,
    results: stored.results,
    error: stored.error,
    configId: stored.configId,
    configSnapshot: stored.configSnapshot,
    configName: stored.configName
  });
});

app.get('/api/audit/:id/status', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureJob(req.params.id, username);
  if (job) {
    return res.json({ id: job.id, status: job.status, progress: job.progress, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error || null });
  }
  const stored = getStoredAudit(req.params.id, username);
  if (!stored) return res.status(404).json({ error: 'Not found' });
  res.json({ id: stored.id, status: stored.status, progress: null, startedAt: stored.startedAt, finishedAt: stored.completedAt, error: stored.error || null });
});

app.get('/api/audit/:id/results', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureJob(req.params.id, username);
  if (job) {
    if (job.status === 'failed') return res.status(422).json({ status: job.status, error: job.error || 'Unknown error' });
    if (job.status !== 'completed') return res.status(202).json({ status: job.status });
    const results = job.results || {};
    if (!results.requestHeaders && job.requestHeaders) {
      results.requestHeaders = job.requestHeaders;
    }
    return res.json(results);
  }
  const stored = getStoredAudit(req.params.id, username);
  if (!stored) return res.status(404).json({ error: 'Not found' });
  if (stored.status === 'failed') return res.status(422).json({ status: stored.status, error: stored.error || 'Unknown error' });
  if (stored.status !== 'completed' || !stored.results) return res.status(202).json({ status: stored.status });
  const results = stored.results || {};
  if (!results.requestHeaders && stored.requestHeaders) {
    results.requestHeaders = stored.requestHeaders;
  }
  res.json(results);
});

// Download full results as JSON file
app.get('/api/audit/:id/json', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureJob(req.params.id, username);
  if (job) {
    if (job.status !== 'completed') return res.status(202).json({ status: job.status });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}.json"`);
    return res.send(JSON.stringify(job.results, null, 2));
  }
  const stored = getStoredAudit(req.params.id, username);
  if (!stored) return res.status(404).json({ error: 'Not found' });
  if (stored.status !== 'completed' || !stored.results) return res.status(202).json({ status: stored.status });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}.json"`);
  res.send(JSON.stringify(stored.results, null, 2));
});

// Server-Sent Events stream for live logs per job
app.get('/api/audit/:id/logs', requireAuthJson, (req, res) => {
  const job = ensureJob(req.params.id, currentUsername(req));
  if (!job) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send history
  for (const l of job.logs) {
    res.write(`event: log\n`);
    res.write(`data: ${JSON.stringify(l)}\n\n`);
  }
  // Send status snapshot
  res.write(`event: status\n`);
  res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);

  job.sseClients.add(res);
  // Keep-alive ping
  const ping = setInterval(() => {
    try {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    } catch (_) {}
  }, 15000);
  req.on('close', () => {
    job.sseClients.delete(res);
    clearInterval(ping);
    try { res.end(); } catch (_) {}
  });
});

// Basic CSV export for cookies per page and analytics hits
app.get('/api/audit/:id/csv', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const { status, results, error } = getCompletedResults(req.params.id, username);
  if (status === 'missing') return res.status(404).json({ error: 'Not found' });
  if (status !== 'completed' || !results) {
    if (status === 'failed') {
      return res.status(422).json({ status, error: error || 'Unknown error' });
    }
    return res.status(202).json({ status });
  }

  const rows = [];
  rows.push([
    'URL', 'Title', 'Depth',
    'FirstPartyCookiesCount', 'ThirdPartyCookiesCount',
    'FirstPartyCookiesJSON', 'ThirdPartyCookiesJSON',
    'DetectedRequests', 'UniqueVendors', 'VendorsCount',
    'DataLayerBeforeJSON', 'DataLayerAfterJSON',
    'RulePasses', 'RuleFailures', 'RuleNotApplied',
    'LinksFound', 'ClientIP', 'UserAgent', 'GeoCountry', 'GeoCity', 'GeoRegion'
  ]);

  const pages = results.pages || [];
  const requestHeaders = results.requestHeaders || {};
  for (const p of pages) {
    const url = p.url;
    const cookies = Array.isArray(p.cookies) ? p.cookies : [];
    const [fp, tp] = partitionCookies(cookies, url);
    const vendors = Array.isArray(p.vendors) ? p.vendors : [];
    rows.push([
      url,
      p.title || '',
      String(p.depth || 0),
      String(fp.length),
      String(tp.length),
      JSON.stringify(fp),
      JSON.stringify(tp),
      String(Array.isArray(p.analytics) ? p.analytics.length : 0),
      vendors.join('; '),
      String(vendors.length),
      JSON.stringify(p.dataLayer?.before || []),
      JSON.stringify(p.dataLayer?.after || []),
      String((p.ruleResults || []).filter((rule) => rule.status === 'passed').length),
      String((p.ruleResults || []).filter((rule) => rule.status === 'failed').length),
      String((p.ruleResults || []).filter((rule) => rule.status === 'skipped').length),
      String(p.linksFound || 0),
      requestHeaders.ipAddress || '',
      requestHeaders.userAgent || '',
      requestHeaders.geoLocation?.country || '',
      requestHeaders.geoLocation?.city || '',
      requestHeaders.geoLocation?.region || ''
    ]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}.csv"`);
  res.send(csv);
});


// Per-vendor CSV export of all matching requests across all pages
// Example: /api/audit/:id/vendor.csv?vendor=OneTrust
app.get('/api/audit/:id/vendor.csv', requireAuthJson, (req, res) => {
  const target = (req.query.vendor || '').toString();
  if (!target) return res.status(400).json({ error: 'vendor query required' });

  const username = currentUsername(req);
  const { status, results, error } = getCompletedResults(req.params.id, username);
  if (status === 'missing') return res.status(404).json({ error: 'Not found' });
  if (status !== 'completed' || !results) {
    if (status === 'failed') {
      return res.status(422).json({ status, error: error || 'Unknown error' });
    }
    return res.status(202).json({ status });
  }

  const rows = [];
  rows.push(['Vendor', 'TagName', 'MatchType', 'PageURL', 'PageTitle', 'Method', 'Type', 'RequestURL', 'ParamsJSON']);
  for (const p of results.pages || []) {
    for (const a of p.analytics || []) {
      if ((a.vendor || '') === target) {
        let params = '';
        try {
          const u = new URL(a.url);
          params = JSON.stringify(Object.fromEntries(u.searchParams.entries()));
        } catch (_) {
          params = '{}';
        }
        rows.push([
          a.vendor || '',
          a.tagName || '',
          a.matchType || '',
          p.url,
          p.title || '',
          a.method || '',
          a.resourceType || '',
          a.url || '',
          params,
        ]);
      }
    }
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.id}-${encodeURIComponent(target)}.csv"`);
  res.send(csv);
});


app.get('/api/audits', requireAuthJson, (req, res) => {
  const limitParam = Number.parseInt(req.query.limit, 10);
  const safeLimit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  const username = currentUsername(req);
  try {
    const audits = auditStore.listAudits(username, safeLimit).map((row) => ({
      id: row.id,
      domain: row.domain,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      summary: row.summary,
      error: row.error,
      configId: row.configId,
      configName: row.configName,
      configSnapshot: row.configSnapshot
    }));
    res.json({ audits });
  } catch (err) {
    console.error('Failed to list audits from store', err);
    res.status(500).json({ error: 'Failed to load audits' });
  }
});

app.post('/api/audits/:id/rerun', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const audit = getStoredAudit(req.params.id, username);
    if (!audit) return sendJsonError(res, 404, 'Audit not found');
    if (audit.payload?.attachedMode) return sendJsonError(res, 409, 'Start a new attached audit from the Chrome extension');
    const payload = audit.configSnapshot?.assembledPayload || audit.payload || {};
    const configId = audit.configId || null;
    const configSnapshot = audit.configSnapshot || null;
    const { id } = startAuditForUser({
      username,
      payload,
      requestHeaders: captureRequestHeaders(req),
      configId,
      configSnapshot
    });
    res.json({ id });
  } catch (err) {
    console.error('Failed to rerun audit', err);
    sendJsonError(res, err.statusCode || 500, err.message || 'Failed to rerun audit');
  }
});

app.post('/api/audits/:id/duplicate-config', requireAuthJson, (req, res) => {
  try {
    const username = currentUsername(req);
    const audit = getStoredAudit(req.params.id, username);
    if (!audit) return sendJsonError(res, 404, 'Audit not found');
    const snapshot = audit.configSnapshot || {};
    const payload = snapshot.assembledPayload || audit.payload || {};
    const config = auditStore.createAuditConfig(username, {
      name: `${snapshot.name || audit.domain || payload.domain || 'Audit'} Config`,
      description: `Created from audit ${audit.id}`,
      domain: snapshot.domain || payload.domain || audit.domain || '',
      maxPages: snapshot.maxPages || payload.maxPages || 15,
      maxDepth: snapshot.maxDepth == null ? payload.maxDepth : snapshot.maxDepth,
      sameOriginOnly: snapshot.sameOriginOnly !== undefined ? snapshot.sameOriginOnly : payload.sameOriginOnly !== false,
      waitUntil: snapshot.waitUntil || payload.waitUntil || 'domcontentloaded',
      showBrowser: snapshot.showBrowser !== undefined ? snapshot.showBrowser : payload.headless === false,
      urlSources: snapshot.urlSources || payload.startingUrls || [],
      includeSitemaps: snapshot.includeSitemaps !== undefined ? snapshot.includeSitemaps : payload.findPagesInSitemaps !== false,
      options: {
        preAuditActions: payload.preAuditActions || [],
        postAuditActions: payload.postAuditActions || payload.onPageActions || [],
        rules: payload.rules || [],
        flow: payload.flow || [],
        startingUrls: payload.startingUrls || []
      },
      isDefault: false
    });
    res.status(201).json({ config: summarizeConfig(config), assembledPayload: assembleAuditPayload(config) });
  } catch (err) {
    console.error('Failed to duplicate config from audit', err);
    sendJsonError(res, 500, 'Failed to duplicate config from audit');
  }
});

app.get('/api/audits/:id', requireAuthJson, (req, res) => {
  const username = currentUsername(req);
  const job = ensureJob(req.params.id, username);
  if (job) {
    return res.json({
      id: job.id,
      domain: job.options?.domain || job.options?.url || '',
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.finishedAt || null,
      payload: job.options || null,
      summary: job.results?.summary || null,
      requestHeaders: job.requestHeaders || null,
      results: job.results || null,
      error: job.error || null,
      configId: job.configId || null,
      configSnapshot: job.configSnapshot || null,
      configName: job.configSnapshot?.name || null
    });
  }
  const stored = getStoredAudit(req.params.id, username);
  if (!stored) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: stored.id,
    domain: stored.domain,
    status: stored.status,
    startedAt: stored.startedAt,
    completedAt: stored.completedAt,
    payload: stored.payload,
    summary: stored.summary,
    requestHeaders: stored.requestHeaders,
    results: stored.results,
    error: stored.error,
    configId: stored.configId,
    configSnapshot: stored.configSnapshot,
    configName: stored.configName
  });
});

// Serve static UI
app.use('/', express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Free Audit server running on http://localhost:${PORT}`);
});

// Helper: first vs third party cookies
function partitionCookies(cookies, pageUrl) {
  const { isFirstPartyCookie } = require('./src/audit/utils');
  const first = [];
  const third = [];
  for (const c of cookies || []) {
    const entry = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    };
    (isFirstPartyCookie(c, pageUrl) ? first : third).push(entry);
  }
  return [first, third];
}











