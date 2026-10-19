# Familiada LAN — Lista zadań implementacyjnych

Plan wykonania w kolejności logicznej. Każde zadanie ma jeden, jasny rezultat.

> **Status:** wszystkie etapy 1–11 zrealizowane. Dodano tryb demo oraz pełny
> regulamin oficjalny (3 rundy, 300 pkt, mnożniki, face-off głów rodzin,
> oddanie pytania, limit 3 s, finał 2 graczy).

## Etap 1 — Fundament projektu

- [ ] Zainicjalizować projekt Node.js + TypeScript (`package.json`, `tsconfig.json`, skrypty `dev`/`build`/`start`/`test`)
- [ ] Dodać zależności: `express`, `socket.io`, `better-sqlite3`, `qrcode`, `fastest-levenshtein`, `zod`; dev: `typescript`, `tsx`, `vitest`, `@types/*`
- [ ] Utworzyć strukturę katalogów zgodną z `plans/architecture.md` (`src/server`, `src/shared`, `public`, `data/seed`, `tests`)
- [ ] Zaimplementować `src/server/config.ts` (port, ścieżki, generowanie PIN hosta)
- [ ] Zaimplementować `src/server/network.ts` (wykrywanie LAN IP, budowa URL QR)
- [ ] Utworzyć `src/shared/types.ts` z typami stanu gry i eventów

## Etap 2 — Baza danych i pytania

- [ ] Zaimplementować `src/server/db/connection.ts` (otwarcie SQLite, WAL)
- [ ] Zaimplementować `src/server/db/migrations.ts` (tabele `questions`, `answers`, `games`, `game_events`)
- [ ] Utworzyć `data/seed/questions.json` z min. 15 pytaniami (5 rund + finał) i aliasami
- [ ] Zaimplementować seed loader (import JSON przy pierwszym starcie, idempotentny)
- [ ] Zaimplementować `questions.repo.ts` (CRUD, filtrowanie, import/export)
- [ ] Zaimplementować `games.repo.ts` (zapis gry, snapshot stanu, log eventów)

## Etap 3 — Silnik gry

- [ ] Zaimplementować `src/server/game/state.ts` (fabryka stanu początkowego, wersjonowanie)
- [ ] Zaimplementować `src/server/game/engine.ts` (maszyna stanów: lobby → rundy → finał → game over)
- [ ] Zaimplementować `src/server/game/scoring.ts` (pula rundy, strikes, steal, punkty finału)
- [ ] Zaimplementować `src/server/game/buzz.ts` (kolejka buzzów z timestampem serwera, rozstrzyganie)
- [ ] Zaimplementować `src/server/game/final.ts` (5 pytań finałowych, próg zwycięstwa)
- [ ] Dodać walidację akcji (poprawna faza, poprawna rola, idempotencja `actionId`)
- [ ] Napisać testy jednostkowe `tests/engine.test.ts` i `tests/scoring.test.ts`

## Etap 4 — Fuzzy match

- [ ] Zaimplementować `src/server/match/normalize.ts` (lowercase, diakrytyki, interpunkcja, prosty stemmer PL)
- [ ] Zaimplementować `src/server/match/fuzzy.ts` (Levenshtein + Jaccard, scoring, próg 0.75, top 3)
- [ ] Napisać testy `tests/fuzzy.test.ts` (przypadki z tabeli w architekturze)

## Etap 5 — Warstwa realtime

- [ ] Zaimplementować `src/server/realtime/auth.ts` (walidacja PIN hosta, token gracza, role)
- [ ] Zaimplementować `src/server/realtime/events.ts` (typy eventów klient↔serwer)
- [ ] Zaimplementować `src/server/realtime/socket.ts` (rejestracja handlerów, rooms, broadcast `state:sync`/`state:patch`)
- [ ] Zaimplementować reconnect (przywracanie sesji gracza po `playerId`)
- [ ] Zaimplementować snapshot stanu do SQLite po zmianie fazy

## Etap 6 — REST API

- [ ] Zaimplementować `src/server/api/questions.routes.ts` (CRUD, import/export, middleware `X-Host-Pin`)
- [ ] Zaimplementować `src/server/api/games.routes.ts` (historia gier)
- [ ] Zaimplementować `src/server/index.ts` (Express + Socket.IO + statyczne pliki + start serwera z logiem IP/PIN)

## Etap 7 — Klient TV

- [ ] Utworzyć `public/tv/index.html` + `tv.css` (layout tablicy, duże fonty, `vmin`)
- [ ] Zaimplementować `public/tv/tv.js` (połączenie Socket.IO, render stanu, QR w lobby)
- [ ] Dodać animacje odkrywania odpowiedzi, strikes, face-off, finał
- [ ] Dodać tryb pełnoekranowy i wake lock

## Etap 8 — Klient telefonu (buzzer)

- [ ] Utworzyć `public/player/index.html` + `player.css` (join, lobby, buzzer pełnoekranowy)
- [ ] Zaimplementować `public/player/player.js` (join, buzz, status, reconnect przez `localStorage`)
- [ ] Dodać haptic feedback (`navigator.vibrate`) i wake lock
- [ ] Dodać `manifest.json` i `sw.js` (PWA standalone, cache offline)

## Etap 9 — Panel hosta

- [ ] Utworzyć `public/host/index.html` + `host.css` (login PIN, sterowanie, edytor pytań)
- [ ] Zaimplementować `public/host/host.js` (akcje gry, kolejka buzzów, wpisywanie odpowiedzi z podpowiedziami)
- [ ] Zaimplementować edytor pytań (CRUD, import/export JSON, walidacja)
- [ ] Dodać podgląd stanu TV i skróty klawiszowe (Enter/Esc)
- [ ] Dodać widok historii gier

## Etap 10 — Integracja i testy end-to-end

- [ ] Utworzyć `public/index.html` (wybór roli: TV / gracz / host)
- [ ] Dodać `public/shared/socket-client.js` i `public/shared/styles.css`
- [ ] Przetestować pełny przepływ: lobby → 5 rund → finał → game over
- [ ] Przetestować reconnect gracza, hosta i TV
- [ ] Przetestować działanie bez internetu (wszystkie zasoby lokalne)
- [ ] Przetestować na TV 1080p i 4K oraz na telefonie w orientacji pionowej
- [ ] Napisać `README.md` z instrukcją uruchomienia (komenda, IP, PIN, skanowanie QR)

## Etap 11 — Dopracowanie

- [ ] Dodać obsługę błędów i komunikaty `game:error` w UI
- [ ] Dodać logowanie zdarzeń do `game_events` (audyt)
- [ ] Dodać konfigurację gry (nazwy drużyn, próg finału, liczba graczy)
- [ ] Dodać reset gry do lobby bez restartu serwera
- [ ] Przegląd kodu pod kątem walidacji po stronie serwera (każda akcja)
