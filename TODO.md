# TODO

Open decisions and parked work. English, like the rest of the repo.

## Publish `profanity-adversarial`, or make it repo-only

**Parked 2026-08-10.** The package is ready to publish and was verified with
`npm publish --dry-run`: 38 files, 26.1 kB, the `bin` keeps its shebang, name
unregistered on the registry (HTTP 404), 13/13 tests pass. The publishability
fixes are committed and pushed (`6c49c29`).

Two ways to close it:

- **Publish it.** `cd adversarial && npm publish` — needs the browser one-time
  password, so it has to be run by hand. Unscoped, so public by default.
- **Keep it repo-only.** Then the first line of `adversarial/README.md` is wrong:
  `npx profanity-adversarial ./my-adapter.mjs` only resolves for a published
  package. It would have to become clone-and-build instructions.

Either way, the root `README.md` currently mentions the benchmark only in
passing under *Also in this release*, without naming or linking it. A short
section there is worth adding once this is decided.

## "Node.js support / backend" — what is still missing?

**Raised 2026-08-10, needs a definition before it can be built.** Batch
processing already landed the Node-specific half: file and CSV readers behind
`ts-profanity-filter/batch/node`, an NDJSON writer, and a `ts-profanity-filter
scan` CLI. So the remaining ask is something else, and the plausible readings
lead to different work:

- **A framework middleware** — an Express/Fastify/Hono handler that moderates a
  request body and answers with a verdict. `examples/server` is a plain
  `node:http` sketch of this, not a shipped export.
- **A long-running service** — a queue worker with health and metrics endpoints,
  rather than a library you call.
- **Persistence** — a `JustificationStore` implementation against a real
  database, which the Art. 17 module deliberately leaves to the caller.
- **Runtime coverage** — verifying and documenting Bun, Deno and edge runtimes,
  where `require()` on Node 18 and Hermes are already known gaps.
