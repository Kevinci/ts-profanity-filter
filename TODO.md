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
