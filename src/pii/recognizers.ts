// src/pii/recognizers.ts — what each anchor might mean.
//
// Every recognizer answers a local question at an anchor the scanner already
// found, and returns *candidates* rather than findings. Two of them are allowed
// to claim the same characters; deciding between them is `resolve()`'s job.
//
// The scoring rule throughout: arithmetic outranks shape, shape outranks
// punctuation, and a word nearby only ever adjusts what the string itself
// already argued for. Nothing reaches the default threshold on context alone.

import {
  IBAN_LENGTHS,
  isValidGermanTaxId,
  isValidIban,
  isValidLuhn,
} from './checksums.js';
import type { Anchors, DigitCluster } from './scan.js';
import type { PiiEvidence, PiiKind, PiiMatch } from './types.js';

export interface RecognizerContext {
  text: string;
  anchors: Anchors;
  clusters: readonly DigitCluster[];
  contextWindow: number;
}

const ALNUM = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;

/** Words that agree with a reading, per kind. Lower case; matched on a boundary. */
const CONTEXT_WORDS: Readonly<Record<PiiKind, readonly string[]>> = {
  email: ['mail', 'email', 'e-mail', 'kontakt', 'contact', 'absender', 'sender'],
  // `nummer` on its own is deliberately absent: it sits in front of order
  // numbers and customer numbers as often as phone numbers, and for a bare
  // digit run the keyword is the only evidence there is.
  phone: [
    'tel', 'telefon', 'phone', 'handy', 'mobil', 'mobile', 'fax', 'rufnummer',
    'anruf', 'call', 'erreichbar', 'hotline', 'durchwahl',
  ],
  iban: ['iban', 'konto', 'account', 'bank', 'überweis', 'transfer', 'zahlung', 'payment'],
  card: ['karte', 'card', 'kreditkarte', 'visa', 'mastercard', 'amex', 'credit', 'zahlung'],
  // `ipv4`/`ipv6` are listed separately because the boundary rule that keeps
  // `ip` out of `Prinzip` also keeps it out of `IPv6`.
  ip: ['ip', 'ipv4', 'ipv6', 'server', 'host', 'client', 'adresse', 'address', 'zugriff', 'log'],
  'taxid-de': [
    'steuer', 'steuerid', 'steuer-id', 'idnr', 'id-nr', 'identifikationsnummer',
    'taxid', 'tax id', 'finanzamt',
  ],
};

/**
 * Is one of `words` in the neighbourhood?
 *
 * Short keywords are boundary-checked on both sides, because `ip` lives inside
 * `Prinzip` and `Equipment` and would otherwise turn every dotted number in a
 * German sentence into an address.
 */
function hasContext(
  text: string,
  start: number,
  end: number,
  window: number,
  words: readonly string[],
): boolean {
  const from = Math.max(0, start - window);
  const to = Math.min(text.length, end + window);
  const haystack = (text.slice(from, start) + ' ' + text.slice(end, to)).toLowerCase();

  for (const word of words) {
    let at = haystack.indexOf(word);
    while (at !== -1) {
      const before = at === 0 ? '' : haystack[at - 1] ?? '';
      const afterIndex = at + word.length;
      const after = haystack[afterIndex] ?? '';
      const leftOk = before === '' || !LETTER.test(before);
      const rightOk = word.length > 3 || after === '' || !LETTER.test(after);
      if (leftOk && rightOk) return true;
      at = haystack.indexOf(word, at + 1);
    }
  }

  return false;
}

/**
 * What a nearby word is worth, per kind — because it is not worth the same
 * everywhere.
 *
 * `Telefon` in front of a ten-digit number is nearly the whole case, since
 * nothing about the digits themselves distinguishes a phone number from a
 * customer number. `IBAN:` in front of a string that already passes mod-97 adds
 * almost nothing, because the arithmetic had already settled it. A flat bonus
 * would have to be wrong in one of those two directions.
 */
const CONTEXT_BOOST: Readonly<Record<PiiKind, number>> = {
  email: 0.04,
  iban: 0.01,
  card: 0.2,
  phone: 0.35,
  'taxid-de': 0.2,
  ip: 0.15,
};

