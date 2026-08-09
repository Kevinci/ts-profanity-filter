// Generates docs/index.html from demo/template.html, inlining the *compiled*
// library from dist/ so the playground can never drift from what npm ships.
//
// The page is a single self-contained file: open it straight from disk, and it
// is also what GitHub Pages serves. Pages can only use the repo root or /docs
// as its site root, hence docs/ — that puts the playground at the bare
// https://<user>.github.io/<repo>/ URL rather than a subfolder.
//
// Run: npm run demo   (builds with tsc first)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order — these get concatenated into one classic <script> scope.
const MODULES = [
  'dist/aggressive.js',
  'dist/normalize.js',
  'dist/lang/en.js',
  'dist/lang/de.js',
  'dist/registry.js',
  'dist/filter.js',
  'dist/ai/types.js',
  'dist/ai/prompt.js',
  // The three providers are here because ai/index.js imports them at the top
  // level. Only gemini's plain fetch can actually run on a page: anthropic
  // loads its SDK through a dynamic import that no import map resolves here,
  // and ollama talks to localhost. The demo never routes through either — it
  // passes its own `complete` — so their presence costs bytes, nothing else.
  'dist/ai/anthropic.js',
  'dist/ai/gemini.js',
  'dist/ai/ollama.js',
  'dist/ai/index.js',
  'dist/compliance/prompt.js',
  'dist/compliance/generator.js',
];

/** Every `from '…'` in a module, whether it is an import or a re-export. */
const SPECIFIER = /^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm;

/** Turns an ES module into plain script-scope code. */
function deModule(source) {
  return source
    .replace(/^import\s[^;]*;$/gm, '') // drop cross-file imports
    // Both shapes of re-export. `export { x } from './y.js'` is pure module
    // plumbing here: in one shared scope the binding is already the declaration
    // in y.js, so the line has nothing left to do.
    .replace(/^export\s*\{[^}]*\}\s*(?:from\s+'[^']*'\s*)?;$/gm, '')
    // Unwrap declarations, `async function` among them.
    .replace(/^export\s+(?=(?:async\s+)?(?:const|function|class|let)\s)/gm, '')
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
    .trim();
}

const parts = [];
const included = new Set(MODULES);

for (const file of MODULES) {
  const source = await readFile(resolve(root, file), 'utf8');

  // Every module this one names has to be in the bundle too, and before it.
  // Forgetting one produces a page that loads fine and then throws on the first
  // keystroke, because the missing function is simply undefined.
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    const dependency = resolve(dirname(resolve(root, file)), specifier).slice(
      resolve(root).length + 1,
    );
    if (!included.has(dependency)) {
      throw new Error(`${file} imports ${dependency}, which is missing from MODULES`);
    }
    if (MODULES.indexOf(dependency) > MODULES.indexOf(file)) {
      throw new Error(`${dependency} must come before ${file} in MODULES`);
    }
  }

  const code = deModule(source);
  if (/^\s*(import|export)\s/m.test(code)) {
    throw new Error(`${file} still contains module syntax after stripping`);
  }
  parts.push(`// ---- ${file} ----\n${code}`);
}

const bundle = parts.join('\n\n');
if (bundle.includes('</script')) {
  throw new Error('Compiled source would break out of <script>');
}

// Footer facts come from package.json so the page can never disagree with what
// npm publishes. The year is left to the page itself, at render time.
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const meta = {
  name: pkg.name,
  version: pkg.version,
  license: pkg.license,
  author: String(pkg.author ?? '').replace(/\s*<.*$/, ''), // drop the e-mail
};

const template = await readFile(resolve(root, 'demo/template.html'), 'utf8');
const MARKER = '/*#LIBRARY*/';
if (!template.includes(MARKER)) throw new Error(`Missing ${MARKER} in template`);

// The stripped modules and the page script end up sharing one top-level scope,
// so two files declaring the same `const` is a SyntaxError that takes down the
// entire page — and it looks like a blank demo, not like a name clash. Cheap to
// catch here, miserable to debug there.
const topLevelNames = (code) => {
  const names = new Set();
  for (const m of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  return names;
};

const pageScript = template.slice(template.indexOf(MARKER) + MARKER.length);
const clashes = [...topLevelNames(bundle)].filter((n) => topLevelNames(pageScript).has(n));
if (clashes.length > 0) {
  throw new Error(
    `Top-level name clash between the library bundle and demo/template.html: ${clashes.join(', ')}. ` +
      'Rename one side — both share a single script scope on the page.',
  );
}

const META_MARKER = '/*#META*/';
if (!template.includes(META_MARKER)) throw new Error(`Missing ${META_MARKER} in template`);

// A function replacer, not a string: the bundle contains `$` + backtick from a
// template literal, and as a replacement string that is the special "everything
// before the match" pattern — it would splice the page's own <head> into the code.
const page = template
  .replace(MARKER, () => bundle)
  .replace(META_MARKER, () => `const META = ${JSON.stringify(meta)};`);

await mkdir(resolve(root, 'docs'), { recursive: true });
await writeFile(resolve(root, 'docs/index.html'), page);

console.log(`docs/index.html   ${(page.length / 1024).toFixed(1)} kB`);
console.log('open docs/index.html');
