import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  detectPii,
  hasPii,
  isValidGermanTaxId,
  isValidIban,
  isValidLuhn,
  iso7064Mod1110,
  piiToSegments,
  PII_KINDS,
  type PiiKind,
} from '../dist/pii/index.js';

/** `kind:text` per finding, which is what almost every assertion here is about. */
function found(text: string, options?: Parameters<typeof detectPii>[1]): string[] {
  return detectPii(text, options).map((match) => `${match.kind}:${match.text}`);
}

function kindsOf(text: string, options?: Parameters<typeof detectPii>[1]): PiiKind[] {
  return detectPii(text, options).map((match) => match.kind);
}

/* ----------------------- checksums, against published vectors ----------- */

test('IBANs from the published examples verify, a single wrong digit does not', () => {
  for (const iban of [
    'DE89370400440532013000',
    'DE44500105175407324931',
    'GB82WEST12345698765432',
    'AT611904300234573201',
    'CH9300762011623852957',
    'FR1420041010050500013M02606',
    'NL91ABNA0417164300',
  ]) {
    assert.equal(isValidIban(iban), true, iban);
  }

  assert.equal(isValidIban('DE89370400440532013001'), false);
  // Right checksum, wrong length for the country — caught by the length table.
  assert.equal(isValidIban('DE8937040044053201300'), false);
  assert.equal(isValidIban('ZZ89370400440532013000'), false, 'unknown country');
  assert.equal(isValidIban('DE44 5001 0517 5407 3249 31'), true, 'grouped spelling');
});

test('the standard test card numbers pass Luhn', () => {
  for (const card of [
    '4111111111111111',
    '4012888888881881',
    '5555555555554444',
    '5105105105105100',
    '378282246310005',
    '371449635398431',
    '6011111111111117',
    '3530111333300000',
    '30569309025904',
  ]) {
    assert.equal(isValidLuhn(card), true, card);
  }

  assert.equal(isValidLuhn('4111111111111112'), false);
  assert.equal(isValidLuhn('abcd'), false);
});

test('the tax id check digit matches the official worked example', () => {
  // 86095742719 is the example in the BZSt check-digit specification.
  assert.equal(iso7064Mod1110('8609574271'), 9);
  assert.equal(isValidGermanTaxId('86095742719'), true);
  assert.equal(isValidGermanTaxId('47036892816'), true);

  assert.equal(isValidGermanTaxId('86095742718'), false, 'wrong check digit');
  assert.equal(isValidGermanTaxId('11111111111'), false, 'fails the repetition rule');
  assert.equal(isValidGermanTaxId('06095742719'), false, 'leading zero');
  assert.equal(isValidGermanTaxId('8609574271'), false, 'ten digits');
});

/* ------------------------------- e-mail -------------------------------- */

test('e-mail addresses are found and their punctuation is not swallowed', () => {
  assert.deepEqual(found('Schreib an kevin.imig@example.de, danke'), [
    'email:kevin.imig@example.de',
  ]);
  assert.deepEqual(found('Mail: a@b.de. Ende'), ['email:a@b.de'], 'trailing sentence dot');
  assert.deepEqual(found('zwei: a@b.de und c@d.com'), ['email:a@b.de', 'email:c@d.com']);
  assert.deepEqual(found('umlaut: jörg@münchen.de'), ['email:jörg@münchen.de']);
});

test('an @ without a real domain is not an address', () => {
  assert.deepEqual(found('@handle sagt hallo'), []);
  assert.deepEqual(found('a@b'), [], 'no dot in the domain');
  assert.deepEqual(found('a@b.d'), [], 'one-letter TLD');
  assert.deepEqual(found('a@b..de'), []);
  assert.deepEqual(found('preis 5 @ 3 euro'), []);
});

/* -------------------------------- phone -------------------------------- */

test('phone numbers are recognised in the shapes people write them', () => {
  assert.deepEqual(found('Tel.: 030 12345678'), ['phone:030 12345678']);
  assert.deepEqual(found('+49 170 1234567 erreichbar'), ['phone:+49 170 1234567']);
  assert.deepEqual(found('Fax (030) 123456'), ['phone:(030) 123456']);
  assert.deepEqual(found('ruf 0049 170 1234567 an'), ['phone:0049 170 1234567']);
  assert.deepEqual(found('Handy: 0170-123-4567'), ['phone:0170-123-4567']);
});