function candidate(
  text: string,
  kind: PiiKind,
  start: number,
  end: number,
  confidence: number,
  evidence: PiiEvidence[],
  ctx: RecognizerContext,
): PiiMatch {
  let score = confidence;
  const reasons = [...evidence];

  if (hasContext(text, start, end, ctx.contextWindow, CONTEXT_WORDS[kind])) {
    score = Math.min(0.99, score + CONTEXT_BOOST[kind]);
    reasons.push('context');
  }

  return {
    kind,
    text: text.slice(start, end),
    start,
    end,
    confidence: Math.round(score * 100) / 100,
    evidence: reasons,
  };
}

/* ------------------------------- e-mail -------------------------------- */

const LOCAL_CHAR = /[\p{L}\p{N}._%+\-!#$&'*/=?^`{|}~]/u;
const DOMAIN_CHAR = /[\p{L}\p{N}.\-]/u;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const TLD = /^\p{L}{2,24}$/u;

export function findEmails(ctx: RecognizerContext): PiiMatch[] {
  const { text } = ctx;
  const out: PiiMatch[] = [];

  for (const at of ctx.anchors.atSigns) {
    let start = at;
    while (start > 0 && LOCAL_CHAR.test(text[start - 1] as string)) start--;
    while (start < at && text[start] === '.') start++;

    let end = at + 1;
    while (end < text.length && DOMAIN_CHAR.test(text[end] as string)) end++;
    while (end > at + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) end--;

    const local = text.slice(start, at);
    const domain = text.slice(at + 1, end);

    if (local.length === 0 || local.length > 64 || local.includes('..')) continue;
    if (local.endsWith('.')) continue;

    const labels = domain.split('.');
    if (labels.length < 2) continue;
    if (labels.some((label) => label.length === 0 || label.length > 63 || !LABEL.test(label))) {
      continue;
    }
    if (!TLD.test(labels[labels.length - 1] as string)) continue;

    out.push(candidate(text, 'email', start, end, 0.95, ['format', 'structure'], ctx));
  }

  return out;
}

/* --------------------------------- IBAN -------------------------------- */

const IBAN_SEPARATOR = new Set([' ', ' ', ' ', '.', '-']);

export function findIbans(ctx: RecognizerContext): PiiMatch[] {
  const { text } = ctx;
  const out: PiiMatch[] = [];

  for (const run of ctx.anchors.digitRuns) {
    const start = run.start - 2;
    if (start < 0) continue;

    const prefix = text.slice(start, run.start);
    if (!/^[A-Za-z]{2}$/.test(prefix)) continue;
    if (start > 0 && ALNUM.test(text[start - 1] as string)) continue;

    const expected = IBAN_LENGTHS[prefix.toUpperCase()];
    if (expected === undefined) continue;

    // Consume `expected` alphanumerics, tolerating one separator between them —
    // which is how every printed IBAN is grouped, in fours.
    let collected = '';
    let pos = start;
    while (pos < text.length && collected.length < expected) {
      const char = text[pos] as string;
      if (ALNUM.test(char)) {
        collected += char;
        pos++;
        continue;
      }
      const next = text[pos + 1];
      if (IBAN_SEPARATOR.has(char) && next !== undefined && ALNUM.test(next)) {
        pos++;
        continue;
      }
      break;
    }

    if (collected.length !== expected) continue;
    if (pos < text.length && ALNUM.test(text[pos] as string)) continue;
    if (!isValidIban(collected)) continue;

    out.push(candidate(text, 'iban', start, pos, 0.98, ['structure', 'checksum'], ctx));
  }

  return out;
}

/* --------------------------------- card -------------------------------- */

/** Issuer prefixes with their published lengths. */
const CARD_BRANDS: readonly { pattern: RegExp; lengths: readonly number[] }[] = [
  { pattern: /^4/, lengths: [13, 16, 19] }, // Visa
  { pattern: /^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))/, lengths: [16] }, // Mastercard
  { pattern: /^3[47]/, lengths: [15] }, // American Express
  { pattern: /^3(0[0-5]|[68])/, lengths: [14, 16, 17, 18, 19] }, // Diners
  { pattern: /^(6011|64[4-9]|65)/, lengths: [16, 17, 18, 19] }, // Discover
  { pattern: /^35(2[89]|[3-8][0-9])/, lengths: [16, 17, 18, 19] }, // JCB
  { pattern: /^62/, lengths: [16, 17, 18, 19] }, // UnionPay
];

