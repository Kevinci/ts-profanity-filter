# ts-profanity-filter

A strict TypeScript profanity filter that splits text into segments so your UI
can render the redaction itself — the library never mutates or masks your
string.

**English and German ship pre-registered; any other language is a
`registerLanguage()` call away.**

Zero runtime dependencies. Optional adapters for React, Vue and Angular.

**[Try it in the playground →](https://kevinci.github.io/ts-profanity-filter/)**

```bash
npm install ts-profanity-filter
```

## Usage

```ts
import { filterFWordsToSegments } from 'ts-profanity-filter';

const output = filterFWordsToSegments('This is bullsh1t.', { languages: ['en'] });

// [
//   { text: 'This is bull', isProfane: false },
//   { text: 'sh1t',         isProfane: true  },
//   { text: '.',            isProfane: false },
// ]
```

Concatenating every `segment.text` always reproduces the original input exactly,
so rendering is lossless:

```tsx
<p>
  {filterFWordsToSegments(comment).map((seg, i) =>
    seg.isProfane ? <span key={i} className="redacted">{seg.text}</span> : seg.text,
  )}
</p>
```

## The cross-check

Matching is **substring-based**. That is what catches `asshole` from `ass` and
survives obfuscation — but on its own it also flags `class`, `Klassik` and
`Massage`.

So every hit is checked against an allowlist of ordinary words before it counts.
The allowlist is anchored against the **whole surrounding word**, and an allowed
word always beats a blocked pattern:

```ts
filterFWordsToSegments('Der Klassiker war klasse.', { languages: ['en', 'de'] });
// -> one clean segment; the two `ass` hits are dropped

filterFWordsToSegments('Der Klassiker war klasse.', {
  languages: ['en', 'de'],
  crossCheck: false,          // raw substring matching
});
// -> `ass` flagged twice
```

Cross-checked out of the box, among others:

| Language | Blocked pattern | Ordinary words it would otherwise hit          |
| -------- | --------------- | ---------------------------------------------- |
| en       | `ass`           | class, pass, assistant, embarrass, potassium   |
| en       | `cunt`          | Scunthorpe                                     |
| en       | `cock`          | cocktail, cockpit, peacock                     |
| en       | `spic`          | spicy, suspicious, conspicuous                 |
| de       | `ass`           | Klassik, klassisch, Massage, Sparkasse, Tasse  |
| de       | `arsch`         | Marsch, marschieren, Barsch, harsch            |
| de       | `anal`          | Analyse, Kanal, banal, Analphabet              |
| de       | `cum` (via `k`) | Dokument, Kumpel, Publikum, Vakuum             |

Add your own with `allowList` — entries are regex sources matched against the
whole word:

```ts
filterFWordsToSegments('Die Assmann GmbH', {
  languages: ['en', 'de'],
  allowList: ['assmann', 'meine-firma\\p{L}*'],
});
```

## API

### `filterFWordsToSegments(text, options?): TextSegment[]`

| Option       | Type                    | Default  | Description                                                                       |
| ------------ | ----------------------- | -------- | --------------------------------------------------------------------------------- |
| `languages`  | `string[] \| '*'`       | `['en']` | Registered languages to match against. `'*'` uses every registered one.            |
| `crossCheck` | `boolean`               | `true`   | Drop a hit when the surrounding word is allowlisted. `false` = raw substrings.     |
| `allowList`  | `string[]`              | —        | Extra allowed words, added on top of the built-in allowlist. Regex sources.        |
| `customList` | `string[]`              | —        | Replaces the built-in patterns entirely. Regex sources. Empty array = fall back.   |
| `aggressive` | `boolean`               | `true`   | Also match lookalike spellings — see below.                                        |

Patterns are compiled with the `u` flag, so case-insensitive matching uses full
Unicode case folding — `SCHEIẞE` folds to `scheiße` and is caught. It also means
your patterns must be valid in unicode mode: a stray identity escape like
`\\-` is an error there. `registerLanguage` reports that up front.

```ts
interface TextSegment {
  text: string;
  isProfane: boolean;
}
```

## Lookalike matching

With `aggressive` on (the default) every letter is expanded into the things
people actually type to get past a filter:

| Kind | Example |
| --- | --- |
| leet | `Dr3cks4u`, `a$$hole`, `$hit`, `fu(k` |
| diacritics | `DräckSAU`, `ärschloch` |
| cross-script lookalikes | `Аrschloch` (Cyrillic А), `Sсheiße` (Cyrillic с) |

The diacritics are deliberately ambiguous: `ä` counts as an **a** *and* as an
**e**, because `Dräck` uses it as an e while `ärsch` uses it as an a. A
one-to-one normalisation would have to pick a side and get one of them wrong.

**The allowlist gets the same expansion.** That symmetry is the whole point —
without it `ass` matches the `4ss` in `Kl4ssik` while the allow entry still
only spells `klass`, and an ordinary word comes back flagged. `Kl4ssik`,
`M4ssage`, `Cl4ss` and `Fässer` all stay clean.

Separators, repetition and invisible characters are handled differently,
because they change the *length* of the text and no character class can reach
them. The text is rewritten for matching, and every rewritten character
remembers which slice of the original it came from — so matches are found in
the rewritten copy and sliced out of the original, and the segments still add
up to the input exactly.

| Kind | Example | Rule |
| --- | --- | --- |
| spaced out | `D r e c k s a u`, `D-r-e-c-k-s-a-u` | three or more whole one-letter words in a row |
| repetition | `Dreeecksau`, `fuuuuck` | runs of three or more identical characters collapse |
| invisible | `Dreck<ZWSP>sau` | formatting characters are dropped |
| decomposed | `a` + combining diaeresis | composed into `ä` first |

Doubles are left alone — `Klasse` and `Fässer` are ordinary spelling, and
collapsing them would break the allowlist. The spaced-out rule needs *whole*
one-letter words, which is what keeps `next to a cockroach` from collapsing
into `next toacockroach` and inventing a `cock`.

## Languages

`en` and `de` are simply the two that ship pre-registered. Nothing about the
library is limited to them.

```ts
import { registerLanguage } from 'ts-profanity-filter';

registerLanguage('fr', {
  profanity: ['merde', 'connard', 'salope', 'putain'],
  allow: ['\\p{L}*connaiss\\p{L}*'],   // connaissance, connaisseur
});

filterFWordsToSegments('Quelle merde', { languages: ['fr'] });
```

**Regional variants inherit instead of duplicating.** A parent's patterns come
first, yours are added on top — including its allowlist, so the false positives
it already solved stay solved:

```ts
registerLanguage('de-AT', { extends: 'de', profanity: ['oasch', 'gschissana'] });

filterFWordsToSegments('Du Oasch, du Trottel!', { languages: ['de-AT'] });
// both flagged: 'oasch' is the variant's, 'Trottel' is inherited from 'de'
```

**Lookups fall back along BCP-47 subtags.** `de-AT-1996` tries `de-at-1996`,
then `de-at`, then `de` — so an unregistered `de-CH` still works, and codes
are case-insensitive.

**Use everything at once** with `'*'`:

```ts
filterFWordsToSegments(text, { languages: '*' });
```

**Patterns are validated when you register them**, not when text is filtered, so
a typo fails at startup naming the offending entry rather than throwing inside a
moderation request:

```
SyntaxError: registerLanguage('fr'): profanity[1] "(unclosed" is not a
valid regular expression — Invalid regular expression: /(unclosed/gi:
Unterminated group
```

An **unknown language throws** rather than being ignored — silently matching
nothing is the worst way for a moderation filter to fail.

### Registry API

| Function | Purpose |
| --- | --- |
| `registerLanguage(code, def)` | Add or replace a language. `def` is `{ profanity?, allow?, extends? }`. |
| `unregisterLanguage(code)` | Remove one. Refuses while another language extends it. |
| `resetLanguages()` | Back to just the built-in `en` and `de`. |
| `getLanguage(code)` | Resolved lists, `extends` flattened and subtags applied. |
| `hasLanguage(code)` / `resolveKey(code)` | Existence check / which code it resolves to. |
| `listLanguages()` | Every registered code. |

The built-in packs are importable on their own, which is also the shape a
third-party language pack should export:

```ts
import { en, EN_PROFANITY, EN_ALLOWLIST } from 'ts-profanity-filter/lang/en';
import { de } from 'ts-profanity-filter/lang/de';

registerLanguage('en-custom', { extends: 'en', profanity: ourExtraWords });
```

Both are registered by the main entry point, so they are in your bundle whether
or not you use them — `unregisterLanguage` changes behaviour, not bundle size.

## No framework

The package is plain ESM with no dependencies, so a module script and a CDN
import are the whole setup — no build step, nothing to install.

```html
<textarea id="draft"></textarea>
<p id="output"></p>

<style>
  .redacted { background: currentColor; border-radius: 1px; }
</style>

<script type="module">
  import { filterFWordsToSegments } from 'https://esm.sh/ts-profanity-filter';

  const draft = document.getElementById('draft');
  const output = document.getElementById('output');

  function render() {
    const segments = filterFWordsToSegments(draft.value, { languages: ['en', 'de'] });

    output.replaceChildren(
      ...segments.map((seg) => {
        const node = document.createElement('span');
        if (seg.isProfane) node.className = 'redacted';
        node.textContent = seg.text;   // textContent, never innerHTML
        return node;
      }),
    );
  }

  draft.addEventListener('input', render);
  render();
</script>
```

`node.textContent = seg.text` is the line that matters. What you are rendering
is whatever a stranger typed, and pushing it through `innerHTML` would hand
them your page. Because the API returns segments rather than a marked-up
string, building nodes is both the safe route and the obvious one.

To use a local install instead of a CDN, point an import map at it:

```html
<script type="importmap">
  {
    "imports": {
      "ts-profanity-filter": "/node_modules/ts-profanity-filter/dist/index.js"
    }
  }
</script>
```

If all you need is the verdict or a masked string:

```js
const segments = filterFWordsToSegments(text, { languages: ['en', 'de'] });

const isProfane = segments.some((seg) => seg.isProfane);

const masked = segments
  .map((seg) => (seg.isProfane ? '*'.repeat(seg.text.length) : seg.text))
  .join('');
```

## Framework adapters

Each adapter is a separate subpath import, so nothing you do not use reaches
your bundle. `react` and `vue` are **optional** peer dependencies.

### React

```tsx
import { useProfanitySegments, useIsProfane } from 'ts-profanity-filter/react';

function Comment({ body }: { body: string }) {
  const segments = useProfanitySegments(body, { languages: ['en', 'de'] });
  return (
    <p>
      {segments.map((seg, i) =>
        seg.isProfane ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
      )}
    </p>
  );
}
```

Memoised by the **value** of the options, not their identity — an inline object
literal will not re-run the filter on every render.

### Vue

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useProfanitySegments } from 'ts-profanity-filter/vue';

