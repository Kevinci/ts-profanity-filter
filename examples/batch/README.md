# `chat-log.csv` — a chat history to point the CLI at

Twenty-five messages in a plausible support/dev chat, mixed English and German,
built so that **every row has an expected verdict**. Half of them are supposed to
come back clean, which is the half that catches a detector getting eager.

```bash
npx ts-profanity-filter scan examples/batch/chat-log.csv \
  --column message --id-column id --languages en,de --pii
```

That command produces 13 flagged records out of 25. If your build produces
anything else, the table below says which row moved.

## What each row is for

| # | Should be | Why it is in here |
| --- | --- | --- |
| 1, 2 | clean | ordinary chat, including a field quoted only because of its comma |
| 3 | **word list** | leet spelling — `sh1t` |
| 4 | clean | the cross-check: `pass`, `class`, `assistant`, `assessment` all contain `ass` |
| 5 | **email** | plain address in a sentence |
| 6 | **phone** | E.164 with `+`, grouped |
| 7 | **phone** | German trunk zero, with `Tel.` beside it |
| 8 | **word list** | German list, leet `@` |
| 9 | clean | German cross-check: `Klassiker`, `klasse`, `harscher`, `Marsch`, `Massage` |
| 10 | **iban** | grouped IBAN with letters in the body, mod-97 valid |
| 11 | **card** | Luhn valid, Visa prefix |
| 12 | **ip** ×2 | an IPv4 and an IPv6 in one message |
| 13 | clean | `version 1.2.3.4` — the word in front is what makes it not an address |
| 14 | clean | an order number, a date and a currency amount, none of them PII |
| 15 | **word list** | a quoted CSV field containing `""` escapes and commas |
| 16 | clean | a quoted field containing a **newline** — the row the naive parser breaks on |
| 17 | **word list** | spaced out: `d r e c k s a u` |
| 18 | **word list** | Cyrillic `А` standing in for the Latin one |
| 19 | **word list** | fullwidth characters, folded by NFKC |
| 20 | clean by list, **flagged by a model** | a threat containing no listed word at all |
| 21 | **taxid-de** | valid check digit *and* a `Steuer-ID` label next to it |
| 22 | clean | the same number with no label — the checksum alone is not enough |
| 23 | clean | a bare ten-digit run: no `+`, no trunk zero, no word beside it |
| 24 | clean | Scunthorpe |
| 25 | clean | sign-off |

## Things worth trying on it

**See what is being held back.** Rows 22 and 23 are suppressed by the confidence
threshold, not by a lack of detection:

```bash
npx ts-profanity-filter scan examples/batch/chat-log.csv \
  --column message --no-filter --pii --min-confidence 0.2
```

`phone` goes from 2 to 3 and `taxid-de` from 1 to 2. Row 13 stays clean at any
threshold — `version` in front of `1.2.3.4` discards the candidate outright
rather than scoring it low.

**Row 20 is the case for a model.** No word list will ever flag *I know where you
live and I will be waiting outside tonight*, because it contains nothing to list:

```bash
export GEMINI_API_KEY=...
npx ts-profanity-filter scan examples/batch/chat-log.csv \
  --column message --languages en,de --ai gemini --ai-when unmatched --max-calls 25
```

`--ai-when unmatched` is the expensive gate — here it is the point, since row 20
is exactly what the lists missed. On 25 rows that is fine; on a real corpus read
the cost note in [the CLI guide](../../docs/cli.md#a-model) first.

**Prove the CSV parser.** Row 16 contains a real newline inside a quoted field,
so a run that reports 26 records or truncates a message is parsing lines instead
of characters.

```bash
npx ts-profanity-filter scan examples/batch/chat-log.csv --column message --json --quiet
```

**Write the findings somewhere.**

```bash
npx ts-profanity-filter scan examples/batch/chat-log.csv \
  --column message --id-column id --languages en,de --pii \
  --out /tmp/flagged.ndjson --pdf /tmp/report.pdf
```

The PDF needs the optional `fast-pdf` package; everything else does not.
