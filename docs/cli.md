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

## Something to try it on

The repository ships a chat history built for exactly this:
[`examples/batch/chat-log.csv`](../examples/batch/chat-log.csv) — 25 messages
where **every row has an expected verdict**, half of them deliberately clean.

```bash
node dist/cli.js scan examples/batch/chat-log.csv --languages en,de --pii
```

```
Scanning examples/batch/chat-log.csv
  column: message (index 4) — guessed; pass --column to choose another
  25 records · 13 flagged · 158/s

  Records processed           25
  Flagged                     13 (52.0%)
  Matched a word list         6
  Records with personal data  7 (8 findings)
  Duration                    167 ms · 150/s

  Personal data by kind
    phone     2
    ip        2
    email     1
    iban      1
    card      1
    taxid-de  1

  Examples (13 of 13)
    #3  [word list]  what the sh1t is this build doing
    #5  [email]  Ping me at lena.brandt@example.com if it happens again.
    #6  [phone]  Or call me on +1 202 5550123, I am at the desk.
    #7  [phone]  Tel. 030 12345678 falls es wirklich brennt.
    #8  [word list]  Du @rschloch, echt jetzt?
    #10  [iban]  IBAN GB82 WEST 1234 5698 7654 32 for the refund please.
    #11  [card]  The card 4111 1111 1111 1111 was declined again.
    #12  [ip/ip]  server 192.168.1.1 is not answering, and neither is 2001:db8::1
    #15  [word list]  He said "you @sshole", loudly, in front of the whole room.
    #17  [word list]  d r e c k s a u, anders kann man das nicht nennen
    #18  [word list]  Аrschloch mit kyrillischem A
    #19  [word list]  Ｄｒｅｃｋｓａｕ in Vollbreite
    #21  [taxid-de]  Steuer-ID 86095742719 für die Rechnung, bitte nicht weiterleiten.
```

