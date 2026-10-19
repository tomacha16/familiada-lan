# Familiada LAN

Gra typu Familiada działająca w sieci lokalnej. Serwer uruchamiasz na laptopie, telefony z Androidem służą jako buzzery, a TV z Androidem wyświetla tablicę wyników. Wszystko działa bez dostępu do internetu.

## Wymagania

- Node.js 20 lub nowszy
- Laptop i TV/telefony w tej samej sieci Wi-Fi
- Przeglądarka na TV (Chrome / WebView) i telefonach

## Szybki start

```bash
npm install
npm run dev
```

Po starcie w konsoli zobaczysz adresy i PIN hosta:

```
Serwer:      http://192.168.0.189:3000
TV:          http://192.168.0.189:3000/tv
Gracz:       http://192.168.0.189:3000/join
Host:        http://192.168.0.189:3000/host
PIN hosta:   123456
```

### Tryb produkcyjny

```bash
npm run build
npm start
```

## Wygląd tablicy (TV)

Tablica odwzorowuje styl polskiej edycji Familiady:

- **Ciemnogranatowe tło** z niebieską poświatą u góry
- **Złote panele odpowiedzi** — numer pozycji w złotym kwadracie, treść odpowiedzi, punkty po prawej
- **Ukryte odpowiedzi** — same znaki zapytania w ciemnym kolorze
- **Odsłonięcie** — złota ramka, poświata i animacja skalowania
- **Strike** — trzy czerwone X pojawiające się kolejno z animacją
- **Pasek pytania** u góry z etykietą „PYTANIE” i numerem rundy
- **Dolny pasek** — wyniki drużyn (niebieska/czerwona krawędź) i złoty **BANK** z pulą rundy
- **Face-off** — dwie karty głów rodzin z kolorowymi krawędziami drużyn
- **Finał** — lista 5 pytań z odkrywanymi odpowiedziami i sumą punktów

Wszystkie rozmiary używają jednostek `vmin`, więc tablica skaluje się poprawnie na 1080p i 4K.

## Jak grać

1. **Host** — otwórz `/host` na laptopie lub telefonie, podaj PIN z konsoli. Panel utworzy pokój i pokaże kod.
2. **TV** — otwórz `/tv` na telewizorze. Wyświetli się kod QR i kod pokoju.
3. **Gracze** — zeskanuj QR telefonem (albo wejdź na `/join` i wpisz kod), podaj imię i wybierz drużynę.
4. **Host** klika „Rozpocznij grę”.

### Tryb demo

Otwórz `/demo` (albo kliknij kartę „Tryb demo” na stronie głównej) — serwer utworzy pokój, w którym **boty rozgrywają całą grę automatycznie**. Idealne do sprawdzenia działania bez telefonów i TV. Boty mają zróżnicowaną „wiedzę”, więc pojawiają się błędy, strike'i i przejęcia.

### Regulamin (zgodny z oficjalnym)

**Gra główna — 3 rundy, do 300 punktów:**

1. **Face-off głów rodzin** — pierwszy gracz każdej drużyny (głowa rodziny) odpowiada na pytanie.
   - Jeśli pierwsza głowa trafi — jej drużyna przejmuje pytanie.
   - Jeśli się pomyli — szansę dostaje druga głowa. Trafienie **wyżej na tablicy** (mniejszy rank) przejmuje pytanie.
   - Jeśli obie się pomylą — pytanie zostaje przy pierwszej drużynie.
2. **Gra drużyny** — host wpisuje odpowiedzi, serwer podpowiada dopasowania (fuzzy match), host zatwierdza lub odrzuca.
3. **Trzy błędy** → pytanie przechodzi do drużyny przeciwnej (przejęcie).
4. **Oddanie pytania** — drużyna może zrezygnować i przekazać pulę przeciwnikom.
5. **Mnożniki punktów:** runda 1 = ×1, runda 2 = ×2, runda 3 = ×2 (po 4. pytaniu ×3).
6. **Limit czasu:** 3 sekundy na odpowiedź (timer w panelu hosta).
7. Gra kończy się, gdy drużyna osiągnie **300 punktów** lub po 3 rundach (wygrywa wyższy wynik).

