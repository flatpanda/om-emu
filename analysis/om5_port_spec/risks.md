# risks.md — Rozszerzona macierz ryzyk portu E148→E144

**Status:** OFFLINE / RESEARCH. Uzupełnia `proposal.md` (sekcja 5 i 7). Każde ryzyko ma: podstawę
dowodową, dotkliwość, wykrywalność (jak wcześnie zauważymy), mitygację, ryzyko rezydualne i
workstream-właściciela. Skala dotkliwości: **K**rytyczna (nieodwracalne/brick/uszkodzenie sprzętu),
**W**ysoka (funkcja/generacja nie działa albo koszt skokowo rośnie), **Ś**rednia (opóźnienie/
ograniczenie zakresu), **N**iska (dokumentacja/estetyka). P — planistyczne [I], nie pomiary.

Metoda odczytu: ryzyka K-dotyczące **ścieżki flash/NVRAM** nie dotyczą strategii B/B+ w ogóle
(artefakty offline) — dotyczą tego, „co gdyby artefakt trafił na korpus", i dlatego mają bramki
WS6, nie mitygacje techniczne w buildzie. Ryzyka W-dotyczące analizy dotyczą bezpośrednio planu.

## Tabla zbiorcza (P = planistyczne [I])

| ID | Ryzyko (skrót) | Dotkliwość | P (przed mitygacją) | Wykrywalność | Bramka |
|---|---|---|---|---|---|
| R1 | NVRAM drift → IBIS mechanika | **K** | — | proceduralnie + emulator assert | G-NVRAM |
| R2 | Destructive MDN (0x12/0x36/0x26) | **K** | — | graf wywołań + blacklist assert | WS6-3 |
| R3 | Block 0 brick bez SPI | **K** | — | golden trace diff | G-HW |
| R4 | Updater E144 UNRESOLVED / Model ID gate | **K**(A) / N(B/B+) | — | WS0-3 statyczna | R-UPD-1 |
| R5 | ISA decode błędne | W | 5 % | WS0-1 kotwice | G-ISA |
| R6 | Sensor/ISP niewidoczny — ukryta zależność | W | 20–40 % (F2/F6) | warunki wejścia WS4 | G-LUT/G-CLASS-III |
| R7 | Radio chip E144 nieznany | W (F5) | — | WS0-5 rozpakowanie 0x0106 | G-CLASS-III |
| R8 | PMIC/USB-PD niewidoczne | W (F9 real) | — | WS0-10 skan | G-CLASS-III |
| R9 | Offsety cross-block przerwane | W(A)/Ś(B+) | — | builder byte-diff | G-PKG |
| R10 | app_check_mode bound błędny | W | 10–20 % bez R-CNT-1 | scan + emulator log | R-CNT-1 |
| R11 | Settings store niezlokalizowany | W(B+) | 40 % | sam gap = WS0-4 | G-DESCRIPTORS |
| R12 | Capacity/semantyka sidów | Ś | 15 % | parser + tabela mapowa | R-SID-1 |
| R13 | Regulacje WiFi/region | Ś | — | statyczna ścieżka kanałów | WS6 |
| R14 | Czynnik ludzki (artefakt na korpus) | **K** | — | niedetectowalne technicznie | G-HW + nazewnictwo |
| R15 | Estymacje/scope creep | Ś | — | exit criteria per WS | stop-loss 50 % |

---

## R1. Naiwny cross-flash / transplant bez remapu NVRAM → uszkodzenie mechaniczne IBIS

- **Baza:** [PRIOR] drift offsetów NVRAM gyro/IBIS: `gyro_ofs_y` 0x10→0x28, `gyro_ofs_p` 0x14→0x08,
  `int1_yaw` 0x24→0x20, `int1_pitch` 0x2c→0x30 (byte-verified w repo priors; ślad do odzyskania,
  WS0-8). Zawartość kalibracyjna korpusu E144 jest **niezmienna** — zmienia się kod czytający.
