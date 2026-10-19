import { Router } from 'express';
import { getGameState, listGames } from '../db/games.repo.js';

export function gamesRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json({ games: listGames(Number.isFinite(limit) ? limit : 50) });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const state = getGameState(id);
    if (!state) {
      res.status(404).json({ error: 'Gra nie istnieje' });
      return;
    }
    res.json({ state });
  });

  return router;
}
