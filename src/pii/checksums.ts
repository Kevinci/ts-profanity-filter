// src/pii/checksums.ts — the arithmetic that turns a guess into a fact.
//
// These are the whole reason this module can be strict. A pattern says "this
// looks like an IBAN"; mod-97 says "this is one, or somebody mistyped it".
// Every function here is exported, because they are useful on their own and
// because a checksum you cannot test in isolation is a checksum you cannot
// trust.

/** ISO 7812 / Luhn. Used by payment cards, IMEIs and a few national ids. */
export function isValidLuhn(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits) || digits.length < 2) return false;

  let sum = 0;
  let double = false;

  // Right to left: every second digit is doubled, and a doubled digit over 9
  // has its digits added — which is the same as subtracting 9.
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }

  return sum % 10 === 0;
}

/**
 * The published length of an IBAN per country. This is not decoration: the
 * checksum alone accepts a truncated IBAN often enough to matter, and the
 * length is what stops the scanner from swallowing the next number on the line.
 *
 * Hand-aligned on purpose — this is a lookup table, and one country per line
 * turns twelve readable rows into seventy-eight unreadable ones.
 */
// prettier-ignore
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/**
 * ISO 13616 check: move the first four characters to the end, replace every
 * letter by its position in the alphabet plus 9, and the result must be
 * congruent to 1 mod 97.
 *
 * The remainder is taken nine digits at a time. The whole number would overflow
 * a double long before a 34-character IBAN is finished, and doing it in BigInt
 * would cost an allocation per candidate for arithmetic that fits in an int.
 */
export function isValidIban(candidate: string): boolean {
  // The class holds an ordinary space *and* a non-breaking one, because that
  // is what a pasted IBAN contains. Invisible in the source, which is why the
  // linter objects — and why it has to stay.
  // eslint-disable-next-line no-irregular-whitespace
  const iban = candidate.replace(/[\s.\- ]/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected === undefined || iban.length !== expected) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);

  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    // 'A'..'Z' -> "10".."35", digits stay themselves.
    const part = code >= 65 ? String(code - 55) : char;
    remainder = Number(String(remainder) + part) % 97;
  }

  return remainder === 1;
}

/**
 * ISO 7064 MOD 11,10 — the check digit of the German Steuerliche
 * Identifikationsnummer (IdNr).
 */
export function iso7064Mod1110(digits: string): number {
  let product = 10;

  for (const char of digits) {
    let sum = (char.charCodeAt(0) - 48 + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }

  const check = 11 - product;
  return check === 10 ? 0 : check;
}

/**
 * German tax id: eleven digits, and two rules that are easy to miss.
 *
 * The check digit is only half of it. The Bundeszentralamt für Steuern also
 * guarantees a *repetition* rule over the first ten digits — exactly one digit
 * occurs twice or three times and the rest at most once — which is what makes
 * a plain counter or a padded phone number fail here even when its check digit
 * happens to land right.
 */
export function isValidGermanTaxId(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits)) return false;
  if (digits[0] === '0') return false;

  const body = digits.slice(0, 10);
  const counts = new Map<string, number>();
  for (const char of body) counts.set(char, (counts.get(char) ?? 0) + 1);

  let repeated = 0;
  for (const count of counts.values()) {
    if (count > 3) return false;
    if (count > 1) repeated++;
  }
  if (repeated !== 1) return false;

  return iso7064Mod1110(body) === digits.charCodeAt(10) - 48;
}