- **Dotkliwie:** **K** (cewki IBIS mogą dostać rozkazy wyliczone z przesuniętych/dziwnych wartości —
  „coil slam"; uszkodzenie mechanizmu).
- **Wykrywalność:** wejście do ścieżki F3/A bez WS2 = wykrywalne proceduralnie (checklist gate);
  technicznie w emulatorze: porównanie wartości odczytów NVRAM E144-layout przez kod E148 vs remap —
  wartości wychodzą poza sane ranges (jednostki gyro) → assert.
- **Mitygacja:** R-NVRAM-1 (remap tylko w kodzie); WS2 tabela per-pole z dowodem; F3 pełny blokowany
  do WS2; builder fail-closed przy braku remapu dla modułów z listy NVRAM-touch.
- **Rezydualne:** Ś — dopóki inwentaryzacja WS2 nie jest kompletna („?"/fail-closed dla nierozpoznanych
  pól), pełnej pewności brak; pozostaje reguła „moduł bez pełnej tabeli = nie portujemy".

## R2. Destructive MDN/NVRAM paths (RESET_CAM_CALIBDATA 0x12, DEFAULT_CALIB_DATA 0x36, ONENAND_STLFORMAT 0x26, EEPROM clear)

- **Baza:** [PRIOR] 74 komendy MDN; bad magic/sum nadpisuje kalibrację fabryczną. Nieodwracalne.
- **Dotkliwie:** **K** (utrata kalibracji fabrycznej = korpus z błędnym IBIS/AF/AE bez ratunku).
- **Wykrywalność:** statycznie — graf wywołań od sterowników MDN; proceduralnie — WS6-3 blacklist
  jako asercje builder/skaner; emulator — snapshot ścieżek przed/po (żadna generowana ścieżka nie
  może dotrzeć do MDN dispatcher).
- **Mitygacja:** blacklist fail-closed; zakaz eksperymentów w tych ścieżkach (sekcja 7.1 pkt 4);
  żadnych „testów na żywo" komend MDN — nigdy, w tym „na innym korpusie".
- **Rezydualne:** N dla B/B+ (ścieżki offline), K dla A — dlatego A wymaga formalnej decyzji safety
  i SPI rescue zanim cokolwiek poza emulator.

## R3. Block 0 = recovery + boot (brick bez SPI programatora)

- **Baza:** [PRIOR] recovery mode (OK+Power, task 95) mieszka w Block 0; [REPO: oly-fw-analysis r.15 —
  SD updater task 95 na E143, wzór rodzinny]. Uszkodzenie Block 0 = brak rozruchu i brak recovery.
- **Dotkliwie:** **K** dla każdej strategii, która dotyka ścieżki flash na korpusie (A; B/B+ nie —
  ale zagrożenie „wgranie artefaktu przez kogokolwiek" zawsze istnieje proceduralnie).
- **Wykrywalność:** w emulatorze pełny boot-path diff (WS1 golden traces) — jakakolwiek zmiana
  segmentów bootowych jest widoczna w pierwszych sekundach trace; proceduralnie — gate WS6-2.
- **Mitygacja:** strategia B/B+ z definicji nie zmienia segmentów boot (manifest zakresów pokrywa
  100 % zmian — R-PKG-1); A wymaga SPI programmer + formalnej bramki; naming RESEARCH_SKELETON_ONLY.
- **Rezydualne:** N offline; K proceduralne (czynnik ludzki) — stąd twarde etykiety i brak ścieżki
  importu.

## R4. Updater acceptance E144 UNRESOLVED; model-ID gate

- **Baza:** [INV §5] reguły walidacji updatera E144 nieprzeczytane; z E143: first-five-words 0x3202,
  litery bloków 0x3210..0x3213, stale checksum 0x3211; [PRIOR] PC updater odmawia niezgodnego Model
  ID; in-camera flasher porównuje Model ID kontenera z EEPROM/OTP (repack „bypassable", STATIC_CFG).
- **Dotkliwie:** **K** dla A (obraz odrzucony albo — gorzej — zaakceptowany częściowo), N dla B/B+.
- **Wykrywalność:** statyczna (WS0-3 odczyt walidacji); testy pre-checków 0x3202-family jako sanity
  (bez twierdzenia o akceptacji).
- **Mitygacja:** R-UPD-1 (artefakty nie są przeznaczone dla updatera; Model ID 1440 zawsze zgodny
  z korpusem, nigdy nie „spoofujemy" 1480→1440 poza badawczym A z bramką); WS0-3 katalog kodów.
- **Rezydualne:** Ś — dopóki WS0-3 nieodczytany, nie wiemy jak updater E144 zachowa się na obrazie A.

## R5. Błędne założenie ISA (mn10300 vs ARM Thumb-2) — unieważnienie mapy par i patchy

- **Baza:** [PRIOR] konflikt (b); [REPO: docs/mn10300-isa-spec.md — implementowany ISA;
  om-c §7.3 — 0x0106 = 32-bit ARM; Thumb-2 = kontrolery obiektywów, inne produkty].
- **Dotkliwie:** **W** (jeśli dekodowanie główne błędne, mapa 9.5M par i każdy patch są bezwartościowe;
  wykonalność portu wątpi). Oceniamy jako mało prawdopodobne (całe narzędzia repo na MN10300, modelcheck
  przechodzi boot [REPO: findings 65–68]), ale nie zero.
- **Wykrywalność:** WS0-1 cross-check na kotwicach kinship (guard 0x819/0x819 212/224 [INV §4]):
  dekodowanie MN10300 musi dawać spójne prologi/call-shapes w obu buildach; każda „nieznana forma"
  fail-closed sygnalizuje problem wcześnie.
- **Mitygacja:** R-ISA-1 fail-closed; WS0-1 formalne potwierdzenie; separacja ISA per blok
  (main=MN10300, 0x0106=ARM — narzędzia nie mieszają).
- **Rezydualne:** N.

## R6. Sensor/ISP niewidoczny bajtowo — ukryta zależność funkcji „software'owych"

- **Baza:** [INV §2/§6.4] brak stringów sensora; [INV §1] 0x0106 różni się −3,145,728 B (NN models).
- **Dotkliwie:** **W** dla F2 (Live GND LUT/ISP), F6 (PDAF), dodatków (RAW 12/14-bit); Ś dla F1/F4/F8.
- **Wykrywalność:** warunki wejścia WS4 (parowanie kodu + lokalizacja tablic w main block); emulator —
  feature-probe pokaże ścieżki sięgające 0x0106.
- **Mitygacja:** zasada fail-closed (brak dowodu = klasa (iii)); F2/F6 mają jawne warunki wejścia
  (3.2, 3.6); port nie planuje ścieżek przechodzących przez różniące się fragmenty 0x0106 bez dowodu
  identyczności.
- **Rezydualne:** Ś — L3 (obraz/AF jakość) zawsze not_proven.

## R7. Radio chip E144 nieznany — BT standby i ewentualne ścieżki WiFi

- **Baza:** [INV §2/§6.1] E144 chip UNRESOLVED; E148 CYW43439/brcmfmac 5.15.58; [REPO: om-c §7.3]
  E147 = CYW43439 2.4 GHz only; konflikt 5 GHz (Q11).
- **Dotkliwie:** **W** dla F5 (BT standby — wymaga zasilania radia przy off), Ś dla F7 (airplane —
  off-state działa nawet bez radia), W dla dowolnych ambicji 5 GHz (nieplanowanych).
- **Wykrywalność:** WS0-5 rozpakowanie 0x0106 E144 — rozstrzygające; w emulatorze: ścieżki radio
  i tak nie dochodzą do sprzętu (brak MMIO radio w lab) — twierdzenia o radio zawsze L3.
- **Mitygacja:** F5 = (iii) warunkowa do WS0-5; port nie planuje firmware'u radio cross-body; F7
  tylko off-sequencing.
- **Rezydualne:** Ś (Q11 pozostaje badawczy).

## R8. PMIC/USB-PD niewidoczne — „Power Supply from USB"

- **Baza:** [INV §2] brak PMIC stringów w diff; [PRIOR] brak schematów; USB IP wspólny [INV §2].
- **Dotkliwie:** **W** dla F9-real (zasilanie), N dla F9-menu (struktura).
- **Wykrywalność:** WS0-10 skan driverów charger/PD; emulator nie testuje zasilania w ogóle (L3).
- **Mitygacja:** F9 = (iii) warunkowa; port wyłącznie struktury menu jako RESEARCH_SKELETON_ONLY;
  brak ścieżek zapisu do ładowania.
- **Rezydualne:** W (do WS0-10), potem zależnie od wyniku.

## R9. Różnice rozmiarów bloków przerywają offsety cross-blokowe

- **Baza:** [INV §1] resources −1,441,792; large-data −3,145,728; images +3,145,728; 0x010e rewritten
  115,500 B; main layout izomorficzny ale head −0x500.
- **Dotkliwie:** **W** dla A (wszystkie offsety cross-block do re-mapy), Ś dla B+ (re-encode spans),
  N dla B (per-moduł).
- **Wykrywalność:** deterministycznie — builder weryfikuje każdy odnośnik cross-block (R-PKG-1
  manifest); emulator krakszy wcześnie na złych wskaźnikach.
- **Mitygacja:** każdy transplant re-mapyzowany indywidualnie; zasada „zero założeń identity across
  blocks"; 0x010e decision (WS0-6) przed A.
- **Rezydualne:** Ś.

## R10. app_check_mode / rejestr trybów — błędny bound po dodaniu wierszy

- **Baza:** [INV §3] E144 bound 667 @0x8fe0da (rejestr @0xbab574); E148 count UNRESOLVED;
  [REPO: om-c §3.6] om-c podniósł 637→639 i zrelokował rejestr; add-row pipeline dotyka page record +
  row-order + 6 tabel per-mode + SettingController sloty.
- **Dotkliwie:** **W** (nowe wiersze mogą być blokowane przez checker albo checker czyta poza
  rejestrem — crash/maskowanie funkcji).
- **Wykrywalność:** po patchu: pełny scan_appcheck musi przejść (652→ostatni wiersz) i emulatorowy
  app_check_mode log (string `app_check_mode():mode=%d,check=%d,status=%d` [INV §4]) nie pokazuje
  blokad nowych modów.
- **Mitygacja:** R-CNT-1 (bound+relokacja obowiązkowe); testy na E144 (znany bound).
- **Rezydualne:** N.

## R11. Settings-descriptor store niezlokalizowany — memories 1909/1910 bez domu

- **Baza:** [INV §3/§6.3] tabela 20 B nieznaleziona na obu buildach (reguła biegów ≥200);
  [REPO: finding 65] memories 1909/1910 slot 8.
- **Dotkliwie:** **W** dla B+ (twarda blokada), N dla B wave 1.
- **Wykrywalność:** to jest sam gap — WS0-4; alternatywnie sklepu można szukać przez zapisy memories
  w emulatorze E148 (sesje menu findings 66–68).
- **Mitygacja:** B+ startuje dopiero po WS0-4; fallback: port wyłącznie per-feature na Menu_Viewer
  (B wave 1) — B+ nie jest krytyczną ścieżką portu.
- **Rezydualne:** Ś (jeśli store okaże się o kształcie zupełnie innym niż 20 B — koszt WS0-4 rośnie).

## R12. Przestrzeń zasobów/capacity — dopisanie sidów nie zmieści się albo złamie layout

- **Baza:** [INV §1/§3] E148 zmieścił +896 sidów w bloku o 1.44 MB mniejszym (implikuje zapas E144);
  tabela 38 wpisów, kształt StringTable [REPO: emu/src/lab/resources.mjs]; per-rekord slot base
  wyliczany z tagu (0xA502B680 nie obowiązuje na tych korpusach — INV §3).
- **Dotkliwie:** **Ś** (resource block rebuild to procedura; błąd = menu bez tekstów/crash GUI).
- **Wykrywalność:** parser waliduje strukturę po dopisaniu (header {first,end}, pointer array count =
  sid count); emulator ładuje tablice w sesji menu. **Sids nie są stabilne między buildami** (sid 3991:
  „Webcam" w E144 vs „Saves to both cards…" w E148 [INV: res_strings_E1xx_enu.tsv]) — transplant z
  1:1 stałymi sidów objawia się natychmiast złymi tekstami w emulatorze i w tabeli porównawczej.
- **Mitygacja:** narzędzie append-sid waliduje każdą z 18 tablic osobno; mapa „sid E148 → tekst →
  sid E144/nowy sid" obowiązkowa dla każdej stałej transplantowanego kodu (R-SID-1, proposal §4.4);
  sum32/repack po całym dopisaniu (R-PKG-1); test ładowania wszystkich 18 języków.
- **Rezydualne:** N.

## R13. Regulacje/lokalizacja WiFi i region codes

- **Baza:** [REPO: om-c §3.4] country codes 0..10 → XC/XD, JP/XB, XE/XF; AP clamp kanałów 0..13;
  „dual-band path is stock" ale z RTOS clampem.
- **Dotkliwie:** **Ś** (prawne/regulaminowe ryzyko 5 GHz poza uzgodnionymi regionami; port nie planuje
  5 GHz).
- **Wykrywalność:** statyczna (ścieżki kanałów w kodzie); proceduralnie — WS6 przegląd.
- **Mitygacja:** Z7: port nie dotyka ścieżek kanałów/band; F7/F5 tylko off-state; 5 GHz poza zakresem
  (S8 pozostaje okazją badawczą wyłącznie offline).
- **Rezydualne:** N.

## R14. Czynnik ludzki — artefakt badawczy trafi na korpus

- **Baza:** wszystkie K-ryzyka wyżej; [PRIOR] istnieją skuteczne ścieżki instalacji (PC updater,
  in-camera flasher).
- **Dotkliwie:** **K** (R1–R4 realizują się naraz).
- **Wykrywalność:** proceduralnie — nie da się wykryć technicznie z poziomu pliku; stąd twarde
  oznaczenia.
- **Mitygacja:** naming `*.RESEARCH_SKELETON_ONLY.BIN` + wnętrze kontenera + sidecar sha256 + brak
  ścieżki importu + dokumentacja „co się stanie" (WS6-4); żadnych instrukcji instalacji w pakiecie.
- **Rezydualne:** **K — nieredukowalne do zera środkiem technicznym**; jedyną pełną mitygacją jest
  to, że artefakty te nigdy nie są dystrybuowane jako firmware.

## R15. Ryzyka estymacyjne (koszt/tokien) i zakresowe (scope creep)

- **Baza:** szacunki 4.1.4/4.2.4/4.3.3 są [I]; priors dają widełki (8–14 h selective, 50–80 h A);
  katalog zawiera funkcje-warunkowe zależne od WS0.
- **Dotkliwie:** **Ś** (wydłużenie), N dla poprawności.
- **Wykrywalność:** per workstream exit criteria (sekcja 6) — przekroczenie wytyka się na gate,
  nie na końcu.
- **Mitygacja:** kolejność 4.2.3 od najtańszych; stop-loss per funkcja (max +50 % budżetu → park albo
  rescoping); verified PARTIAL jest akceptowalnym wynikiem (disciplina robocza).
- **Rezydualne:** N.

---

## Rejestr minimalnych bramek (podsumowanie operacyjne)

| Bramka | Co blokuje | Warunek przejścia |
|---|---|---|
| G-ISA (WS0-1) | wszystkie patche | ISA decode potwierdzony na kotwicach |
| G-NVRAM (WS2) | F3 pełny, A | tabela remapu per-pole z dowodem |
| G-DESCRIPTORS (WS0-4) | B+, memories 1909/1910 | lokalizacja sklepu ustawień E144 |
| G-LUT (WS4-F2) | F2 | dowód LUT/main-block + parowanie |
| G-CLASS-III (sekcja 3) | F5/F6/F9/F10 | formalny dowód parzystości podłoża (domyślnie: brak przejścia) |
| G-PKG (R-PKG-1) | każdy artefakt | manifest 100 % zakresów + sum32 + determinizm |
| G-HW (WS6-2) | **wszystko sprzętowe** | osobna formalna decyzja safety — obecnie: ODMOWA |

**Zasada końcowa:** ryzyka R1–R4 i R14 są nierozłączne z jakąkolwiek myślą o sprzęcie; dopóki nie
istnieje formalna decyzja safety (G-HW), jedyną dopuszczalną formą realizacji tej specyfikacji są
artefakty offline w `analysis/`, oznaczone `RESEARCH_SKELETON_ONLY`, nigdy nie dystrybuowane jako
firmware.
