# Features · Funktionsübersicht

Every feature of `ts-profanity-filter`, one line of what it is and one of why it
works that way — English first, German second.

Alle Funktionen von `ts-profanity-filter`, je eine Zeile was es ist und eine
warum es so gebaut ist — zuerst englisch, dann deutsch.

| Entry point | Import |
| --- | --- |
| core filter | `ts-profanity-filter` |
| AI check | `ts-profanity-filter/ai` |
| personal data | `ts-profanity-filter/pii` |
| DSA Art. 17 | `ts-profanity-filter/compliance` |
| batch runner | `ts-profanity-filter/batch` |
| file readers | `ts-profanity-filter/batch/node` |
| React · Vue · Angular | `ts-profanity-filter/react` · `/vue` · `/angular` |
| language packs | `ts-profanity-filter/lang/en` · `/lang/de` |
| command line | `npx ts-profanity-filter scan <file>` |

---

## 1 · The core filter · Der Kernfilter

### Segments instead of a masked string · Segmente statt eines maskierten Strings

**EN** `filterFWordsToSegments()` returns an array of `{ text, isProfane }`, and
concatenating every `text` reproduces the input exactly. The library never
rewrites your string.
*Why:* the redaction is a UI decision — black bar, asterisks, a tooltip — and a
library that returns `f***` has made that decision for you and thrown away the
original.

**DE** `filterFWordsToSegments()` liefert ein Array aus `{ text, isProfane }`;
alle `text` aneinandergehängt ergeben exakt die Eingabe zurück. Die Bibliothek
schreibt deinen String nie um.
*Warum:* Wie geschwärzt wird, ist eine UI-Entscheidung — Balken, Sterne,
Tooltip. Wer `f***` zurückgibt, hat diese Entscheidung getroffen und das Original
weggeworfen.

### The cross-check · Der Gegencheck

**EN** Matching is substring-based, so every hit is checked against an allowlist
anchored on the **whole surrounding word**; an allowed word always beats a
blocked pattern. `class`, `Klassik`, `Massage`, `Scunthorpe`, `cocktail` stay
clean.
*Why:* substrings are what catch `asshole` from `ass` and survive obfuscation.
Without the cross-check that same power flags ordinary words, which is the
expensive kind of error.

**DE** Gesucht wird nach Teilstrings, deshalb wird jeder Treffer gegen eine
Erlaubnisliste geprüft, die am **ganzen umgebenden Wort** ankert; ein erlaubtes
Wort schlägt immer ein gesperrtes Muster. `class`, `Klassik`, `Massage`,
`Scunthorpe`, `cocktail` bleiben sauber.
*Warum:* Teilstrings sind es, die `asshole` aus `ass` finden und Verschleierung
überleben. Ohne Gegencheck trifft dieselbe Stärke harmlose Wörter — der teure
Fehler.

### Lookalike and evasion matching · Verwechslungs- und Umgehungserkennung

**EN** Leet (`Dr3cks4u`, `a$$hole`), diacritics, cross-script homoglyphs
(Cyrillic `А`), spaced-out words (`D r e c k s a u`), repetition (`fuuuuck`),
zero-width characters, and NFKC folding for compatibility spellings
(`Ｄｒｅｃｋｓａｕ`, `𝐃𝐫𝐞𝐜𝐤𝐬𝐚𝐮`, `Ⓓⓡⓔⓒⓚⓢⓐⓤ`).
*Why:* the allowlist gets the same expansion. Without that symmetry `ass`
matches the `4ss` in `Kl4ssik` while the allow entry still spells `klass`.

**DE** Leetspeak (`Dr3cks4u`, `a$$hole`), Diakritika, schriftübergreifende
Homoglyphen (kyrillisches `А`), auseinandergezogene Wörter (`D r e c k s a u`),
Wiederholungen (`fuuuuck`), Zero-Width-Zeichen und NFKC-Faltung für
Kompatibilitätsschreibweisen.
*Warum:* Die Erlaubnisliste wird genauso erweitert. Ohne diese Symmetrie trifft
`ass` das `4ss` in `Kl4ssik`, während der Erlaubniseintrag noch `klass`
buchstabiert.

### Offset-exact spans · Offset-genaue Bereiche