**Finał — 2 graczy, 5 pytań, 200 punktów:**

1. Drużyna finałowa wystawia dwóch graczy.
2. Pierwszy gracz odpowiada na 5 pytań (limit 15 s na pytanie).
3. Drugi gracz odpowiada na te same pytania (limit 20 s), nie może powtórzyć odpowiedzi pierwszego.
4. Odpowiedzi są odkrywane, punkty sumowane. **200+ punktów = wygrana.**

## Konfiguracja

Zmienne środowiskowe:

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera |
| `HOST_PIN` | losowy 6-cyfrowy | PIN panelu hosta |
| `DB_PATH` | `data/familiada.db` | Ścieżka bazy SQLite |

Przykład (Windows cmd):

```cmd
set HOST_PIN=123456&& npm run dev
```

## Baza pytań

Baza zawiera **470 pytań** w **15 kategoriach** (jedzenie, geografia, życie codzienne, sport, zwierzęta, film i książka, pytania językowe, imiona, wierzenia, motoryzacja, garderoba, muzyka, kolory, historia i sztuka, inne). Średnio 5,4 odpowiedzi na pytanie.

- Seed: [`data/seed/questions.json`](data/seed/questions.json) — importowany przy pierwszym starcie, gdy baza jest pusta.
- Edycja: zakładka **Pytania** w panelu hosta (CRUD, import/eksport JSON).
- **Import z PDF:** `npm run import:pdf "ścieżka/do/pliku.pdf"` — konwertuje dokument z listą pytań (`• pytanie: odp1, odp2, ...`) do formatu seed. Skrypt: [`scripts/import-pdf.mjs`](scripts/import-pdf.mjs:1).

### Punktacja

Punkty są proporcjonalne do pozycji na tablicy: 1. miejsce = 100 pkt, ostatnie = 10 pkt (skala zaokrąglona do 5). Mnożniki rund (×1, ×2, ×3) nakładane są na te wartości.

### Format pytania

```json
{
  "text": "Wymień rzecz, którą zabierasz na plażę",
  "category": "wakacje",
  "roundType": "normal",
  "answers": [
    { "text": "ręcznik", "points": 32, "rank": 1, "aliases": ["recznik", "koc"] }
  ]
}
```

## Testy

```bash
npm test                    # testy jednostkowe (silnik, fuzzy match, demo)
node tests/e2e-socket.mjs   # test end-to-end gry (wymaga działającego serwera)
node tests/e2e-demo.mjs     # test end-to-end trybu demo
```

## Struktura projektu

```
src/
  server/
    index.ts          # bootstrap Express + Socket.IO
    config.ts         # port, PIN, ścieżki
    network.ts        # wykrywanie LAN IP
    db/               # SQLite: migracje, repozytoria, seed
    game/             # silnik gry, punktacja, buzz, finał, demo boty
    match/            # normalizacja PL + fuzzy match
    realtime/         # Socket.IO, autoryzacja, pokoje
    api/              # REST: pytania, historia gier
  shared/types.ts     # typy współdzielone serwer/klient
public/
  index.html          # wybór roli
  tv/                 # tablica na TV
  player/             # buzzer na telefonie
  host/               # panel prowadzącego
  shared/             # wspólne style i klient Socket.IO
data/seed/            # pytania startowe (470 pytań, 15 kategorii)
scripts/              # import pytań z PDF
tests/                # testy jednostkowe i E2E
plans/                # dokument architektury i lista zadań
```

## Dokumentacja

- [`plans/architecture.md`](plans/architecture.md) — architektura, model danych, kontrakty Socket.IO, maszyna stanów
- [`plans/todo.md`](plans/todo.md) — lista zadań implementacyjnych

## Uwagi

- Gra nie wymaga internetu — wszystkie zasoby są serwowane lokalnie.
- Telefony i TV powinny mieć włączony tryb pełnoekranowy (TV robi to po pierwszym kliknięciu).
- Wake Lock zapobiega usypianiu ekranu telefonu i TV.