const body = ref('');
const segments = useProfanitySegments(body, { languages: ['en', 'de'] });
</script>
```

Both arguments accept a plain value, a ref, or a getter; you get back a computed
ref. Needs Vue 3.3+ (for `toValue`).

### Angular

A class carrying a real `@Pipe()` decorator has to be compiled by Angular's own
compiler, and a plain `tsc` build cannot produce that — an AOT build in your app
would reject it. So this package ships the **logic without decorators**, and you
add the decorator in your app where `ngtsc` compiles it properly:

```ts
// profanity-segments.pipe.ts — the whole file
import { Pipe } from '@angular/core';
import { ProfanitySegmentsPipeBase } from 'ts-profanity-filter/angular';

@Pipe({ name: 'profanitySegments', standalone: true })
export class ProfanitySegmentsPipe extends ProfanitySegmentsPipeBase {}
```

```html
<span *ngFor="let seg of body | profanitySegments:{ languages: ['en','de'] }"
      [class.redacted]="seg.isProfane">{{ seg.text }}</span>
```

The base class caches by value, which matters because a pure pipe re-runs
whenever a template's object literal gets a new identity.

There is also a plain service class (no `@Injectable()`, so provide it
explicitly):

```ts
import { ProfanityFilter } from 'ts-profanity-filter/angular';