**EN** The text is rewritten for matching and every rewritten character
remembers which slice of the original it came from, so a flagged span covers
exactly the characters you typed. Iteration is by code point, so a boundary
never lands inside a surrogate pair.
*Why:* three representations of the input are in play at once — original, folded
haystack, segments — and that is precisely where filters silently misalign.

**DE** Der Text wird zum Suchen umgeschrieben, und jedes umgeschriebene Zeichen
weiß, aus welchem Stück des Originals es kam — der markierte Bereich deckt genau
die getippten Zeichen. Iteriert wird über Codepoints, also landet keine Grenze
mitten in einem Surrogatpaar.
*Warum:* Drei Darstellungen der Eingabe sind gleichzeitig im Spiel — Original,
gefalteter Suchtext, Segmente. Genau dort verrutschen Filter unbemerkt.

### Language registry · Sprachregister

**EN** `en` and `de` ship registered; `registerLanguage()` adds any other.
Regional variants inherit with `extends`, lookups fall back along BCP-47 subtags
(`de-AT-1996` → `de-at` → `de`), patterns are validated at registration, and an
**unknown language throws**.
*Why:* silently matching nothing is the worst way for a moderation filter to
fail, because it is indistinguishable from a clean result.

**DE** `en` und `de` sind vorregistriert, `registerLanguage()` fügt jede weitere
hinzu. Regionale Varianten erben über `extends`, Lookups fallen entlang der
BCP-47-Subtags zurück (`de-AT-1996` → `de-at` → `de`), Muster werden bei der
Registrierung geprüft, und eine **unbekannte Sprache wirft**.
*Warum:* Stillschweigend nichts zu treffen ist die schlechteste Art zu
scheitern — sie ist von einem sauberen Ergebnis nicht zu unterscheiden.

### Zero runtime dependencies · Keine Laufzeitabhängigkeiten

**EN** No `dependencies` field at all. React, Vue, the Anthropic SDK and
`fast-pdf` are *optional* peers, each loaded only in the code path that needs it.
*Why:* a moderation filter sits in the request path of everything a user writes.
Every dependency there is someone else's release schedule in yours.

**DE** Kein `dependencies`-Feld. React, Vue, das Anthropic-SDK und `fast-pdf`
sind *optionale* Peers, jeder nur im Codepfad geladen, der ihn braucht.
*Warum:* Ein Moderationsfilter sitzt im Anfragepfad für alles, was Nutzer
schreiben. Jede Abhängigkeit dort ist der Releaseplan eines anderen in deinem.

---

## 2 · The AI check · Die KI-Prüfung

### A model reads the whole sentence · Ein Modell liest den ganzen Satz

**EN** `moderateText()` reports hate, threats, harassment, racism, obscenity,
sexual content involving minors and self-harm pressure — with a severity, a
confidence, one sentence of reasoning in the language of the text, and the exact
quote it objected to.
*Why:* a message can be a threat without containing a single listed word, and it
can be full of them and still be a quotation. No word list can tell those apart.

**DE** `moderateText()` meldet Hass, Drohungen, Belästigung, Rassismus,
Obszönität, sexuelle Inhalte mit Minderjährigen und Druck zur Selbstverletzung —
mit Schweregrad, Sicherheit, einem Satz Begründung in der Sprache des Textes und
der wörtlich zitierten Stelle.
*Warum:* Eine Nachricht kann eine Drohung sein, ohne ein gelistetes Wort zu
enthalten — und voll davon sein und trotzdem ein Zitat. Keine Wortliste
unterscheidet das.

### Three providers, one of them local · Drei Anbieter, einer davon lokal

**EN** `gemini` is a plain `fetch` with a free tier, `anthropic` uses the
optional SDK, `ollama` needs **no key and no network**. Same prompt, same JSON
Schema, same verdict shape, so switching is a config change.
*Why:* "moderating a message means handing it to a third party" is the objection
that makes this feature a non-starter for some deployments. `ollama` answers it.

**DE** `gemini` ist ein einfaches `fetch` mit Gratiskontingent, `anthropic` nutzt
das optionale SDK, `ollama` braucht **keinen Schlüssel und kein Netz**. Gleicher
Prompt, gleiches JSON-Schema, gleiche Ergebnisform — ein Wechsel ist eine
Konfigurationsänderung.
*Warum:* „Moderieren heißt, die Nachricht einem Dritten geben" ist der Einwand,
der dieses Feature für manche Deployments ausschließt. `ollama` beantwortet ihn.