export function findCards(ctx: RecognizerContext): PiiMatch[] {
  const out: PiiMatch[] = [];

  for (const cluster of ctx.clusters) {
    const { digits } = cluster;
    if (digits.length < 13 || digits.length > 19) continue;
    if (cluster.plus) continue; // a `+` means a phone number, never a card
    if (!isValidLuhn(digits)) continue;

    const branded = CARD_BRANDS.some(
      (brand) => brand.pattern.test(digits) && brand.lengths.includes(digits.length),
    );

    // Luhn alone is a one-in-ten coincidence, so an unbranded number stays
    // below the default threshold until something else speaks for it.
    out.push(
      candidate(
        ctx.text,
        'card',
        cluster.start,
        cluster.end,
        branded ? 0.95 : 0.5,
        branded ? ['structure', 'checksum'] : ['checksum'],
        ctx,
      ),
    );
  }

  return out;
}

/* -------------------------------- phone -------------------------------- */

const DATE_SHAPED = /^[0-9]{1,2}[.\/][0-9]{1,2}[.\/][0-9]{2,4}\.?$/;

export function findPhones(ctx: RecognizerContext): PiiMatch[] {
  const out: PiiMatch[] = [];

  for (const cluster of ctx.clusters) {
    const { digits, raw } = cluster;
    if (DATE_SHAPED.test(raw)) continue;

    let confidence = 0;
    const evidence: PiiEvidence[] = ['structure'];

    if (cluster.plus) {
      // E.164: the `+` is the format declaring itself.
      if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) continue;
      confidence = 0.9;
      evidence.unshift('format');
    } else if (digits.startsWith('00')) {
      const international = digits.slice(2);
      if (international.length < 8 || international.length > 15) continue;
      confidence = 0.85;
      evidence.unshift('format');
    } else if (digits.startsWith('0')) {
      if (digits.length < 7 || digits.length > 14) continue;
      confidence = 0.75;
    } else {
      // No `+`, no trunk zero: this is just a number. It only becomes a phone
      // number if a word next to it says so.
      if (digits.length < 7 || digits.length > 14) continue;
      confidence = 0.3;
    }

    if (cluster.groups.length >= 2) confidence = Math.min(0.95, confidence + 0.05);

    out.push(
      candidate(ctx.text, 'phone', cluster.start, cluster.end, confidence, evidence, ctx),
    );
  }

  return out;
}

/* ------------------------------- tax id -------------------------------- */

export function findGermanTaxIds(ctx: RecognizerContext): PiiMatch[] {
  const out: PiiMatch[] = [];

  for (const cluster of ctx.clusters) {
    if (cluster.plus) continue;
    if (cluster.digits.length !== 11) continue;
    if (!isValidGermanTaxId(cluster.digits)) continue;

    // Both checks passed, which is worth roughly one in a hundred by chance —
    // not enough on its own for a number that looks like every other long
    // number, so this one leans on context to clear the bar.
    out.push(
      candidate(
        ctx.text,
        'taxid-de',
        cluster.start,
        cluster.end,
        0.45,
        ['structure', 'checksum'],
        ctx,
      ),
    );
  }

  return out;
}

/* ------------------------------ IP address ----------------------------- */

function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every(
    (part) =>
      /^[0-9]{1,3}$/.test(part) && Number(part) <= 255 && (part === '0' || !part.startsWith('0')),
  );
}

