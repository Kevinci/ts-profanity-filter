# profanity-adversarial

A benchmark that tries to defeat profanity filters, and reports **two numbers,
never one**.

```bash
npx profanity-adversarial --preset obscenity
```

```
  obscenity@0.4.6   en, de · 81 attacks

  evasion resistance  ████████████████░░░░░░░░  65%   11/17 disguises caught
  precision           █████████████████████░░░  89%   16/18 innocent texts left alone
```

## Why two numbers

Because either one alone is trivial to game.

```js
detect = () => true    // 100% evasion resistance. Blocks the entire internet.
detect = () => false   // 100% precision. Blocks nothing.
```

Every profanity filter lives on the line between those two failures, and the
only honest way to describe one is to say where on that line it sits. A
benchmark that reported a single score would reward whichever end its corpus
happened to favour.

So the corpus has two halves:

- **`flag`** — profanity in disguise. Missing one is an **evasion**.
- **`clean`** — ordinary text that merely *contains* a rude substring. Flagging
  one is a **false positive**, and the most expensive kind is somebody's name.

## Disclosure

This benchmark is written by the author of `ts-profanity-filter`, which is one
of the filters it measures. That is a conflict of interest and you should treat
it as one.

Three things are in place because of it. The corpus contains attacks that
`ts-profanity-filter` **fails** — they are in there because they are real, and
removing them would be the exact fraud this notice exists to prevent. The
false-positive half is scored with equal weight, which is where an
aggressively-matching filter (like this author's) looks worst. And every attack
is a plain string in [`src/corpus.ts`](src/corpus.ts): if one looks unfair,
it is one line to read and one issue to open.

## Running it

Against a built-in adapter:

```bash
npx profanity-adversarial --preset obscenity
npx profanity-adversarial --preset bad-words --preset leo-profanity   # compare
```

Against your own filter — an adapter is a module with a default export:

```js
// my-adapter.mjs
import { Filter } from 'my-filter';
const filter = new Filter();

export default {
  name: 'my-filter',
  detect: (text) => filter.isProfane(text),
};
```

```bash
npx profanity-adversarial ./my-adapter.mjs
```

`detect` may be async. If it throws, that attack counts as failed and the run
continues — crashing on hostile input is itself a result.

### Options

| | |
| --- | --- |
| `--preset <name>` | built-in adapter; repeat it to compare several |
| `--lang en,de` | only attacks written for these languages |
| `--category <a,b>` | only these categories |
| `--json` | machine-readable output |
| `--verbose` | also list what passed |
| `--min-evasion <n>` | exit non-zero below this percentage |
| `--min-precision <n>` | exit non-zero below this percentage |
| `--list` | print the corpus and exit |

Presets: `ts-profanity-filter`, `obscenity`, `bad-words`, `leo-profanity`,
`@2toad/profanity`. None is a dependency — each is imported when asked for, and
a missing one says `npm install` rather than crashing.

**Only benchmark English-only filters on `--lang en`.** Scoring one against the
German half measures whether it ships a German word list, not whether it
resists evasion.

## What it tests

| category | what is done to the word |
| --- | --- |
| `leet` | digits and symbols for letters — `sh1t`, `@sshole`, `f*ck` |
| `diacritics` | `DräckSAU`, `ässhöle` |
| `homoglyph` | Cyrillic and Greek letters that render identically |
| `spacing` | `f u c k`, `s.h.i.t`, `D-r-e-c-k-s-a-u` |
| `repetition` | `fuuuuck`, and every letter doubled |
| `invisible` | zero-width space, joiner, soft hyphen, word joiner |
| `compatibility` | fullwidth, circled, mathematical bold, modifier letters |
| `combining` | decomposed umlauts, combining strikethrough, uncomposable marks |
| `casing` | alternating case, capital sharp s |
| `insertion` | a foreign letter or bracket wedged in |
| `rewriting` | backwards, phonetic |
| `encoding` | HTML entity, percent-encoding |
| `false-positive` | Scunthorpe, Penistone, Cockburn, Matsushita, Klassik, Hausaufgaben, … |

Run `--list` for every case with its id.

## What it does not test

**Vocabulary size.** This measures obfuscation mechanics, not how many words a
list holds. The corpus uses a handful of ordinary swear words as carriers and no
slurs at all — a filter that knows more words does not score higher here.

**Meaning.** A sentence can be an unmistakable threat without containing a
single listed word, and 🍑 is the same character in a recipe and in an insult.
No word list resolves either, so scoring them against one would be scoring the
wrong thing. That judgement needs a model, and belongs in a different benchmark.

**Context.** Quotation, reporting, education and self-directed venting all
change whether the same string should be flagged. Out of scope for the same
reason.

## As a test

The corpus is exported, so a filter can gate its own CI on it:

```js
import { run, formatReport } from 'profanity-adversarial';

const report = await run({ name: 'mine', detect }, { languages: ['en'] });

assert.ok(report.score.precision === 1, formatReport(report));
```

## Contributing an attack

New attacks are welcome, especially ones that defeat everything currently
listed. An attack needs: a stable `id`, the language it is written for, whether
it must be flagged or must pass, and one line saying what is being done to the
word. Attacks that only work against one filter are still worth adding — that is
what a benchmark is for.

## Licence

MIT.
