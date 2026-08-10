# The `ts-profanity-filter` command line

Scan a file of comments for profanity, personal data and — if you ask for it —
what a model makes of the sentence. One record per line, streamed, so the file
size is not the limit.

Every output on this page was produced by running the command, not written by
hand.

---

## Running it

```bash
npx ts-profanity-filter scan comments.ndjson
```

`npx` runs the copy in `node_modules/.bin` when the project already depends on
the package, and fetches it temporarily when it does not. To have it permanently:

```bash
npm install -g ts-profanity-filter
ts-profanity-filter scan comments.ndjson
```

Working on this repository itself, the built CLI is a plain file:

```bash
npm run build
node dist/cli.js scan comments.ndjson
```

`--help` prints the full flag list and exits 0.

---

## The first run

`comments.ndjson`:

```
{"id":"c1","text":"Ein ganz normaler Kommentar."}
{"id":"c2","text":"Du @rschloch, echt."}
{"id":"c3","text":"Schreib an kevin@example.de oder Tel. 030 12345678"}
{"id":"c4","text":"Der Klassiker war klasse."}
{"id":"c5","text":"IBAN DE44 5001 0517 5407 3249 31 bitte überweisen"}
```

```bash
node dist/cli.js scan comments.ndjson --languages en,de --pii
```

```
Scanning comments.ndjson
  5 records · 3 flagged · 135/s

  Records processed           5
  Flagged                     3 (60.0%)
  Matched a word list         1
  Records with personal data  2 (3 findings)
  Duration                    50 ms · 100/s

  Personal data by kind
    email  1
    phone  1
    iban   1

  Examples (3 of 3)
    #c2  [word list]  Du @rschloch, echt.
    #c3  [email/phone]  Schreib an kevin@example.de oder Tel. 030 12345678
    #c5  [iban]  IBAN DE44 5001 0517 5407 3249 31 bitte überweisen
```

Note `c4`. *Der Klassiker war klasse* contains `ass` twice and is **not**
flagged — the cross-check cleared it. That is the behaviour worth checking on
your own data before you trust any of the rest.

---

## Input formats

The reader is picked from the file extension. Nothing is auto-sniffed from the
contents, so the extension is the contract.

| Extension | Format | Relevant flags |
| --- | --- | --- |
| `.ndjson`, `.jsonl` | one JSON object per line | `--text-field`, `--id-field` |
| `.csv` | comma-separated | `--column`, `--id-column`, `--no-header` |
| `.tsv` | tab-separated | same as `.csv` |
| anything else | one text per line, no ids | — |

### NDJSON

Defaults to the `text` and `id` properties:

```bash
node dist/cli.js scan comments.ndjson
node dist/cli.js scan export.jsonl --text-field body --id-field comment_id
```

A line that is not JSON, or has no string in the text field, is **skipped
silently**. That is deliberate for a 2 GB export where three lines are broken —
but it does mean a wrong `--text-field` looks exactly like an empty file. If
`Records processed` comes back 0, check the field name first.

### CSV

The parser handles quoted fields containing the delimiter, escaped `""` and
embedded newlines:

```csv
id,autor,kommentar
1,anna,"Er sagte ""du @rschloch"", laut"
2,ben,"zwei
Zeilen, ein Feld"
3,cem,Alles gut
```

```bash
node dist/cli.js scan data.csv --column kommentar --id-column id --languages de
```

```
  Records processed    3
  Flagged              1 (33.3%)
  Matched a word list  1
  Duration             19 ms · 158/s

  Examples (1 of 1)
    #1  [word list]  Er sagte "du @rschloch", laut
```

`--column` and `--id-column` take a header name or a zero-based index. Both
mistakes fail loudly rather than scanning the wrong column:

```
data.csv: column "kommentar" needs header: true
data.csv: no column "gibtsnicht". Found: id, autor, kommentar
```

With `--no-header`, use indices.

---

## What gets analysed

### Word lists

On by default, English only. Mixed-language text needs both:

```bash
--languages en,de
--no-filter          # skip the word lists entirely
```

### Personal data

Off unless asked:

```bash
--pii
--kinds email,iban,card      # narrow it
--min-confidence 0.4         # see what the default suppresses
```