function isValidIpv6(value: string): boolean {
  if (value.includes(':::')) return false;

  const doubleAt = value.indexOf('::');
  const compressed = doubleAt !== -1;
  if (compressed && doubleAt !== value.lastIndexOf('::')) return false;

  const head = compressed ? value.slice(0, doubleAt) : value;
  const tail = compressed ? value.slice(doubleAt + 2) : '';
  const parts = [
    ...(head === '' ? [] : head.split(':')),
    ...(tail === '' ? [] : tail.split(':')),
  ];
  if (parts.some((part) => part === '')) return false;

  let count = parts.length;
  const last = parts[parts.length - 1];
  const embedsIpv4 = last !== undefined && last.includes('.');

  if (embedsIpv4) {
    if (!isValidIpv4(last)) return false;
    count += 1; // an embedded IPv4 occupies two groups
  }

  const hexParts = embedsIpv4 ? parts.slice(0, -1) : parts;
  if (hexParts.some((part) => !/^[0-9a-fA-F]{1,4}$/.test(part))) return false;

  return compressed ? count <= 7 : count === 8;
}

const VERSION_BEFORE = /\bv(?:ersion)?\s*$/i;

export function findIps(ctx: RecognizerContext): PiiMatch[] {
  const { text, anchors } = ctx;
  const out: PiiMatch[] = [];
  const runs = anchors.digitRuns;

  /* IPv4: four digit runs joined by single dots. */
  for (let i = 0; i + 3 < runs.length; i++) {
    const quad = [runs[i], runs[i + 1], runs[i + 2], runs[i + 3]];
    if (quad.some((run) => run === undefined)) continue;

    let joined = true;
    for (let k = 0; k < 3; k++) {
      const left = quad[k];
      const right = quad[k + 1];
      if (left === undefined || right === undefined) continue;
      if (right.start - left.end !== 1 || text[left.end] !== '.') joined = false;
    }
    if (!joined) continue;

    const first = quad[0];
    const last = quad[3];
    if (first === undefined || last === undefined) continue;

    const before = first.start === 0 ? '' : (text[first.start - 1] as string);
    const after = last.end >= text.length ? '' : (text[last.end] as string);
    if (before !== '' && (ALNUM.test(before) || before === '.')) continue;
    if (after !== '' && (ALNUM.test(after) || after === '.')) continue;

    const value = text.slice(first.start, last.end);
    if (!isValidIpv4(value)) continue;

    // `1.2.3.4` is a valid address and also how everyone writes a version
    // number. The word in front is the only thing that separates them.
    if (VERSION_BEFORE.test(text.slice(Math.max(0, first.start - 10), first.start))) continue;

    // Four single digits is the shape of a version number — except when they
    // are all the same digit, which no version has ever been and which is what
    // the well-known resolvers look like (8.8.8.8, 1.1.1.1).
    const octets = value.split('.');
    const allSingle = octets.every((part) => part.length === 1);
    const allEqual = octets.every((part) => part === octets[0]);
    const ambiguous = allSingle && !allEqual;

    out.push(
      candidate(
        text,
        'ip',
        first.start,
        last.end,
        ambiguous ? 0.5 : 0.8,
        ['structure'],
        ctx,
      ),
    );
  }

  /* IPv6: expand around colons over hex, colons and dots. */
  const HEX_SPAN = /[0-9a-fA-F:.]/;
  let cursor = -1;

  for (const colon of anchors.colons) {
    if (colon <= cursor) continue;

    let start = colon;
    while (start > 0 && HEX_SPAN.test(text[start - 1] as string)) start--;
    let end = colon + 1;
    while (end < text.length && HEX_SPAN.test(text[end] as string)) end++;

    while (start < end && (text[start] === ':' || text[start] === '.')) {
      if (text.startsWith('::', start)) break;
      start++;
    }
    while (end > start && (text[end - 1] === '.' || (text[end - 1] === ':' && !text.startsWith('::', end - 2)))) {
      end--;
    }
    cursor = end;

    if (start > 0 && ALNUM.test(text[start - 1] as string)) continue;
    if (end < text.length && ALNUM.test(text[end] as string)) continue;

    const value = text.slice(start, end);
    if (!value.includes(':') || !isValidIpv6(value)) continue;

    out.push(candidate(text, 'ip', start, end, 0.85, ['structure'], ctx));
  }

  return out;
}

export const RECOGNIZERS: Readonly<Record<PiiKind, (ctx: RecognizerContext) => PiiMatch[]>> = {
  email: findEmails,
  iban: findIbans,
  card: findCards,
  phone: findPhones,
  'taxid-de': findGermanTaxIds,
  ip: findIps,
};
