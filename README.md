# ts-profanity-filter

A strict TypeScript profanity filter that splits text into segments so your UI
can render the redaction itself — the library never mutates or masks your
string.

**English and German ship pre-registered; any other language is a
`registerLanguage()` call away.** Leet spellings, lookalike letters, spaced-out
words and repetition are matched; a cross-check keeps ordinary words like
`Klassik` and `classic` out of the results.

**Optionally, a model reads the whole sentence** for what no word list can see —
hate, threats, harassment — via Gemini or Claude. Off unless you ask for it.

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

**[Run this example on JSFiddle →](https://jsfiddle.net/7x6mtawo/)**

```html
<textarea id="draft"></textarea>
<p id="output"></p>

<style>
  .redacted { background: currentColor; border-radius: 1px; }
</style>

<script type="module">
  import { filterFWordsToSegments } from 'https://cdn.jsdelivr.net/npm/ts-profanity-filter@1.1.0/+esm';

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

### CDNs

Nothing to set up — every npm CDN serves the package automatically, subpath
imports included. [The jsDelivr package page](https://www.jsdelivr.com/package/npm/ts-profanity-filter)
lists every published file and version.

| CDN | URL |
| --- | --- |
| jsDelivr | `https://cdn.jsdelivr.net/npm/ts-profanity-filter@1.1.0/+esm` |
| esm.sh | `https://esm.sh/ts-profanity-filter@1.1.0` |
| unpkg | `https://unpkg.com/ts-profanity-filter@1.1.0/dist/index.js` |

```js
import { useProfanitySegments } from 'https://esm.sh/ts-profanity-filter@1.1.0/react';
import { de } from 'https://esm.sh/ts-profanity-filter@1.1.0/lang/de';
```

**Pin the version.** An unpinned URL like `https://esm.sh/ts-profanity-filter`
always resolves to the newest release, so your page starts running different
code the next time this package is published — without you changing anything.
Fine for a playground, not for production.

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

## AI check (optional)

Word lists catch **words**. They cannot tell that a sentence containing no
listed word at all is a threat, or that one full of them is a quotation. That
judgement is what a model adds.

Nothing to install for the Gemini path — it is a plain `fetch`, and Google's
free tier covers this use case:

```ts
import { moderateText } from 'ts-profanity-filter/ai';

const result = await moderateText(comment, {
  languages: ['en', 'de'],
  ai: { provider: 'gemini', enabled: true },   // key read from GEMINI_API_KEY
});

result.matchedList    // a word list matched
result.ai.flagged     // the model flagged the sentence as a whole
result.flagged        // either of the two
```

**It is off unless you ask for it.** No `ai` option means no model is contacted,
and `moderateText` is then just the local filter in a wrapper. `enabled: false`
keeps the configuration around with the check switched off.

### Two providers

```ts
ai: { provider: 'gemini', enabled: true }   // key from GEMINI_API_KEY
ai: { enabled: true }                        // anthropic, key from ANTHROPIC_API_KEY
```

| | Needs | Default model | Key from |
| --- | --- | --- | --- |
| `gemini` | nothing — plain `fetch` | `gemini-flash-lite-latest` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier |
| `anthropic` | `@anthropic-ai/sdk` | `claude-opus-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) — paid |

Gemini is the cheapest way to try this: its free tier covers the use case and it
adds no dependency at all. `ai.model` takes any id the provider accepts;
`AI_MODELS` lists a few per provider for populating a picker.

The Gemini list is the one verified against a fresh free-tier key, which is not
the same as the list the models endpoint returns: `gemini-2.5-flash` is
advertised there but rejected for new accounts ("no longer available to new
users"), and `gemini-2.0-flash` is out of free quota. The default is
`gemini-flash-lite-latest` because an alias cannot go stale that way.

One thing worth knowing about the Gemini provider: it sends `BLOCK_NONE` for
Google's own safety categories. For a moderation classifier that default is
backwards — the text you need it to read is exactly the text it otherwise
refuses to look at. It is safe here *because* the output is a verdict rather
than generated content: the model labels text you already have, it never
produces any.

### What the model reports

| Category | Covers |
| --- | --- |
| `racism` | racial or ethnic slurs; dehumanising by origin or skin colour |
| `hate` | contempt toward a group — religion, ethnicity, nationality, sexuality, gender, disability |
| `violence` | threats, calls to harm, approval of harm; incitement against a whole group is the most severe form |
| `harassment` | insults and degradation aimed at a specific person |
| `sexual` | explicit or obscene sexual content |
| `sexual_minors` | sexualisation of a minor, grooming, predatory approaches |
| `self_harm` | encouraging suicide or self-injury |

Alongside them: a `severity` (`none` … `critical`), a `confidence`, and one
sentence of `reason` in the language of the text.

### `ai` options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` when `ai` is present | The switch. No `ai` at all means no model is contacted. |
| `provider` | `'anthropic' \| 'gemini'` | `'anthropic'` | `gemini` needs no SDK and has a free tier. |
| `apiKey` | `string` | `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Keep it server-side. |
| `model` | `string` | per provider | Any id the provider accepts; `AI_MODELS` lists a few. |
| `categories` | `AiCategory[]` | all seven | Narrow what is checked. |
| `prompt` | `string` | built-in | Replaces the system prompt entirely. |
| `extraInstructions` | `string` | — | Appended to the built-in prompt. |
| `languageHint` | `string` | auto-detect | e.g. `'German'`. |
| `effort` | `'low'…'max'` | `'low'` | Anthropic only. This is a classification, not an essay. |
| `maxTokens` | `number` | `4096` | |
| `timeoutMs` | `number` | `20000` | |
| `fallback` | `boolean` | `true` | Anthropic only: retry on another model if its safety layer declines. |
| `onError` | `'return' \| 'throw'` | `'return'` | A failed check is a decision, not an exception. |
| `complete` | `AiCompletion` | — | Bring your own model; bypasses both built-in providers. |

Both functions are exported: `moderateText(text, options)` runs the local
filter *and* the model, `analyzeWithAi(text, aiOptions)` runs only the model.

### Your own prompt

The built-in prompt describes each category rather than listing example slurs —
spelling them out would ship those words in every request and teach the filter
one exact wording. Extend it, or replace it:

```ts
ai: {
  enabled: true,
  categories: ['racism', 'hate', 'violence'],   // narrow the check
  extraInstructions: 'Football banter is fine here.',  // added to the default
  prompt: myOwnSystemPrompt,                    // replaces it entirely
  languageHint: 'German',
  effort: 'low',                                // cheap by default
}
```

### Failure is a decision, not an exception

`moderateText` never throws by default — a moderation call that fails should be
something you decide about, not something that takes down the request:

```ts
switch (result.ai.status) {
  case 'ok':       break;                        // a verdict was produced
  case 'disabled': break;                        // the check is switched off
  case 'refused':  hold(result.ai.error); break; // the provider's own safety layer declined
  case 'error':    hold(result.ai.error); break; // the call failed
}
```

A failed or refused check **never** reports `flagged: true` — absence of a
verdict is not a clean bill of health. Set `onError: 'throw'` if a missing
verdict should stop the request instead. The API key is stripped from error
messages before they are returned.

### Any model, not just Claude

`ai.complete` replaces the built-in provider with anything that takes a system
prompt plus text and returns JSON matching the schema. It is also how the test
suite runs without a network:

```ts
import type { AiCompletion } from 'ts-profanity-filter/ai';

const myModel: AiCompletion = async ({ system, text, schema }) => ({
  json: await callWhateverYouLike(system, text, schema),
});
```

### A runnable server endpoint

`examples/server` is the whole shape in one file: a browser page, an endpoint,
and the key staying in the server process.

```bash
cd examples/server
cp .env.example .env        # put your key in it — .env is gitignored
npm install && npm start    # http://localhost:8787
```

It reads the key from the environment rather than the request body, returns a
verdict rather than the machinery behind it, caps the body size, and rate-limits
per IP — an endpoint that spends money per call needs all four. See its README
for what it deliberately leaves out (auth, above all).

### Keep the key server-side

An API key shipped to a browser is readable by everyone who loads the page and
spendable by all of them — no amount of obfuscation changes that. Run the check
on your server and send the verdict to the client, never the key. The word-list
half of this library runs happily in the browser; the model half does not belong
there.

Defaults worth knowing: `effort: 'low'` (this is a
classification, not an essay), a 20-second timeout, and provider-side retry on
another model if Anthropic's own safety layer declines the request — moderation
text is exactly the kind of input that trips those classifiers, and a refusal is
not a verdict. Turn that off with `fallback: false`.

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

The AI panel runs the check from the page itself: pick a provider and model,
paste your **own** key, and see both signals for the same sentence — what the
word lists caught, and what the model made of it. The key is never stored and
goes only to the provider. That is a playground pattern, not a production one;
see *Keep the key server-side* above.

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
- **The AI check costs money or quota, and adds latency.** It is one network
  round trip per call. Run the local filter first and reach for the model only
  when it matters — or use `ai: false` on the cheap path.
- **A model verdict is a second opinion, not ground truth.** It has a
  `confidence` for a reason. Treat a flag as a reason to hold a message for
  review, not as a conviction, and keep a human in the loop for anything
  consequential.
- **A failed or refused check reports `flagged: false`.** Absence of a verdict
  is not a clean bill of health — branch on `ai.status`, do not read
  `ai.flagged` alone.
- **The Gemini provider disables Google's own safety filtering.** It has to:
  the text a moderation classifier must read is the text those filters refuse to
  look at. Safe here because the output is a verdict, never generated content.

## Scripts

```bash
npm run build      # tsc -> dist/ (.js, .d.ts, .d.ts.map, .js.map)
npm test           # builds, then runs node --test
npm run typecheck  # type-checks src + test
npm run demo       # builds and regenerates docs/index.html
```

## License

MIT
