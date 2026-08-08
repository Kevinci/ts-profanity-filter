// Generates demo/index.html from demo/template.html, inlining the *compiled*
// library from dist/ so the playground can never drift from what npm ships.
//
// The page is a plain standalone file — open it straight from disk, no server
// and no hosting involved.
//
// Run: npm run demo   (builds with tsc first)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order — these get concatenated into one classic <script> scope.
const MODULES = [
  'dist/lists/en.js',
  'dist/lists/de.js',
  'dist/lists/index.js',
  'dist/filter.js',
];

/** Turns an ES module into plain script-scope code. */
function deModule(source) {
  return source
    .replace(/^import\s[^;]*;$/gm, '') // drop cross-file imports
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, '') // drop re-export statements
    .replace(/^export\s+(?=const |function |class |let )/gm, '') // unwrap declarations
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
    .trim();
}

const parts = [];
for (const file of MODULES) {
  const source = await readFile(resolve(root, file), 'utf8');
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

const META_MARKER = '/*#META*/';
if (!template.includes(META_MARKER)) throw new Error(`Missing ${META_MARKER} in template`);

// A function replacer, not a string: the bundle contains `$` + backtick from a
// template literal, and as a replacement string that is the special "everything
// before the match" pattern — it would splice the page's own <head> into the code.
const page = template
  .replace(MARKER, () => bundle)
  .replace(META_MARKER, () => `const META = ${JSON.stringify(meta)};`);
await writeFile(resolve(root, 'demo/index.html'), page);

console.log(`demo/index.html   ${(page.length / 1024).toFixed(1)} kB`);
console.log('open demo/index.html');