### Off unless you ask · Aus, wenn du nicht fragst

**EN** No `ai` option means no model is contacted and nothing leaves your
machine. `ai.complete` accepts any function, so you can bring your own model.
A failed or refused check **never** reports `flagged: true`, and the API key is
stripped from error messages.
*Why:* absence of a verdict is not a clean bill of health, and a failed
moderation call should be a decision you make rather than an exception that takes
down the request.

**DE** Keine `ai`-Option heißt: kein Modell wird kontaktiert, nichts verlässt
deine Maschine. `ai.complete` nimmt jede Funktion, also auch dein eigenes
Modell. Eine fehlgeschlagene oder abgelehnte Prüfung meldet **nie**
`flagged: true`, und der Schlüssel wird aus Fehlermeldungen entfernt.
*Warum:* Ein fehlendes Urteil ist kein Freispruch, und ein fehlgeschlagener
Aufruf sollte eine Entscheidung sein, keine Exception, die die Anfrage killt.

---

## 3 · Personal data · Personenbezogene Daten

### Six verifiable kinds · Sechs nachprüfbare Arten

**EN** `email`, `phone`, `iban`, `card`, `ip`, `taxid-de` — each confirmed by
arithmetic or structure: ISO 13616 mod-97 plus country length for IBANs, Luhn
plus issuer prefix for cards, ISO 7064 MOD 11,10 plus the BZSt repetition rule
for tax ids, octet ranges and IPv6 group counting for addresses.
*Why:* names, postal addresses and dates of birth are personal data too and are
deliberately absent — nothing inside the string can confirm them, and guessing
turns every capitalised word into a finding.

**DE** `email`, `phone`, `iban`, `card`, `ip`, `taxid-de` — jede durch Arithmetik
oder Struktur bestätigt: ISO 13616 mod-97 plus Länderlänge bei IBANs, Luhn plus
Issuer-Präfix bei Karten, ISO 7064 MOD 11,10 plus BZSt-Wiederholungsregel bei
Steuer-IDs, Oktett-Bereiche und IPv6-Gruppenzählung bei Adressen.
*Warum:* Namen, Anschriften und Geburtsdaten sind auch personenbezogen und
fehlen absichtlich — nichts im String kann sie bestätigen, und Raten macht aus
jedem großgeschriebenen Wort einen Fund.

### One pass, then scoring, then optimal resolution · Ein Durchlauf, Bewertung, optimale Auflösung

**EN** One O(n) scan collects anchors; digit clusters are built once and read by
three recognizers; every candidate is *scored* (checksum > structure >
punctuation > a nearby word); overlaps are settled by weighted interval
scheduling.
*Why:* `::ffff:192.168.1.1` is an IPv6 address containing an IPv4 one, and
resolving greedily from the left picks the earliest candidate rather than the
best one.

**DE** Ein O(n)-Scan sammelt Anker; Ziffern-Cluster werden einmal gebaut und von
drei Erkennern gelesen; jeder Kandidat wird *bewertet* (Prüfsumme > Struktur >
Zeichensetzung > Wort in der Nähe); Überlappungen löst gewichtetes
Intervall-Scheduling auf.
*Warum:* `::ffff:192.168.1.1` ist eine IPv6-Adresse, die eine IPv4 enthält —
greedy von links nimmt den frühesten Kandidaten, nicht den besten.

### Confidence you can audit · Nachprüfbare Sicherheit

**EN** A verified IBAN sits at 0.98; a bare ten-digit number at 0.3 until a word
beside it agrees. The threshold is 0.6, and lowering it shows what is being held
back instead of leaving you to guess.
*Why:* a detector that reports everything is as useless as one that reports
nothing. Making the suppression visible is what makes it trustworthy.

**DE** Eine geprüfte IBAN liegt bei 0,98; eine blanke zehnstellige Zahl bei 0,3,
bis ein Wort daneben zustimmt. Die Schwelle ist 0,6, und wer sie senkt, sieht was
zurückgehalten wird, statt es zu vermuten.
*Warum:* Ein Erkenner, der alles meldet, ist so nutzlos wie einer, der nichts
meldet. Die Unterdrückung sichtbar zu machen, macht sie vertrauenswürdig.

---

## 4 · DSA Article 17 · DSA Artikel 17

### Statements of reasons · Begründungen

