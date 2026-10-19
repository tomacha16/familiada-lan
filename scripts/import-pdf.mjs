/**
 * Import pytań z PDF do data/seed/questions.json.
 *
 * Format źródłowy (jedna linia na pytanie):
 *   • Treść pytania: odpowiedź 1, odpowiedź 2, odpowiedź 3
 *
 * Kategorie występują jako numerowana lista na początku dokumentu:
 *   1. Jedzenie i picie
 *   2. Geografia
 *   ...
 *
 * Uruchomienie:
 *   node scripts/import-pdf.mjs "C:/ścieżka/do/pliku.pdf"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const OUT_PATH = path.join(ROOT, 'data', 'seed', 'questions.json');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Użycie: node scripts/import-pdf.mjs <ścieżka-do-pdf>');
  process.exit(1);
}

/* ------------------------- normalizacja tekstu ------------------------- */

const DIACRITICS = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

function stripDiacritics(text) {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => DIACRITICS[ch] ?? ch)
    .join('');
}

/** Aliasy: wariant bez diakrytyków, jeśli różni się od oryginału. */
function buildAliases(text) {
  const plain = stripDiacritics(text);
  return plain !== text.toLowerCase() ? [plain] : [];
}

/* --------------------------- punktacja -------------------------------- */

/**
 * Punkty proporcjonalne do pozycji na tablicy.
 * Pozycja 1 dostaje najwięcej, ostatnia najmniej.
 * Skala 100..10 (zaokrąglona do 5).
 */
function pointsForRank(rank, total) {
  if (total <= 1) return 100;
  const ratio = (total - rank) / (total - 1); // 1 -> 0
  const raw = 10 + ratio * 90;
  return Math.max(5, Math.round(raw / 5) * 5);
}

/* ----------------------------- parser -------------------------------- */

const CATEGORY_RE = /^\s*(\d{1,2})\.\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[•·]\s*(.+)$/;

/** Czyści odpowiedź: usuwa kropki końcowe, cudzysłowy, nadmiar spacji. */
function cleanAnswer(text) {
  return text
    .replace(/^["„”']+|["„”']+$/g, '')
    .replace(/[.;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuestion(text) {
  return text.replace(/\s+/g, ' ').replace(/[?]?\s*$/, '?').trim();
}

/**
 * Dzieli treść na pytanie i listę odpowiedzi.
 * Separator: pierwszy dwukropek, po którym następuje lista.
 */
function splitQuestion(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const question = line.slice(0, colonIndex).trim();
  const answersRaw = line.slice(colonIndex + 1).trim();
  if (!question || !answersRaw) return null;

  // PDF używa przecinków, kropek i średników jako separatorów.
  // Dzielimy po przecinku, średniku ORAZ po kropce, jeśli po niej
  // następuje spacja i wielka litera (unikamy dzielenia skrótów).
  const answers = answersRaw
    .split(/[,;]\s*|\.\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/)
    .map(cleanAnswer)
    .filter((a) => a.length > 0 && a.length < 80);

  if (answers.length < 2) return null;
  return { question, answers };
}

function parse(text) {
  const lines = text.split(/\r?\n/);

  // 1. Zbierz kategorie z początkowej listy numerowanej
  const categories = [];
  for (const line of lines.slice(0, 40)) {
    const match = line.match(CATEGORY_RE);
    if (match) {
      const num = Number(match[1]);
      if (num >= 1 && num <= 30) categories.push(match[2].trim());
    }
  }

  // 2. Zbierz pytania z przypisaniem strony (każda strona = jedna kategoria)
  const rawQuestions = [];
  let pending = null;
  let currentPage = 0;

  const PAGE_MARKER_RE = /^--\s*(\d+)\s+of\s+\d+\s*--$/;

  const flush = () => {
    if (pending) {
      rawQuestions.push({ text: pending, page: currentPage });
      pending = null;
    }
  };

  for (const line of lines) {
    const pageMatch = line.trim().match(PAGE_MARKER_RE);
    if (pageMatch) {
      flush();
      currentPage = Number(pageMatch[1]);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flush();
      pending = bullet[1].trim();
      continue;
    }
    // Kontynuacja poprzedniego pytania (linia bez punktora, niepusta)
    if (pending && line.trim() && !CATEGORY_RE.test(line)) {
      pending += ' ' + line.trim();
    } else if (pending && !line.trim()) {
      flush();
    }
  }
  flush();

  // 3. Konwersja na strukturę pytań.
  // Strona 1 = pierwsza kategoria, strona 2 = druga itd.
  const questions = [];

  for (const raw of rawQuestions) {
    const parsed = splitQuestion(raw.text);
    if (!parsed) continue;

    const category = categories[raw.page - 1] ?? 'Inne';

    const total = parsed.answers.length;
    const answers = parsed.answers.map((text, index) => ({
      text,
      points: pointsForRank(index + 1, total),
      rank: index + 1,
      aliases: buildAliases(text),
    }));

    questions.push({
      text: cleanQuestion(parsed.question),
      category,
      roundType: 'normal',
      answers,
    });
  }

  return { categories, questions };
}

/* ------------------------------ main --------------------------------- */

const buffer = fs.readFileSync(pdfPath);
const parser = new PDFParse({ data: buffer });
const data = await parser.getText();
await parser.destroy();
const { categories, questions } = parse(data.text);

// Oznacz co 7. pytanie jako finałowe (różnorodność w finale)
questions.forEach((q, index) => {
  if (index % 7 === 3) q.roundType = 'final';
});

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify({ questions }, null, 2), 'utf8');

const normal = questions.filter((q) => q.roundType === 'normal').length;
const final = questions.filter((q) => q.roundType === 'final').length;
const avgAnswers = (
  questions.reduce((sum, q) => sum + q.answers.length, 0) / questions.length
).toFixed(1);

console.log(`\nZaimportowano ${questions.length} pytań`);
console.log(`  kategorie: ${categories.length} (${categories.join(', ')})`);
console.log(`  normalne: ${normal}, finałowe: ${final}`);
console.log(`  średnio odpowiedzi na pytanie: ${avgAnswers}`);
console.log(`  zapisano: ${OUT_PATH}\n`);
