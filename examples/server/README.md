# Moderation endpoint

A working example of the shape the AI check is meant to have:

```
browser  ──POST /api/moderate──▶  your server  ──▶  Anthropic
         ◀──── verdict JSON ────                (key lives here only)
```

The key never leaves the server process. The browser receives a verdict, not a
credential.

## Run it

```bash
cp .env.example .env        # then put your key in it — .env is gitignored
npm install
npm start
```

Open <http://localhost:8787>. The page posts to `/api/moderate` on the same
origin; the server calls the model.

Get a key at <https://console.anthropic.com/settings/keys>, and give it a spend
limit while you are experimenting.

## The endpoint

```bash
curl -s localhost:8787/api/moderate \
  -H 'content-type: application/json' \
  -d '{"text":"Some comment to check","languages":["en","de"]}'
```

```jsonc
{
  "flagged": true,           // either signal fired
  "matchedList": false,      // no word list matched
  "segments": [ /* lossless, ready to render */ ],
  "ai": {
    "status": "ok",
    "flagged": true,
    "severity": "high",
    "categories": ["hate"],
    "confidence": 0.9,
    "reason": "…"            // one sentence, in the language of the text
  }
}
```

Pass `"ai": false` to skip the model and run only the local word lists — useful
for a cheap first pass, or when the model is unavailable.

## What this example does on purpose

**The key is read from the environment, never from the request body.** A caller
cannot smuggle one in, and the server cannot be tricked into spending someone
else's.

**The response carries a verdict, not the machinery.** Which model answered and
what the prompt was are none of the client's business, so neither is returned.

**Errors are logged in full and returned in summary.** Internals belong in your
logs, not in a response body a stranger reads.

**There is a body-size cap and a rate limit.** This endpoint spends money per
request. Both are deliberately small — raise them to fit your traffic, but do
not remove them.

The in-memory rate limiter is right for one process. Behind more than one
instance, move it to something shared (Redis, your gateway) or each instance
will enforce its own separate quota.

## What it deliberately does not do

No authentication, no persistence, no CORS headers — the page and the API are
same-origin here. Add all three before this faces the internet: without auth,
anyone who finds the URL spends your credits.
