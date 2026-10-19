const DIACRITICS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  á: 'a',
  é: 'e',
  í: 'i',
  ú: 'u',
  ü: 'u',
  ö: 'o',
  ä: 'a',
  ß: 'ss',
};

/** Końcówki fleksyjne języka polskiego (od najdłuższych). */
const SUFFIXES = [
  'owie',
  'ami',
  'ach',
  'ów',
  'om',
  'ie',
  'em',
  'ego',
  'emu',
  'ych',
  'ymi',
  'owi',
  'y',
  'a',
  'i',
  'e',
  'u',
];

export function stripDiacritics(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => DIACRITICS[ch] ?? ch)
    .join('');
}

/** Usuwa interpunkcję, normalizuje spacje i diakrytyki. */
export function normalize(input: string): string {
  return stripDiacritics(input)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prosty stemmer: usuwa najdłuższą pasującą końcówkę, ale tylko gdy
 * pozostawia co najmniej 4 znaki. Krótsze słowa zostawiamy bez zmian,
 * aby nie zniekształcać form bliskich mianownikowi (np. "reczni").
 */
export function stemWord(word: string): string {
  if (word.length <= 5) return word;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

export function tokenize(input: string): string[] {
  const normalized = normalize(input);
  if (!normalized) return [];
  return normalized.split(' ').map(stemWord).filter(Boolean);
}

/** Znormalizowany, zestemowany klucz porównawczy. */
export function comparisonKey(input: string): string {
  return tokenize(input).join(' ');
}