**EN** `generateJustification()` turns a moderation result into the notice
Article 17 requires: the measure and its duration, the legal or policy ground,
the facts it rests on, whether automated means were used, and where to contest
it — in the user's language.
*Why:* in the EU, deleting the comment is only half the obligation. A filter that
returns `flagged: true` gives you none of the rest.

**DE** `generateJustification()` macht aus einem Moderationsergebnis die
Begründung, die Artikel 17 verlangt: Maßnahme und Dauer, rechtliche oder
vertragliche Grundlage, die zugrunde liegenden Tatsachen, ob automatisiert
entschieden wurde, und wohin der Widerspruch geht — in der Sprache des Nutzers.
*Warum:* In der EU ist das Löschen erst die Hälfte der Pflicht. Ein Filter, der
`flagged: true` liefert, gibt dir vom Rest nichts.

### The facts are never the model's to decide · Die Tatsachen entscheidet nie das Modell

**EN** Action, policy basis, categories, severity, confidence, quote and
timestamp are fixed by the code before any model is asked. A model writes two
fields: a `reason` and an `assessment`. Without one, built-in German and English
templates carry the notice.
*Why:* an invented category or date in a notice like this is exactly the error
that loses an appeal.

**DE** Maßnahme, Grundlage, Kategorien, Schweregrad, Sicherheit, Zitat und
Zeitstempel legt der Code fest, bevor ein Modell gefragt wird. Das Modell
schreibt zwei Felder: `reason` und `assessment`. Ohne Modell tragen eingebaute
deutsche und englische Vorlagen die Begründung.
*Warum:* Eine erfundene Kategorie oder ein falsches Datum in so einer Mitteilung
ist genau der Fehler, der einen Widerspruch verliert.

### Ungraded is not harmless · Ungewichtet heißt nicht harmlos

**EN** When only a word list matched, no severity line is printed at all, and the
assessment says exactly what was established and no more.
*Why:* writing "severity: none" would read as a considered finding that the
content was fine, which is not what happened. Overstating there would be
inventing grounds.

**DE** Wenn nur eine Wortliste getroffen hat, wird keine Schweregrad-Zeile
gedruckt, und die Bewertung sagt genau, was feststeht — nicht mehr.
*Warum:* „Schweregrad: keiner" würde als erwogene Feststellung der
Harmlosigkeit gelesen. Mehr zu behaupten hieße, Gründe zu erfinden.

---

## 5 · Batch processing · Stapelverarbeitung

### Streaming in, streaming out · Strom hinein, Strom hinaus

**EN** `runBatch()` and `streamBatch()` take any (async) iterable — an array, a
generator, a database cursor, a file — and hand results back one at a time. Peak
memory is one record, whatever the file size.
*Why:* the obvious version holds the corpus in memory, dies at row 900 000 with
nothing written, and makes one paid model call per row.

**DE** `runBatch()` und `streamBatch()` nehmen jedes (asynchrone) Iterable — ein
Array, einen Generator, einen Datenbank-Cursor, eine Datei — und geben Ergebnisse
einzeln zurück. Der Speicherbedarf liegt bei einem Datensatz, unabhängig von der
Dateigröße.
*Warum:* Die naive Variante hält das ganze Korpus im Speicher, stirbt bei Zeile
900 000 ohne eine geschriebene Zeile und macht einen bezahlten Modellaufruf pro
Zeile.

### The model is gated · Das Modell ist getort

**EN** `when: 'matched'` (default) asks only about records a word list already
hit. `maxCalls` is a hard ceiling; once it trips the run finishes locally and the
summary reports `aiBudgetExhausted`. Failures retry with exponential backoff;
refusals do not.
*Why:* a batch is exactly where one call per row becomes a bill — and a truncated
run must never read as a complete one.

**DE** `when: 'matched'` (Standard) fragt nur zu Datensätzen, die eine Wortliste
schon getroffen hat. `maxCalls` ist eine harte Decke; greift sie, läuft der Rest
lokal weiter und die Bilanz meldet `aiBudgetExhausted`. Fehler werden mit
exponentiellem Backoff wiederholt, Ablehnungen nicht.
*Warum:* Ein Stapellauf ist genau die Stelle, an der ein Aufruf pro Zeile zur
Rechnung wird — und ein abgeschnittener Lauf darf nie wie ein vollständiger
lesen.

