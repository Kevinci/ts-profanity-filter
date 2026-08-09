// A moderation endpoint, in one file and with no framework.
//
// The shape is the whole point: the browser talks to your server, your server
// talks to the model. The API key stays in this process and is never sent to
// the client — the client only ever receives a verdict.
//
//   browser  ──POST /api/moderate──▶  this server  ──▶  Anthropic
//            ◀──── verdict JSON ────                 (key lives here only)
//
// Run:  ANTHROPIC_API_KEY=sk-ant-... node server.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { moderateText } from 'ts-profanity-filter/ai';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. See .env.example.');
  process.exit(1);
}

/* --------------------------- guard rails ------------------------------ */
// An endpoint that spends money per request needs both of these before it is
// reachable from anywhere. They are small on purpose — adjust to your traffic.

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const window = hits.get(ip);

  if (!window || now - window.start > RATE_LIMIT.windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > RATE_LIMIT.maxRequests;
}

// Without this the map grows for every IP that ever calls.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.windowMs;
  for (const [ip, window] of hits) if (window.start < cutoff) hits.delete(ip);
}, RATE_LIMIT.windowMs).unref();

/* ------------------------------ helpers -------------------------------- */

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Body must be JSON.');
    error.statusCode = 400;
    throw error;
  }
}

/* ------------------------------- routes -------------------------------- */

async function moderate(req, res) {
  const body = await readJsonBody(req);

  if (typeof body.text !== 'string') {
    return send(res, 400, { error: 'Expected { "text": "..." }.' });
  }

  const result = await moderateText(body.text, {
    languages: Array.isArray(body.languages) ? body.languages : ['en', 'de'],
    ai: {
      enabled: body.ai !== false,
      // No apiKey here on purpose — it is read from the environment, so it
      // cannot be smuggled in from the request body.
      languageHint: body.languageHint,
      effort: 'low',
    },
  });

  // Return the verdict, not the machinery. The client has no business knowing
  // which model answered or what the prompt was.
  send(res, 200, {
    flagged: result.flagged,
    matchedList: result.matchedList,
    segments: result.segments,
    ai: {
      status: result.ai.status,
      flagged: result.ai.flagged,
      severity: result.ai.severity,
      categories: result.ai.categories,
      confidence: result.ai.confidence,
      reason: result.ai.reason,
    },
  });
}

const server = createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? 'unknown';

  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(join(HERE, 'public', 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html');
    }

    if (req.method === 'POST' && req.url === '/api/moderate') {
      if (rateLimited(ip)) {
        return send(res, 429, { error: 'Too many requests. Try again shortly.' });
      }
      return await moderate(req, res);
    }

    send(res, 404, { error: 'Not found.' });
  } catch (error) {
    // Log the detail, return a generic message: internals belong in your logs,
    // not in a response body a stranger reads.
    console.error('[moderate]', error);
    send(res, error.statusCode ?? 500, {
      error: error.statusCode ? error.message : 'Internal error.',
    });
  }
});

server.listen(PORT, () => {
  console.log(`Moderation endpoint on http://localhost:${PORT}`);
  console.log(`  POST /api/moderate  { "text": "..." }`);
});