The kinds are `email`, `phone`, `iban`, `card`, `ip` and `taxid-de`. Lowering
`--min-confidence` is how you audit: at 0.6 a bare digit run with no `+`, no
trunk zero and no word beside it is held back, and so is `1.2.3.4`, which is a
version number as often as an address.

### A model

Off unless `--ai` is given, and then **gated** rather than called per record:

| `--ai-when` | Asks about | Cost |
| --- | --- | --- |
| `matched` (default) | records a word list already hit | low — usually a small fraction of the file |
| `unmatched` | records the lists found nothing in | **high** — most of any real corpus |
| `all` | every record | one call per record |

```bash
export GEMINI_API_KEY=...
node dist/cli.js scan comments.ndjson --languages en,de --ai gemini --max-calls 500
```

Providers are `anthropic`, `gemini` and `ollama`; keys come from
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, and `ollama` needs neither a key nor a
network. The run prints its own budget before it starts:

```
  model: gemini, gate matched, at most 500 calls
```

---

## Output

**stderr** carries progress, **stdout** the summary. That split is what makes the
command composable: `> summary.txt` keeps the report without the progress noise,
and `2>/dev/null` does the opposite.

### Flagged records to a file

```bash
--out flagged.ndjson      # only flagged records
--out all.ndjson --all    # every record
```

One JSON object per line, ids and offsets included, text excluded — you already
have the text:

```
{"index":1,"id":"c2","flagged":true,"matchedList":true}
{"index":2,"id":"c3","flagged":true,"matchedList":false,"pii":[{"kind":"email","start":11,"end":27},{"kind":"phone","start":38,"end":50}]}
{"index":4,"id":"c5","flagged":true,"matchedList":false,"pii":[{"kind":"iban","start":5,"end":32}]}
```

`index` is the position in the input; `start` and `end` are offsets into that
record's text, so you can highlight or redact without re-scanning.

### The summary as JSON

```bash
node dist/cli.js scan comments.ndjson --json --quiet
```

```json
{
  "processed": 5,
  "flagged": 1,
  "matchedList": 1,
  "piiRecords": 0,
  "piiFindings": 0,
  "piiByKind": {},
  "aiCalls": 0,
  "aiFlagged": 0,
  "aiErrors": 0,
  "errors": 0,
  "aborted": false,
  "aiBudgetExhausted": false,
  "elapsedMs": 21,
  "samples": [
    {
      "index": 1,
      "text": "Du @rschloch, echt.",
      "flagged": true,
      "matchedList": true,
      "pii": [],
      "id": "c2"
    }
  ]
}
```

`samples` is capped at 20 records, so the summary never grows with the input —
and it carries their text verbatim, which matters if you are writing this JSON
somewhere less protected than the source data.

Two fields decide whether the rest can be trusted as a complete picture:
`aborted` and `aiBudgetExhausted`. Check them before you report the numbers.

### A PDF report

```bash
--pdf report.pdf
```

Needs the optional package `fast-pdf`:

```bash
npm install fast-pdf
```

It is an *optional peer dependency*, loaded only by this one code path — an
install that never renders a PDF pulls nothing extra. Without it, `--pdf` fails
with the install command in the message and the rest of the run is unaffected,
because the PDF is written after the summary is already on stdout.

---

## Exit codes

| Code | When |
| --- | --- |
| `0` | the scan completed |
| `0` | `--help` |
| `1` | no arguments, unknown command, bad flag value |
| `1` | the input file could not be read |
| `1` | `--pdf` was given but `fast-pdf` is not installed — the summary is still printed first |
| `1` | findings were reported **and** `--fail-on-findings` was given |

Without `--fail-on-findings`, findings are not an error — a scan that finds
things worked correctly.

---

## Recipes

### A CI gate on a fixtures file

```bash
npx ts-profanity-filter scan fixtures/comments.ndjson \
  --languages en,de --pii --fail-on-findings --quiet
```

Exits 1 as soon as anything is flagged, prints the summary so the build log says
what and where.

### A nightly scan with a report to keep

```bash
npx ts-profanity-filter scan "exports/$(date +%F).ndjson" \
  --languages en,de --pii \
  --out "flagged/$(date +%F).ndjson" \
  --pdf "reports/$(date +%F).pdf" \
  --json > "reports/$(date +%F).json"
```