test('a bare number needs a word next to it before it counts as a phone number', () => {
  assert.deepEqual(found('Die Zahl 1701234567 steht hier'), []);
  assert.deepEqual(found('Telefon 1701234567'), ['phone:1701234567']);
});

/* --------------------------------- IBAN -------------------------------- */

test('IBANs are found grouped and ungrouped, and the span is exact', () => {
  const text = 'Meine IBAN ist DE44 5001 0517 5407 3249 31 für die Überweisung.';
  const [match] = detectPii(text);
  assert.ok(match);
  assert.equal(match.kind, 'iban');
  assert.equal(match.text, 'DE44 5001 0517 5407 3249 31');
  assert.equal(text.slice(match.start, match.end), match.text);
  assert.ok(match.evidence.includes('checksum'));

  assert.deepEqual(found('DE44500105175407324931'), ['iban:DE44500105175407324931']);
});

test('a mistyped IBAN is reported as nothing rather than as a guess', () => {
  assert.deepEqual(found('IBAN DE44 5001 0517 5407 3249 32'), []);
  assert.deepEqual(found('xDE44500105175407324931'), [], 'glued to a word');
});

/* --------------------------------- card -------------------------------- */

test('card numbers need Luhn and a known issuer prefix', () => {
  assert.deepEqual(found('Karte 4111 1111 1111 1111 abgelehnt'), ['card:4111 1111 1111 1111']);
  assert.deepEqual(found('4111111111111111'), ['card:4111111111111111']);
  assert.deepEqual(found('378282246310005'), ['card:378282246310005'], 'Amex, 15 digits');

  // Luhn-valid but no issuer owns this prefix: below the default threshold.
  assert.deepEqual(found('9999999999999995'), []);
  assert.deepEqual(found('Karte 4111 1111 1111 1112'), [], 'Luhn fails');
});

/* ---------------------------------- IP --------------------------------- */

test('IPv4 addresses are found, and version numbers are not', () => {
  assert.deepEqual(found('Server 192.168.1.1 antwortet nicht'), ['ip:192.168.1.1']);
  assert.deepEqual(found('von 8.8.8.8 aus'), ['ip:8.8.8.8']);
  assert.deepEqual(found('Version 1.2.3.4 ist alt'), [], 'the word in front decides');
  assert.deepEqual(found('v1.2.3.4'), []);
  assert.deepEqual(found('256.1.1.1'), [], 'octet out of range');
  assert.deepEqual(found('1.2.3.4.5'), [], 'five groups');
});

test('a four-single-digit address is ambiguous and stays below the bar', () => {
  assert.deepEqual(found('1.2.3.4'), []);
  assert.deepEqual(found('1.2.3.4', { minConfidence: 0.4 }), ['ip:1.2.3.4']);
});

test('IPv6 addresses are validated structurally, not pattern-matched', () => {
  assert.deepEqual(found('IPv6: 2001:db8::1'), ['ip:2001:db8::1']);
  assert.deepEqual(found('fe80::1'), ['ip:fe80::1']);
  assert.deepEqual(found('2001:db8:0:0:0:0:2:1'), ['ip:2001:db8:0:0:0:0:2:1']);
  assert.deepEqual(found('Termin um 12:30:45 Uhr'), [], 'three groups is not an address');
  assert.deepEqual(found('nicht 2001:db8:::1'), [], 'triple colon');
});

/* -------------------------------- tax id ------------------------------- */

test('a tax id is only reported when something nearby says it is one', () => {
  assert.deepEqual(found('Steuer-ID: 86095742719'), ['taxid-de:86095742719']);
  assert.deepEqual(found('Die Zahl 86095742719 steht hier ohne Kontext'), []);
  assert.deepEqual(found('Finanzamt, IdNr 47036892816'), ['taxid-de:47036892816']);
});

/* --------------------- the quiet half: false positives ----------------- */

test('ordinary numbers in prose are left alone', () => {
  for (const text of [
    'Bestellnummer 4711 vom 12.05.2026',
    'Der Preis war 1234 Euro',
    'build abc1234567890 fertig',
    'Rechnung 2026-08-10 über 1.234,56 EUR',
    'Artikel 17 DSA, Absatz 3',
    'Wir haben 1000 Nutzer und 250 Kunden',
    'ISBN 978-3-16-148410-0',
    'Kapitel 1.2.3 auf Seite 45',
  ]) {
    assert.deepEqual(found(text), [], text);
  }
});

/* ------------------------ offsets and segments ------------------------- */