The twelve rows that stayed clean are the interesting half — a cross-check case
in each language, `version 1.2.3.4`, an order number with a date, a tax id
without its label, Scunthorpe, and a quoted field containing a real newline.
[The fixture's own README](../examples/batch/README.md) lists what every row is
for, so a run that reports something else tells you exactly which row moved.

---

## The first run on your own file

`comments.ndjson`:

```
{"id":"c1","text":"A perfectly ordinary comment."}
{"id":"c2","text":"You @sshole, honestly."}
{"id":"c3","text":"Write to kevin@example.com or call +1 202 5550123"}
{"id":"c4","text":"Please pass the class list to the assistant."}
{"id":"c5","text":"IBAN GB82 WEST 1234 5698 7654 32 please transfer"}
```

```bash
node dist/cli.js scan comments.ndjson --pii
```

```
Scanning comments.ndjson
  5 records · 3 flagged · 250/s

  Records processed           5
  Flagged                     3 (60.0%)
  Matched a word list         1
  Records with personal data  2 (3 findings)
  Duration                    33 ms · 152/s

  Personal data by kind
    email  1
    phone  1
    iban   1

  Examples (3 of 3)
    #c2  [word list]  You @sshole, honestly.
    #c3  [email/phone]  Write to kevin@example.com or call +1 202 5550123
    #c5  [iban]  IBAN GB82 WEST 1234 5698 7654 32 please transfer
```

Note `c4`. *Please pass the class list to the assistant* contains `ass` four
times and is **not** flagged — the cross-check cleared it. That is the behaviour
worth checking on your own data before you trust any of the rest.

---

## Input formats

The reader is picked from the file extension. Nothing is sniffed from the
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

A line that is not JSON, or has no string in the text field, is **skipped** — the
right behaviour when a few lines of a large export are broken. It is not silent:
the count and the reason are reported at the end, so a wrong `--text-field`
cannot masquerade as an empty file.

```
  Skipped 2 lines: 2 without a usable text field (--text-field)
```

From the API, `onBadLine: 'throw'` stops at the first bad line instead of
continuing past it.

### CSV

The parser handles quoted fields containing the delimiter, escaped `""` and
embedded newlines:

```csv
id,author,message
15,anna,"He said ""you @sshole"", loudly, in front of the whole room."
16,ben,"Two things:
- the build
- the invoice, in that order"
```

Those are rows 15 and 16 of the shipped fixture, and row 16 is the one that
matters: a real newline inside a quoted field. A parser that splits on lines
first reports 26 records instead of 25 and truncates the message.

### Which column gets read

`--column` and `--id-column` take a header name or a zero-based index. Leave
`--column` out and the header is consulted:

- a **single** column is unambiguous, so it is used;
- a column named `text`, `message`, `comment`, `body`, `content`, `msg`,
  `review`, `nachricht`, `kommentar` or `inhalt` is used, and the choice is
  printed;
- otherwise the run **stops and asks**, listing the columns it found.

```
examples/batch/chat-log.csv: which column holds the text?
Pass --column (or the `column` option) with one of: id, timestamp, channel, author, message
```

That last case used to read column 0 instead. Scanning the id column and
reporting `0 flagged` is the worst possible outcome, because it is
indistinguishable from a genuinely clean file.

Naming a column that is not there, or naming one with `--no-header`, also fails
rather than guessing:

```
examples/batch/chat-log.csv: no column "body". Found: id, timestamp, channel, author, message
examples/batch/chat-log.csv: column "message" needs header: true
```

**A `.csv` is assumed to have a header.** For a bare list of texts with no header
row, pass `--no-header` and use indices — or name the file `.txt`, which reads one
record per line and asks nothing.

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
--min-confidence 0.2         # see what the default suppresses
```

The kinds are `email`, `phone`, `iban`, `card`, `ip` and `taxid-de`. Lowering the
threshold is how you audit rather than guess — on the fixture it turns 8 findings
into 10, adding the bare ten-digit run in row 23 and the unlabelled tax id in
row 22.

One thing a threshold cannot reveal: `version 1.2.3.4` in row 13 is **discarded**,
not scored low. The word in front is treated as proof it is a version number, so
no `--min-confidence` will surface it. A bare `1.2.3.4` with no such word does
appear once the threshold drops below 0.5.

### A model

Off unless `--ai` is given, and then **gated** rather than called per record:

| `--ai-when` | Asks about | Cost |
| --- | --- | --- |
| `matched` (default) | records a word list already hit | low — usually a small fraction of the file |
| `unmatched` | records the lists found nothing in | **high** — most of any real corpus |
| `all` | every record | one call per record |

```bash
export GEMINI_API_KEY=...
node dist/cli.js scan comments.ndjson --ai gemini --max-calls 500
```

Providers are `anthropic`, `gemini` and `ollama`; keys come from
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, and `ollama` needs neither a key nor a
network. The run prints its own budget before it starts:

```
  model: gemini, gate matched, at most 500 calls
```

Row 20 of the fixture is what this is for — *I know where you live and I will be
waiting outside tonight* contains no listed word, so only a model reaches it, and
only under `--ai-when unmatched` or `all`.

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
{"index":2,"id":"c3","flagged":true,"matchedList":false,"pii":[{"kind":"email","start":9,"end":26},{"kind":"phone","start":35,"end":49}]}
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
      "text": "You @sshole, honestly.",
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
with the install command in the message, and the rest of the run is unaffected
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

Exits 1 as soon as anything is flagged, and prints the summary so the build log
says what and where.

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

**`Records processed 0`** — the command now says why itself rather than leaving
you to guess:

```
  Skipped 2 lines: 2 without a usable text field (--text-field)
  Nothing was analysed. Check --text-field for NDJSON or --column for CSV.
```

Skipped lines are reported whenever there are any, not only when everything was
skipped — a handful of broken lines in a large export is normal, and all of them
being skipped is a wrong field name.

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
  Duration                 1.5 s · 1/s

  Examples (1 of 1)
    #x  [word list]  You @sshole
```

The 1.5 seconds for a single record are the two backoff waits before the retries
gave up. A failed check never reports `flagged: true` — absence of a verdict is
not a clean bill of health.

**`Model budget exhausted`** in the report — `--max-calls` was reached and the
records after that point were analysed locally only. Not an error, but the model
numbers then describe a prefix of the file rather than all of it.

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
import { csvFrom } from 'ts-profanity-filter/batch/node';

const summary = await runBatch(csvFrom('chat-log.csv', { column: 'message', idColumn: 'id' }), {
  filter: { languages: ['en', 'de'] },
  pii: true,
  ai: { provider: 'gemini', when: 'matched', maxCalls: 500 },
  onResult: (result) => { if (result.flagged) hold(result.id); },
});

console.log(formatSummary(summary));
```

See [Batch processing](../README.md#batch-processing) in the README for the
options, the gate and the guarantees.