### One bad record cannot end the run · Ein schlechter Datensatz beendet nichts

**EN** Every stage is wrapped per record; the result carries
`error: { stage, message }` and the run continues. An `AbortSignal` stops it
early and the summary comes back with `aborted: true`.
*Why:* a job that throws away 900 000 successful records because of one bad one
has to be re-run from the start.

**DE** Jede Stufe ist pro Datensatz gekapselt; das Ergebnis trägt
`error: { stage, message }` und der Lauf geht weiter. Ein `AbortSignal` stoppt
früh, und die Bilanz kommt mit `aborted: true` zurück.
*Warum:* Ein Lauf, der 900 000 erfolgreiche Datensätze wegen eines schlechten
verwirft, muss von vorn beginnen.

### Concurrency in three flavours · Nebenläufigkeit in drei Varianten

**EN** No model in the pipeline means nothing awaits, so the synchronous path
avoids two promises per record. With a model, `ordered` slides a window and
`unordered` races the pool.
*Why:* two promises per record is measurable at a million rows, and ordered
output is what lets you write results next to the input.

**DE** Ohne Modell wartet nichts, also vermeidet der synchrone Pfad zwei Promises
pro Datensatz. Mit Modell schiebt `ordered` ein Fenster, `unordered` rennt über
den Pool.
*Warum:* Zwei Promises pro Datensatz sind bei einer Million Zeilen messbar, und
sortierte Ausgabe erlaubt es, Ergebnisse neben die Eingabe zu schreiben.

### File readers · Datei-Leser

**EN** `ts-profanity-filter/batch/node` reads NDJSON, CSV, TSV and plain lines,
and writes NDJSON back with backpressure. The CSV parser is a character-level
state machine; the text column is guessed from the header, and an unguessable
header **stops and asks**.
*Why:* a quoted CSV field may contain the delimiter, a newline or an escaped
`""`, and reading the wrong column reports `0 flagged` — indistinguishable from a
genuinely clean file.

**DE** `ts-profanity-filter/batch/node` liest NDJSON, CSV, TSV und einfache
Zeilen und schreibt NDJSON mit Backpressure zurück. Der CSV-Parser ist ein
Zeichen-Zustandsautomat; die Textspalte wird aus der Kopfzeile erraten, und eine
nicht erratbare Kopfzeile **hält an und fragt**.
*Warum:* Ein CSV-Feld in Anführungszeichen kann Trennzeichen, Zeilenumbruch oder
`""` enthalten — und die falsche Spalte zu lesen meldet „0 markiert", was von
einer echt sauberen Datei nicht zu unterscheiden ist.

---

## 6 · The command line · Die Kommandozeile

**EN** `npx ts-profanity-filter scan <file>` runs the whole pipeline over a file:
`--pii`, `--ai`, `--out` for flagged records as NDJSON, `--pdf` for a report,
`--json` for a machine-readable summary, `--fail-on-findings` for CI. Progress
goes to stderr and the summary to stdout, so it composes. `--max-calls` defaults
to 100.
*Why:* a command that can spend money should not spend an unbounded amount of it
by default. [The full guide](docs/cli.md).

**DE** `npx ts-profanity-filter scan <datei>` fährt die ganze Kette über eine
Datei: `--pii`, `--ai`, `--out` für markierte Datensätze als NDJSON, `--pdf` für
einen Bericht, `--json` für eine maschinenlesbare Bilanz, `--fail-on-findings`
für CI. Fortschritt geht nach stderr, die Bilanz nach stdout — der Befehl lässt
sich also verketten. `--max-calls` steht standardmäßig auf 100.
*Warum:* Ein Befehl, der Geld ausgeben kann, sollte das nicht unbegrenzt tun.
[Die vollständige Anleitung](docs/cli.md).

### PDF reports · PDF-Berichte

**EN** `renderSummaryPdf()` renders the summary through `fast-pdf`, an
**optional** peer dependency loaded by dynamic import in that one function. Text
and PDF share the same row builder. `deterministic: true` gives byte-identical
output.
*Why:* `dependencies` stays empty, so an install that never renders a PDF pulls
nothing extra — and two report formats that disagree are worse than one.