test('every reported span slices back to the reported text', () => {
  const text =
    'Kontakt kevin@example.de, Tel. +49 170 1234567, IBAN DE44 5001 0517 5407 3249 31, ' +
    'Server 192.168.1.1 — 🎉 fertig';

  const matches = detectPii(text);
  assert.equal(matches.length, 4);

  for (const match of matches) {
    assert.equal(text.slice(match.start, match.end), match.text);
    assert.ok(match.confidence > 0 && match.confidence <= 1);
    assert.ok(match.evidence.length > 0);
  }

  assert.deepEqual(kindsOf(text), ['email', 'phone', 'iban', 'ip']);
});

test('offsets survive characters outside the BMP', () => {
  const text = '🎉🎉 mail an kevin@example.de';
  const [match] = detectPii(text);
  assert.ok(match);
  assert.equal(text.slice(match.start, match.end), 'kevin@example.de');
});

test('segments concatenate back to the input exactly', () => {
  for (const text of [
    'IBAN DE44 5001 0517 5407 3249 31 und mail@x.de',
    'nichts hier',
    'Tel. 030 12345678',
    '🎉 kevin@example.de 🎉',
  ]) {
    const segments = piiToSegments(text);
    assert.equal(segments.map((segment) => segment.text).join(''), text, text);
    for (const segment of segments) {
      assert.equal(segment.isPii, segment.kind !== undefined);
    }
  }

  assert.deepEqual(piiToSegments(''), []);
  assert.deepEqual(piiToSegments('leer'), [{ text: 'leer', isPii: false }]);
});

/* ---------------------------- overlap ---------------------------------- */

test('an embedded address does not produce a second finding', () => {
  // ::ffff:192.168.1.1 is an IPv6 address that contains an IPv4 one. Both
  // recognizers fire; the longer, better-supported span wins outright.
  const matches = detectPii('host ::ffff:192.168.1.1 da');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.text, '::ffff:192.168.1.1');
});

test('findings never overlap and are ordered', () => {
  const text = 'a@b.de 4111111111111111 DE44500105175407324931 192.168.1.1 +49 170 1234567';
  const matches = detectPii(text);
  assert.ok(matches.length >= 4);

  for (let i = 1; i < matches.length; i++) {
    const previous = matches[i - 1];
    const current = matches[i];
    assert.ok(previous && current);
    assert.ok(previous.end <= current.start, 'no overlap');
  }
});

/* ---------------------------- options ---------------------------------- */

test('kinds narrows the search, and an unknown kind throws', () => {
  const text = 'mail@x.de und 4111111111111111';
  assert.deepEqual(found(text, { kinds: ['email'] }), ['email:mail@x.de']);
  assert.deepEqual(found(text, { kinds: ['card'] }), ['card:4111111111111111']);
  assert.deepEqual(found(text, { kinds: [] }), []);
  assert.deepEqual(found(text, { kinds: '*' }).length, 2);

  assert.throws(
    () => detectPii(text, { kinds: ['ssn' as PiiKind] }),
    (error: unknown) =>
      error instanceof TypeError && /unknown kind "ssn"/.test((error as Error).message),
  );
});

test('minConfidence exposes what the default suppresses', () => {
  const text = 'Die Zahl 1701234567 steht hier';
  assert.deepEqual(found(text), []);
  assert.deepEqual(found(text, { minConfidence: 0.2 }), ['phone:1701234567']);
});

test('context has to be near the finding, not merely in the text', () => {
  const near = 'Steuer-ID 86095742719';
  const far = 'Steuer\n\n' + ' '.repeat(80) + '\n86095742719';
  assert.deepEqual(found(near).length, 1);
  assert.deepEqual(found(far), []);
});

test('hasPii answers the yes/no question', () => {
  assert.equal(hasPii('schreib an a@b.de'), true);
  assert.equal(hasPii('nichts hier'), false);
  assert.equal(hasPii('a@b.de', { kinds: ['iban'] }), false);
});

test('every advertised kind is reachable', () => {
  assert.deepEqual([...PII_KINDS].sort(), ['card', 'email', 'iban', 'ip', 'phone', 'taxid-de']);

  const samples: Record<PiiKind, string> = {
    email: 'a@b.de',
    phone: 'Tel. 030 12345678',
    iban: 'DE44500105175407324931',
    card: '4111111111111111',
    ip: 'Server 192.168.1.1',
    'taxid-de': 'Steuer-ID 86095742719',
  };

  for (const kind of PII_KINDS) {
    assert.deepEqual(kindsOf(samples[kind], { kinds: [kind] }), [kind], kind);
  }
});