providers: [
  { provide: ProfanityFilter, useFactory: () => new ProfanityFilter({ languages: ['en', 'de'] }) },
]

filter.mask('Du Trottel!'); // 'Du *******!'
```

Because it imports nothing from `@angular/core`, Angular is not a peer
dependency of this package at all.

## Playground

**<https://kevinci.github.io/ts-profanity-filter/>**

Bilingual UI (English/German), live segmentation, three render modes, and a
table showing exactly which false positives the cross-check suppressed and
which allowlist rule cleared them.

The page is a single self-contained file generated from the compiled `dist/`,
so it always runs the same code npm ships. To work on it locally:

```bash
npm run demo        # tsc, then regenerate docs/index.html
open docs/index.html
```

Edit `demo/template.html`, never `docs/index.html` — the latter is generated.
GitHub Pages serves it straight from `main`, so a push updates the live page.

## Known limitations

- **German compounding** forces permissive allow entries like
  `\p{L}*klass\p{L}*`. A contrived word containing both a slur and an allowed
  stem comes out clean. Allowed always beats blocked.
- **`dick` is German for "thick".** With the German list active it is
  allowlisted, which necessarily clears the English word too. Use
  `languages: ['en']` for English-only text.
- **`customList` replaces the patterns but not the allowlist.** A custom `ass`
  pattern still loses against an allowlisted `Klassik`. Combine with
  `crossCheck: false` if you want nothing suppressed.
- **`aggressive` rewrites the regex source**, letters and all, so a pattern
  carrying its own syntax breaks: `[abc]` becomes `[[a@4]b[c(k<]]` and
  `(?<word>…)` becomes `(?<w[o0]rd>…)`. Both are rejected at registration.
  Write patterns as plain words, or turn `aggressive` off for hand-written
  regexes.
- **Word lists are a starting point, not a policy.** Extend them for your domain.

## Scripts

```bash
npm run build      # tsc -> dist/ (.js, .d.ts, .d.ts.map, .js.map)
npm test           # builds, then runs node --test
npm run typecheck  # type-checks src + test
npm run demo       # builds and regenerates docs/index.html
```

## License

MIT