**DE** `renderSummaryPdf()` rendert die Bilanz über `fast-pdf`, eine
**optionale** Peer-Dependency, die nur in dieser einen Funktion dynamisch
geladen wird. Text und PDF teilen denselben Zeilenbauer. `deterministic: true`
liefert byte-identische Ausgabe.
*Warum:* `dependencies` bleibt leer, also installiert niemand etwas, der nie eine
PDF rendert — und zwei Berichtsformate, die sich widersprechen, sind schlimmer
als eines.

---

## 7 · Framework adapters · Framework-Adapter

**EN** `react` (`useProfanitySegments`, `useIsProfane`), `vue` (accepting a
value, a ref or a getter) and `angular` (a pipe base class plus a service, with
**no** `@angular/core` import). All memoised by the **value** of the options, not
their identity.
*Why:* an inline object literal has a new identity on every render, and a pure
Angular pipe re-runs whenever a template literal does. Angular is not a peer
dependency at all because a decorated class has to be compiled by `ngtsc` in your
app, not by `tsc` here.

**DE** `react` (`useProfanitySegments`, `useIsProfane`), `vue` (nimmt Wert, Ref
oder Getter) und `angular` (Pipe-Basisklasse plus Service, **ohne**
`@angular/core`-Import). Alle memoisiert über den **Wert** der Optionen, nicht
über deren Identität.
*Warum:* Ein Inline-Objektliteral hat bei jedem Render eine neue Identität, und
eine pure Angular-Pipe läuft neu, sobald ein Template-Literal das tut. Angular
ist gar keine Peer-Dependency, weil eine dekorierte Klasse von `ngtsc` in deiner
App kompiliert werden muss, nicht von `tsc` hier.

---

## 8 · Around the library · Rund um die Bibliothek

| | EN | DE |
| --- | --- | --- |
| **Playground** | A single self-contained page generated from the compiled `dist/`, so it always runs the code npm ships. Bilingual, dark, live. | Eine einzelne autarke Seite, erzeugt aus dem kompilierten `dist/` — sie führt immer den Code aus, den npm ausliefert. Zweisprachig, dunkel, live. |
| **Adversarial benchmark** | `adversarial/` is a second package: 81 attacks, scored on evasion resistance **and** false positives, because either alone is trivial to game. | `adversarial/` ist ein zweites Paket: 81 Angriffe, bewertet auf Umgehungsresistenz **und** Falsch-Positive, weil jede Zahl allein trivial zu manipulieren ist. |
| **Server example** | `examples/server` keeps the key in the server process, caps the body size and rate-limits per IP. | `examples/server` hält den Schlüssel im Serverprozess, begrenzt die Body-Größe und limitiert pro IP. |
| **Chat-log fixture** | `examples/batch/chat-log.csv` — 25 messages with a documented expected verdict for every row. | `examples/batch/chat-log.csv` — 25 Nachrichten mit dokumentiertem Sollergebnis für jede Zeile. |
| **ESM only** | `require()` works on Node 20.19+ / 22.12+. Engine floor is Unicode property escapes; lookbehind is optional and compiled inside a `try`. | Nur ESM. `require()` funktioniert ab Node 20.19+ / 22.12+. Untergrenze sind Unicode-Property-Escapes; Lookbehind ist optional und wird in einem `try` kompiliert. |

---

## Known limits · Bekannte Grenzen

**EN** German compounding forces permissive allow entries, so a contrived word
containing both a slur and an allowed stem comes out clean — allowed always beats
blocked. `dick` is German for "thick" and is allowlisted with `de` active, which
necessarily clears the English word too. A model verdict is a second opinion with
a confidence, not ground truth. Word lists are a starting point, not a policy.

**DE** Deutsche Komposita erzwingen großzügige Erlaubniseinträge, deshalb kommt
ein konstruiertes Wort mit Schimpfwort *und* erlaubtem Stamm sauber heraus —
erlaubt schlägt immer gesperrt. `dick` ist deutsch und mit aktivem `de`
erlaubt, was zwangsläufig auch das englische Wort freigibt. Ein Modellurteil ist
eine zweite Meinung mit Sicherheitsangabe, keine Wahrheit. Wortlisten sind ein
Anfang, keine Richtlinie.

See [README.md](README.md) for the full documentation of every option, and
[docs/cli.md](docs/cli.md) for the command line.

Die vollständige Dokumentation aller Optionen steht in [README.md](README.md),
die der Kommandozeile in [docs/cli.md](docs/cli.md).
