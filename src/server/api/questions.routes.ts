import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { QuestionInput } from '../../shared/types.js';
import {
  createQuestion,
  deleteQuestion,
  getQuestion,
  listQuestions,
  updateQuestion,
} from '../db/questions.repo.js';
import { requireHostPin } from '../realtime/auth.js';

const answerSchema = z.object({
  text: z.string().min(1),
  points: z.number().int().positive(),
  rank: z.number().int().positive(),
  aliases: z.array(z.string()).optional(),
});

const questionSchema = z.object({
  text: z.string().min(1),
  category: z.string().nullable().optional(),
  roundType: z.enum(['normal', 'final']).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  isActive: z.boolean().optional(),
  answers: z.array(answerSchema).min(1),
});

const importSchema = z.object({ questions: z.array(questionSchema).min(1) });

function hostGuard(req: Request, res: Response, next: NextFunction): void {
  const pin = req.header('X-Host-Pin');
  if (!requireHostPin(pin)) {
    res.status(401).json({ error: 'Nieprawidłowy PIN hosta' });
    return;
  }
  next();
}

export function questionsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const roundType = req.query.roundType;
    const category = req.query.category;
    const questions = listQuestions({
      roundType: roundType === 'normal' || roundType === 'final' ? roundType : undefined,
      category: typeof category === 'string' ? category : undefined,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ questions });
  });

  router.get('/export', (_req, res) => {
    const questions = listQuestions({ includeInactive: true });
    res.setHeader('Content-Disposition', 'attachment; filename="questions.json"');
    res.json({
      questions: questions.map((q) => ({
        text: q.text,
        category: q.category,
        roundType: q.roundType,
        difficulty: q.difficulty,
        answers: q.answers,
      })),
    });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const question = getQuestion(id);
    if (!question) {
      res.status(404).json({ error: 'Pytanie nie istnieje' });
      return;
    }
    res.json({ question });
  });

  router.post('/', hostGuard, (req, res) => {
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Nieprawidłowe dane', details: parsed.error.flatten() });
      return;
    }
    try {
      const question = createQuestion(parsed.data as QuestionInput);
      res.status(201).json({ question });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Błąd walidacji' });
    }
  });

  router.put('/:id', hostGuard, (req, res) => {
    const id = Number(req.params.id);
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Nieprawidłowe dane', details: parsed.error.flatten() });
      return;
    }
    try {
      const question = updateQuestion(id, parsed.data as QuestionInput);
      if (!question) {
        res.status(404).json({ error: 'Pytanie nie istnieje' });
        return;
      }
      res.json({ question });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Błąd walidacji' });
    }
  });

  router.delete('/:id', hostGuard, (req, res) => {
    const id = Number(req.params.id);
    const deleted = deleteQuestion(id);
    if (!deleted) {
      res.status(404).json({ error: 'Pytanie nie istnieje' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/import', hostGuard, (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Nieprawidłowe dane', details: parsed.error.flatten() });
      return;
    }
    let imported = 0;
    const errors: string[] = [];
    for (const q of parsed.data.questions) {
      try {
        createQuestion(q as QuestionInput);
        imported += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Nieznany błąd');
      }
    }
    res.json({ imported, errors });
  });

  return router;
}
