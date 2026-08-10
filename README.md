# ts-profanity-filter

[![npm version](https://img.shields.io/npm/v/ts-profanity-filter)](https://www.npmjs.com/package/ts-profanity-filter)
[![bundle size](https://img.shields.io/bundlejs/size/ts-profanity-filter)](https://bundlejs.com/?q=ts-profanity-filter)
[![license](https://img.shields.io/npm/l/ts-profanity-filter)](https://github.com/Kevinci/ts-profanity-filter/blob/main/LICENSE)

A strict TypeScript profanity filter that splits text into segments so your UI
can render the redaction itself — the library never mutates or masks your
string.

**English and German ship pre-registered; any other language is a
`registerLanguage()` call away.** Leet spellings, lookalike letters, spaced-out
words and repetition are matched; a cross-check keeps ordinary words like
`Klassik` and `classic` out of the results.

Zero runtime dependencies. Optional adapters for React, Vue and Angular, an
optional AI check, a **PII detector** for e-mail addresses, phone numbers,
IBANs and cards, a **streaming batch runner** with a CLI for corpora that do not
fit in memory, and an optional generator for the **DSA Art. 17** statement of
reasons you owe whoever you moderated. Each is its own subpath, so nothing you
do not import reaches your bundle.

**[Try it in the playground →](https://kevinci.github.io/ts-profanity-filter/)**

```bash
npm install ts-profanity-filter
```

---

## New in 1.4.0 · PII detection

**A moderation filter that cannot see an IBAN is half a filter.** The same
comment box that collects insults collects phone numbers, bank details and card
numbers, and `ts-profanity-filter/pii` reports those the way this library reports
everything — as spans, so the redaction stays yours to render.

```ts
import { detectPii } from 'ts-profanity-filter/pii';

detectPii('IBAN DE44 5001 0517 5407 3249 31, Tel. 030 12345678');
// [
//   { kind: 'iban',  confidence: 0.99, evidence: ['structure', 'checksum', 'context'], … },
//   { kind: 'phone', confidence: 0.99, evidence: ['structure', 'context'], … },
// ]
```

**The admission criterion is that a finding can be verified.** An IBAN passes
mod-97 and its country's length, a card passes Luhn and owns its issuer prefix, a
German tax id passes ISO 7064 *and* the repetition rule the BZSt guarantees.
Names, postal addresses and dates of birth are missing on purpose: nothing inside
the string can confirm them, and a detector that guesses at those turns every
capitalised word into a finding.

**It is one pass, not six regexes.** The text is walked once for anchors, digit
clusters are built once and interpreted by three recognizers, every candidate is
*scored* rather than accepted, and overlaps are settled by weighted interval
scheduling — because `::ffff:192.168.1.1` is an IPv6 address containing an IPv4
one, and resolving greedily from the left picks the earliest candidate rather
than the best one.

[The full section →](#personal-data) ·
[Try it in the playground →](https://kevinci.github.io/ts-profanity-filter/#sec-pii)

**Also in this release:**

- **The playground shows what it suppresses.** The new panel has a switch that
  drops `minConfidence` to 0.2, so the findings that scored too low to be
  reported become visible in grey instead of being invisible.
- **The demo build now catches a clash the old guard could not.** Its modules
  share one script scope on the page, and two of them declaring the same
  top-level `const` is a `SyntaxError` that blanks the whole page. The check
  compared the bundle against the page script but never against itself — it now
  does, which is how `SEPARATOR` and `ALNUM` were caught before shipping.

---

## DSA Article 17 · the statement of reasons

**In the EU, deleting the comment is only half the obligation.** Article 17 of
the Digital Services Act requires that whoever is moderated gets a *statement of
reasons*: what was done, on which ground, on which facts, whether an automated
system was involved, how long it lasts, and where to contest it — in their
language, on a durable medium they can keep.

A filter that returns `flagged: true` gives you none of that. So the new
`ts-profanity-filter/compliance` subpath builds the notice out of the moderation
result you already have:

```ts
import { moderateText } from 'ts-profanity-filter/ai';
import {
  generateJustification,
  formatJustificationAsText,
} from 'ts-profanity-filter/compliance';

const result = await moderateText(comment, {
  languages: ['de'],
  ai: { provider: 'gemini', enabled: true },   // the graded verdict
});

const notice = await generateJustification(comment, result, {
  action: 'CONTENT_REMOVED',
  policyBases: [{ name: 'Community Guidelines', section: '§4.2' }],
  appealUrl: 'https://example.com/appeal/8f21',
  ai: { provider: 'gemini', enabled: true },   // wording only — optional
});

formatJustificationAsText(notice);   // the text you send the user
exportJustification(notice);         // the JSON you keep for your records
```

**The facts are never the model's to decide.** Action, policy basis, categories,
severity, confidence, the quoted excerpt and the timestamp are all fixed by the
code before any model is asked. What a model contributes is the two things a
template cannot write: a `reason` that names the measure and the behaviour in one
breath, and an `assessment` that weighs the case — and says so plainly when the
call is uncertain. Leave `ai` out and the built-in German and English templates
carry the notice on their own.

[The full section →](#dsa-art-17-justifications) ·
[See one generated →](https://kevinci.github.io/ts-profanity-filter/#sec-compliance)

**Also in 1.3.0, alongside this:**

- **A third AI provider that needs no network.** `ollama` runs the check on your
  own machine — no key, no third party, the same JSON Schema constraining the
  answer, so switching is a config change and not a second code path. See
  [Nothing leaves the building](#nothing-leaves-the-building).
- **Three false positives and a Cyrillic `к` fixed**, found by pointing an
  adversarial benchmark of 81 attacks at this filter. `Cockburn`, `Lightwater`
  and `Matsushita` are names, which is the most expensive kind of false
  positive; `к` was never in the expandable set, so no pattern could reach it.
  English went from 82/83 to 94/100, German to 74/100, both with regression
  tests.

---

## AI integration

**Optionally, a model reads the whole sentence** — for what no word list can
see. A message can be a threat without containing a single listed word, and it
can be full of them and still be a quotation. Word lists cannot tell the
difference; this can.

It reports hate, threats, harassment, racism, obscenity, sexual content
involving minors and pressure toward self-harm — with a severity, a confidence,
one sentence of reasoning in the language of the text, and the exact stretch it
objected to, so you can highlight it.

```ts
import { moderateText } from 'ts-profanity-filter/ai';

const result = await moderateText(comment, {
  languages: ['en', 'de'],
  ai: { provider: 'gemini', enabled: true },   // key from GEMINI_API_KEY
});

result.matchedList   // a word list matched
result.ai.flagged    // the model flagged the sentence as a whole
result.flagged       // either of the two
```

**Google Gemini** needs nothing installed — it is a plain `fetch`, and the free
tier covers this. **Anthropic Claude** works through the optional SDK. Or bring
any model at all with `ai.complete`.

**Off unless you ask for it.** No `ai` option means no model is contacted and
nothing leaves your machine — the word-list half never calls out at all.

[The full section →](#ai-check-optional) ·
[Try it with your own key →](https://kevinci.github.io/ts-profanity-filter/#sec-ai)

---

## Unicode hardening

**Evasion is a Unicode problem**, and the matching path treats it as one.
Compatibility spellings fold with NFKC to the letters the patterns are written
in, so `Ｄｒｅｃｋｓａｕ`, `𝐃𝐫𝐞𝐜𝐤𝐬𝐚𝐮` and `Ⓓⓡⓔⓒⓚⓢⓐⓤ` stop walking past the
list. Whole-word anchors use Unicode boundaries instead of `\b` — which is
defined in terms of `\w` and stays ASCII even under the `u` flag, so every
umlaut and every `ß` read as a word boundary and `Straußschwanz` came back
flagged.

Iteration is by code point rather than code unit, and the offset map carries one
entry per output character, so a folded character that expands still points back
at the one it came from — and a segment boundary can no longer land inside a
surrogate pair.

Seventeen cases assert the **offsets**, not the round trip. Rebuilding the
string intact proves only that nothing was dropped; it says nothing about
whether the flagged span still covers the right characters, which is exactly
where a filter holding three representations of the input — original, folded
haystack, segments — goes wrong.

---

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
| compatibility forms | `Ｄｒｅｃｋｓａｕ`, `𝐃𝐫𝐞𝐜𝐤𝐬𝐚𝐮`, `Ⓓⓡⓔⓒⓚⓢⓐⓤ` | folded with NFKC to the plain letters |

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
  import { filterFWordsToSegments } from 'https://cdn.jsdelivr.net/npm/ts-profanity-filter@1.4.0/+esm';

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
| jsDelivr | `https://cdn.jsdelivr.net/npm/ts-profanity-filter@1.4.0/+esm` |
| esm.sh | `https://esm.sh/ts-profanity-filter@1.4.0` |
| unpkg | `https://unpkg.com/ts-profanity-filter@1.4.0/dist/index.js` |

```js
import { useProfanitySegments } from 'https://esm.sh/ts-profanity-filter@1.4.0/react';
import { de } from 'https://esm.sh/ts-profanity-filter@1.4.0/lang/de';
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

### Three providers, one of them local

```ts
ai: { provider: 'gemini', enabled: true }   // key from GEMINI_API_KEY
ai: { enabled: true }                        // anthropic, key from ANTHROPIC_API_KEY
ai: { provider: 'ollama', model: 'llama3.2' } // your machine, no key, no network
```

| | Needs | Default model | Key from |
| --- | --- | --- | --- |
| `gemini` | nothing — plain `fetch` | `gemini-flash-lite-latest` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier |
| `anthropic` | `@anthropic-ai/sdk` | `claude-opus-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) — paid |
| `ollama` | a running [Ollama](https://ollama.com) | `llama3.2` | no key at all |

#### Nothing leaves the building

`ollama` answers the objection that makes this whole feature a non-starter for
some deployments: that moderating a message means handing it to a third party.

```ts
const result = await moderateText(comment, {
  languages: ['de'],
  ai: { provider: 'ollama', model: 'gemma3' },
});
```

Same prompt, same schema, same verdict shape as the hosted providers — Ollama
constrains decoding to the JSON Schema exactly as they do, so switching is a
config change rather than a different code path. Point `ai.baseUrl` at another
host, or set `OLLAMA_HOST`; a bearer token is sent only if you supply one, for
the case where the server sits behind an authenticating proxy.

Two things to expect. It is **slower** — a first call also loads the weights, and
a 9 GB model took 34 seconds on a warm laptop, which is why the default timeout
for this provider is 120 s rather than 20 s. And it is **only as good as the
model you pulled**: a small instruct model handles clear-cut cases well and gets
vaguer at the edges, which is the trade you are making for the text never
leaving the host.

For anything else — transformers.js, a hosted open-weights endpoint, your own
fine-tune — `ai.complete` takes any function that returns JSON matching the
schema. See [Any model, not just Claude](#any-model-not-just-claude).

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

Alongside them: a `severity` (`none` … `critical`), a `confidence`, one
sentence of `reason` in the language of the text, and a `quote` — the stretch
of the input the model objected to, copied verbatim so you can locate and
highlight it:

```ts
const at = result.ai.quote ? text.indexOf(result.ai.quote) : -1;
if (at !== -1) highlight(at, at + result.ai.quote.length);
```

Check it against the original before using it, as above. A model can paraphrase
despite being told not to, and a span that does not match must not be invented.

### `ai` options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` when `ai` is present | The switch. No `ai` at all means no model is contacted. |
| `provider` | `'anthropic' \| 'gemini' \| 'ollama'` | `'anthropic'` | `gemini` needs no SDK and has a free tier; `ollama` needs no key and no network. |
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

### What leaves your machine, and whose problem it is

**This package sends nothing on its own.** It ships no key and has no account.
Without an `ai` option it makes no network call at all, and the word-list half
never does under any circumstances. When you switch the check on, the call goes
out under *your* key, to *your* account, on *your* decision.

That is worth being precise about, because it decides who answers for it: you
are the controller of that processing, and the provider is your processor. Under
the GDPR that means you need a lawful basis for sending user-submitted text to
them, a data processing agreement with them, and a privacy notice that says so.
None of that is something a library can do for you.

**The free Gemini tier is not suitable for production data.** From
[Google's Gemini API terms](https://ai.google.dev/gemini-api/terms):

> To help with quality and improve our products, human reviewers may read,
> annotate, and process your API input and output.

On the paid tier the same terms say the opposite — "Google doesn't use your
prompts … or responses to improve our products". The free tier is the right way
to *try* this feature; it is the wrong way to run it on real user messages.
Check Anthropic's current terms the same way before relying on either.

The moderation case makes this sharper than usual: the text you send is, by
definition, the text somebody wrote when they were at their worst. Three ways
to keep that proportionate:

- **Filter first, ask second.** Run the local lists on everything and reach for
  the model only on what they cannot settle. Most messages never leave.
- **Send the message, not the person.** No names, no ids, no metadata — the
  check takes a string and nothing else.
- **Or keep it in-house.** `ai.complete` takes any model, including one you run
  yourself, and nothing about the rest of the feature changes.

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

## DSA Art. 17 justifications

Article 17 of the [Digital Services
Act](https://eur-lex.europa.eu/eli/reg/2022/2065/oj) applies to any hosting
provider that restricts something a user posted — removal, demotion, a feature
lock, a suspension. The user is owed a statement of reasons, and the article
lists what has to be in it: the measure and its scope and duration, the facts
the decision rests on, the ground relied on, whether automated means were used,
and how to contest it.

`ts-profanity-filter/compliance` assembles that from a `ModerationResult`.

```ts
import {
  generateJustification,
  exportJustification,
  formatJustificationAsText,
  InMemoryJustificationStore,
} from 'ts-profanity-filter/compliance';
```

### What ends up in the record

| Field | Comes from | Art. 17 point it answers |
| --- | --- | --- |
| `action` | you | which measure — `CONTENT_REMOVED`, `CONTENT_DEMOTION`, `ACCOUNT_SUSPENSION`, `ACCOUNT_TERMINATION`, `FEATURE_RESTRICTION` |
| `duration` | you | its scope in time — `'7d'`, `'permanent'`, … |
| `policyBases` | you | the ground: a name, an optional `section`, an optional `url` to the rule |
| `facts.quote` | the model's excerpt, else the words the lists matched | *which* content, verbatim |
| `facts.categories` | the AI check | what it was classified as |
| `facts.severity` | the AI check | how heavily it weighs |
| `facts.confidence` | the AI check | how sure the classification was |
| `facts.automatedDetection` | computed | whether automation was involved — Art. 17(3)(c) |
| `facts.humanReview` | always `false` | see below |
| `reason` | template or model | one sentence, in the user's language |
| `assessment` | template or model | two or three sentences weighing the case |
| `appealUrl` | you | the redress route |
| `timestamp`, `language` | computed | when, and in which language |

`language` is auto-detected between `de` and `en` from the text unless you pass
one. Pass it explicitly if you know the user's language — which you usually do,
and it is *their* language the notice owes, not the language they happened to
write that sentence in.

### The division of labour

**A model may word the notice. It may not decide anything in it.** The facts are
handed to it as data, together with an instruction that quoted text is material
under judgement and not instructions to follow. It writes two fields and nothing
else; a reply that fails to parse leaves the templates in place.

That split is what makes the optional model safe here. An invented category or a
made-up date in a notice like this is exactly the error that loses an appeal.

```ts
ai: {
  enabled: true,
  provider: 'gemini',
  extraInstructions: 'Sign off as the Beispiel.de moderation team.',
}
```

Same rule as the AI check: **no `ai` option means no model is contacted.** The
templates then write both fields, in German or English, and that is a complete
notice — blunter, not incomplete.

### `severity: 'none'` means ungraded, not harmless

When only a word list matched, no model graded anything. Writing "severity:
none" into the notice would read as a considered finding that the content was
fine, which is not what happened — so the severity line is simply absent from
the rendered text, and the template assessment says what was actually
established:

> Die zitierte Stelle entspricht einem Begriff aus der Wortliste der geprüften
> Sprachen. Damit steht fest, welche Wörter gefallen sind — nicht, was der Satz
> mit ihnen tut. Eine solche Feststellung wird hier auch nicht behauptet.

Overstating there would mean inventing grounds. The same reticence applies to
categories and confidence: those lines are omitted rather than printed as
`(none)` and `0%`.

### Storing it

Art. 17 wants the statement on a durable medium — retrievable next month, not a
toast that disappears. `JustificationStore` is a two-method interface for that,
and `InMemoryJustificationStore` implements it for demos:

```ts
interface JustificationStore {
  save(id: string, justification: ComplianceJustification): Promise<void>;
  get(id: string): Promise<ComplianceJustification | null>;
  list?(): Promise<string[]>;
}
```

**The in-memory one is not a production store** — it is a `Map`, and a restart
erases every notice you owe. Implement the interface against your database.
`exportJustification` gives you the JSON to put in a column.

`examples/server` shows the round trip: `POST /api/justifications` moderates,
generates and stores, returning an id; `GET /api/justifications/:id` is the
durable link you put in the notice.

### It never throws

A failed model call must not stop a legal notification from going out.
`generateJustification` catches everything: on a refusal, a timeout or
unparseable JSON it returns the template wording. There is no code path where
you get no notice at all.

### What this is not

- **Not legal advice, and not compliance in a box.** It produces the artefact;
  whether your process around it satisfies the DSA is your assessment to make,
  with your own counsel.
- **`humanReview` is hardcoded `false`.** The library cannot know whether a
  person looked at the case. If one did, set it on the object before you store
  it — and note that Art. 17 is *why* you would want to: a purely automated
  restriction has to say so.
- **Nothing distinguishes "illegal content" from "incompatible with your terms".**
  Art. 17(3) treats those as different grounds with different consequences. The
  module has one `policyBases` list, so that distinction is yours to encode —
  `{ name: 'Legal', section: '§ 130 StGB' }` versus your house rules.
- **No complaint handling (Art. 20), no transparency database submission
  (Art. 24(5)).** Those are systems, not strings. This module writes the notice
  that both of them start from.

## Personal data

`ts-profanity-filter/pii` finds e-mail addresses, phone numbers, IBANs, payment
cards, IP addresses and German tax ids — as spans, like everything else here, so
the redaction stays yours to render.

```ts
import { detectPii, piiToSegments } from 'ts-profanity-filter/pii';

detectPii('Meine IBAN ist DE44 5001 0517 5407 3249 31, Tel. 030 12345678');
// [
//   { kind: 'iban',  text: 'DE44 5001 0517 5407 3249 31', start: 15, end: 42,
//     confidence: 0.99, evidence: ['structure', 'checksum', 'context'] },
//   { kind: 'phone', text: '030 12345678', start: 49, end: 61,
//     confidence: 0.99, evidence: ['structure', 'context'] },
// ]
```

### Only what can be verified

| Kind | What confirms it |
| --- | --- |
| `email` | structure — local part, labels, TLD, all length-checked |
| `iban` | **ISO 13616 mod-97**, plus the country's published length |
| `card` | **Luhn**, plus an issuer prefix that owns that length |
| `taxid-de` | **ISO 7064 MOD 11,10**, plus the BZSt repetition rule |
| `ip` | octet ranges; IPv6 group counting, compression and embedded IPv4 |
| `phone` | E.164 length, a trunk zero, or a word nearby that says so |

**Names, postal addresses and dates of birth are missing on purpose.** They are
personal data too, but nothing inside the string can confirm them, and a
detector that guesses turns every capitalised word into a finding. Everything on
that list either verifies arithmetically or is honest about leaning on context.

### How it decides

Four stages, and each exists because the obvious alternative is worse:

1. **One O(n) scan** records the only three things worth anchoring on: `@`
   positions, digit runs, colons. Six regexes over the text would walk it six
   times and still miss the grouped spellings.
2. **Digit clusters are built once.** `030 12 34 56` becomes one object with its
   groups and separators intact. A phone number, a card and a tax id are the
   same object at this stage; telling them apart is not the scanner's job.
3. **Recognizers score, they do not vote.** A checksum is a fact, a shape is an
   argument, punctuation like `+` is a hint, and a nearby word only adjusts what
   the string already said.
4. **Overlaps are resolved optimally** by weighted interval scheduling —
   confidence × length, `O(m log m)`. This is not decoration: `::ffff:192.168.1.1`
   is an IPv6 address containing an IPv4 one, and a grouped IBAN contains digit
   runs that pass Luhn. Resolving left to right greedily picks the earliest
   candidate, which is not the same as the best one.

### Confidence is not uniform, on purpose

A verified IBAN sits at `0.98` because the arithmetic says so. A bare
ten-digit number sits at `0.3` until a word next to it agrees, and then at
`0.65`. The threshold is `0.6`, so:

```ts
detectPii('Die Zahl 1701234567 steht hier');   // []
detectPii('Telefon 1701234567');                // phone, 0.65
detectPii('1.2.3.4');                           // [] — that is a version number
detectPii('8.8.8.8');                           // ip, 0.8 — no version repeats one component
```

Lower `minConfidence` to audit what is being suppressed rather than wondering.
What a nearby word is worth also differs per kind: `Telefon` in front of ten
digits is nearly the whole case, while `IBAN:` in front of a string that already
passes mod-97 adds almost nothing.

### API

| Function | Returns |
| --- | --- |
| `detectPii(text, options?)` | `PiiMatch[]` — non-overlapping, in reading order |
| `hasPii(text, options?)` | `boolean` |
| `piiToSegments(text, options?)` | `PiiSegment[]`, same shape as the filter's — concatenates back to the input exactly |
| `isValidIban` · `isValidLuhn` · `isValidGermanTaxId` · `iso7064Mod1110` | the checksums on their own |

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `kinds` | `PiiKind[] \| '*'` | `'*'` | Narrow the search. An unknown kind throws. |
| `minConfidence` | `number` | `0.6` | Findings below this are dropped. |
| `contextWindow` | `number` | `48` | How many characters either side count as context. |

Because segments come back in the same shape as the profanity filter's, one
renderer handles both:

```tsx
{piiToSegments(comment).map((seg, i) =>
  seg.isPii ? <span key={i} className="redacted" title={seg.kind}>{seg.text}</span> : seg.text,
)}
```

## Batch processing

Analysing one comment is a function call. Analysing two million is a different
problem, and the difference is not speed — it is that the obvious version holds
the whole corpus in memory, dies at row 900 000 with nothing written, and makes
one paid model call per row.

```ts
import { runBatch, formatSummary } from 'ts-profanity-filter/batch';
import { ndjsonFrom } from 'ts-profanity-filter/batch/node';

const summary = await runBatch(ndjsonFrom('comments.ndjson'), {
  filter: { languages: ['en', 'de'] },
  pii: true,
  onResult: (result) => { if (result.flagged) hold(result.id); },
});

console.log(formatSummary(summary));
```

Nothing is buffered: the file is read a chunk at a time, results are handed to
`onResult` and dropped, and peak memory is one record regardless of file size.

### Two shapes

| | |
| --- | --- |
| `runBatch(source, options)` | runs to completion, returns the `BatchSummary`, hands each result to `onResult`. For large input. |
| `streamBatch(source, options)` | an `AsyncGenerator` yielding each result. Its **return value** is the summary, which `for await` discards — drive `.next()` yourself if you want both. |

The source is anything iterable: an array, a generator, a database cursor, one of
the Node readers below. A record is a `string` or `{ text, id }`, and the `id`
comes back on the result so you can join to your own data.

### The model is the expensive part, so it is gated

```ts
ai: {
  provider: 'gemini',
  when: 'matched',   // only records a word list already hit — the default
  maxCalls: 500,     // a hard ceiling for the whole run
  retries: 2,        // exponential backoff on failure
}
```

`when: 'matched'` is the cheap and usually correct reading: it is the quotation
check on the records the lists flagged. **`when: 'unmatched'` is the expensive
one** — most records in any real corpus are clean, so it sends nearly all of
them. `'all'` sends everything, and a predicate lets you decide per record.

`maxCalls` exists because a batch is exactly where one call per row becomes a
bill. Once it is reached the run continues locally and the summary says
`aiBudgetExhausted: true`, so a truncated run can never read as a complete one.

A refusal is not retried — the provider's safety layer declining is a decision,
not a transient fault, and asking again in 500 ms will not change its mind.

### One bad record cannot end the run

Every stage is wrapped per record. A pattern that throws, a hostile input, a
provider that is down: the result carries `error: { stage, message }`, the other
stages still ran, and the run continues. `signal` stops it early and the summary
comes back with `aborted: true` rather than throwing away the work already done.

### Reading files

`ts-profanity-filter/batch/node` is a **separate subpath** so that importing the
runner itself never drags a Node API into a browser bundle.

| Function | For |
| --- | --- |
| `ndjsonFrom(path, { textField, idField, onBadLine })` | one JSON object per line |
| `csvFrom(path, { column, idColumn, delimiter, header })` | one column of a CSV |
| `csvRowsFrom(path, delimiter)` | raw rows |
| `linesFrom(path)` | one text per line |
| `recordsFrom(path)` | picks the reader from the extension |
| `createNdjsonWriter(path)` | append results, respecting backpressure |

The CSV reader is a character-level state machine, not `split('\n')` — a quoted
field may contain the delimiter, a newline or an escaped `""`, and splitting on
lines first makes the embedded-newline case unrecoverable rather than merely
wrong.

### From the command line

```bash
npx ts-profanity-filter scan comments.ndjson --languages en,de --pii \
  --out flagged.ndjson --pdf report.pdf
```

```
  Records processed           5
  Flagged                     3 (60.0%)
  Matched a word list         1
  Records with personal data  2 (3 findings)
  Duration                    50 ms · 100/s
```

Progress goes to stderr and the summary to stdout, so the command composes.
`--fail-on-findings` exits 1 for CI, `--json` prints the summary as JSON, and
`--max-calls` defaults to **100** when `--ai` is used — a command that can spend
money should not spend an unbounded amount of it by default. `--help` lists the
rest.

### The PDF report

`renderSummaryPdf(summary)` returns the bytes of a report — the same rows as the
text version, from the same function, so the two can never disagree.

```ts
import { renderSummaryPdf } from 'ts-profanity-filter/batch';
await writeFile('report.pdf', await renderSummaryPdf(summary, { title: 'Nightly scan' }));
```

It needs [`fast-pdf`](https://www.npmjs.com/package/fast-pdf), and **this does
not change the dependency count.** It is an *optional* peer dependency reached
through a dynamic import in that one function, exactly as the Anthropic SDK is:
`dependencies` stays empty, an install that never renders a PDF pulls nothing,
and the call throws with an install hint if the package is absent. Pass
`deterministic: true` for byte-identical output — useful for hashing or
archiving a report.

### `BatchOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `filter` | `FilterOptions \| false` | `{}` | Word lists, or `false` to skip them. |
| `pii` | `PiiOptions \| true \| false` | off | Off unless asked, like the AI check. |
| `ai` | `BatchAiOptions` | absent | Absent means no model is contacted. |
| `segments` | `boolean` | `false` | Include the segments per record — the one part of a result whose size grows with the text. |
| `concurrency` | `number` | `8` | In-flight records. Only matters with a model. |
| `ordered` | `boolean` | `true` | `false` is faster when durations vary: nothing waits behind a slow neighbour. |
| `onProgress` | `(p) => void` | — | Called every `progressEvery` records, and once at the end. |
| `progressEvery` | `number` | `500` | Per-record callbacks are their own cost at this scale. |
| `signal` | `AbortSignal` | — | Stops pulling; the summary reports `aborted`. |
| `sampleLimit` | `number` | `20` | Flagged records kept in the summary. A summary must not grow with the input. |

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

## Engine support

The core needs Unicode property escapes (`\p{L}`) — Chrome 64, Firefox 78,
Safari 11.1, Node 10. That is a hard floor: they are used throughout, and
nothing can degrade without them.

Lookbehind is the one construct beyond that, and it is optional. It powers the
spaced-out detection (`D r e c k s a u`) and the whole-word anchors — `\b` is
useless for those, because it is defined in terms of `\w` and stays ASCII even
under the `u` flag, so every umlaut and every `ß` reads as a word boundary and
`Straußschwanz` comes back flagged. Engines shipped lookbehind late — Safari
only from 16.4 — so it is compiled with `new RegExp` inside a `try`, never
written as a literal:

| | Safari 16.4+, Chrome 62+, Firefox 78+, Node 18+ | older engines |
| --- | --- | --- |
| word lists, cross-check, leet, lookalikes, repetition, zero-width, NFKC folding | ✅ | ✅ |
| spaced-out words (`D r e c k s a u`) | ✅ | not detected |
| whole-word anchors | Unicode boundaries | fall back to ASCII `\b` |

The distinction matters more than it looks. A regex literal is compiled when
the *script* is parsed, so one the engine cannot handle is a syntax error for
the whole module — importing the package would fail outright rather than
losing one feature. A test asserts that no shipped file contains such a
literal.

**React Native / Hermes is untested.** Hermes has had gaps in Unicode regex
support; verify before shipping.

**ESM only.** `require()` works on Node 20.19+ / 22.12+; on Node 18 a
CommonJS caller cannot load it.

**The AI check belongs on a server.** A key shipped to a browser is readable
and spendable by every visitor.

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
- **A batch is one thread with bounded concurrency, not a thread pool.** That is
  the right answer for the model path, where the network waits rather than the
  CPU. For millions of records through the word lists alone, the ceiling is one
  core — shard the input across processes if that is not enough.
- **`maxCalls` defaults to unlimited in the library** and to 100 in the CLI. A
  batch with a model and no ceiling is the easiest way to spend real money by
  accident; set it explicitly.
- **PII detection finds only what a string can prove.** No names, no postal
  addresses, no dates of birth — see [Only what can be verified](#only-what-can-be-verified).
  A phone number without a `+`, a trunk zero or a word next to it stays below the
  threshold, which means bare digit runs in prose are missed on purpose.
- **`1.2.3.4` is not reported as an IP address.** It is equally a version
  number, and the only thing that separates them is the word in front. Lower
  `minConfidence` if you would rather see both.
- **The Art. 17 module writes the notice, not the process.** It does not store
  anything durably on its own, does not know whether a human reviewed the case,
  and draws no line between illegal content and a breach of your terms. See
  [What this is not](#what-this-is-not).

## Scripts

```bash
npm run build      # tsc -> dist/ (.js, .d.ts, .d.ts.map, .js.map)
npm test           # builds, then runs node --test
npm run typecheck  # type-checks src + test
npm run demo       # builds and regenerates docs/index.html
```

## License

[MIT](LICENSE) — [full text](https://opensource.org/licenses/MIT).

The warranty disclaimer and the limitation of liability are in there, in the
last two paragraphs: the software is provided *as is*, without warranty of any
kind, and the authors are not liable for claims or damages arising from its
use. That is the whole of what is offered and the whole of what is disclaimed —
there is no separate agreement anywhere.

Two things it does not do, because no wording can. It cannot exclude liability
for intent or gross negligence, or for injury to life, body or health, where
mandatory law says otherwise. And it does not decide anything about *your*
obligations to *your* users — see
*What leaves your machine, and whose problem it is* above.