### A big file, with the model only on what the lists caught

```bash
npx ts-profanity-filter scan comments.ndjson \
  --languages en,de --ai gemini --ai-when matched \
  --max-calls 2000 --concurrency 4 \
  --out flagged.ndjson
```

`--concurrency` is in-flight records and only matters when a model is involved;
with word lists alone the loop never awaits. `--unordered` yields results as they
finish rather than in input order, which is faster when record durations vary and
irrelevant if you are only counting.

### Stopping early

Ctrl-C stops pulling new records, lets the ones in flight finish, and still
prints the summary — with `aborted: true` in it. A long scan that reports nothing
when interrupted has thrown away its own work.

---

## When something looks wrong

**`Records processed 0`** — the reader found no usable lines. On NDJSON, almost
always the wrong `--text-field`; bad lines are skipped without a word. On CSV,
check `--column`.

**Nothing is flagged and you expected hits** — `--languages` defaults to `en`
alone. German text needs `--languages de` or `en,de`.

**A phone number was missed** — a bare digit run with no `+`, no leading `0` and
no word like *Tel.* next to it stays below the threshold on purpose. Confirm with
`--min-confidence 0.2`, which shows what is being held back.

**`Model calls that failed`** is non-zero — the calls happened and did not
produce verdicts. Most often a missing or wrong key. The run itself is fine and
the local half is unaffected:

```
  Records processed        1
  Flagged                  1 (100.0%)
  Matched a word list      1
  Model calls              1
  Flagged by the model     0
  Model calls that failed  1
  Duration                 1.6 s · 1/s
```

The 1.6 seconds for one record are the two backoff waits before the retries gave
up. A failed check never reports `flagged: true` — absence of a verdict is not a
clean bill of health.

**`Model budget exhausted`** in the report — `--max-calls` was reached and the
records after that point were analysed locally only. Not an error, but the model
numbers describe a prefix of the file rather than all of it.

---

## Full flag reference

```
ts-profanity-filter scan <file> [options]

  Analyses one record per line. .ndjson/.jsonl read a JSON object per line,
  .csv/.tsv one column, anything else one text per line.

Input
  --text-field <name>     NDJSON property holding the text        (default: text)
  --id-field <name>       NDJSON property holding the id          (default: id)
  --column <name|index>   CSV column holding the text             (default: 0)
  --id-column <name|idx>  CSV column holding the id
  --no-header             CSV has no header row

Analysis
  --languages <a,b>       Word lists to match against             (default: en)
  --no-filter             Skip the word lists
  --pii                   Also detect personal data
  --kinds <a,b>           Limit PII kinds (email,phone,iban,card,ip,taxid-de)
  --min-confidence <n>    PII threshold                           (default: 0.6)

Model (off unless --ai is given)
  --ai <provider>         anthropic | gemini | ollama
  --ai-model <id>         Model id
  --ai-when <gate>        matched | unmatched | all               (default: matched)
  --max-calls <n>         Hard ceiling on model calls             (default: 100)

Output
  --out <file>            Write flagged records as NDJSON
  --all                   With --out, write every record, not only flagged ones
  --pdf <file>            Render the summary as a PDF (needs fast-pdf)
  --json                  Print the summary as JSON instead of text
  --quiet                 No progress on stderr
  --fail-on-findings      Exit 1 when anything was flagged (for CI)

Other
  --concurrency <n>       In-flight records when a model is used  (default: 8)
  --unordered             Emit results as they finish, not in input order
  -h, --help              This text
```

---

## The same thing from code

The CLI is a thin wrapper. Everything it does is available directly:

```ts
import { runBatch, formatSummary } from 'ts-profanity-filter/batch';
import { ndjsonFrom } from 'ts-profanity-filter/batch/node';

const summary = await runBatch(ndjsonFrom('comments.ndjson'), {
  filter: { languages: ['en', 'de'] },
  pii: true,
  ai: { provider: 'gemini', when: 'matched', maxCalls: 500 },
  onResult: (result) => { if (result.flagged) hold(result.id); },
});

console.log(formatSummary(summary));
```

See [Batch processing](../README.md#batch-processing) in the README for the
options, the gate and the guarantees.
