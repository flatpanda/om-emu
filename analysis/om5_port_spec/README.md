# om5_port_spec — specyfikacja portu OM-5 II (E148 v1.1) → OM-5 (E144 v1.2)

**Status:** OFFLINE / RESEARCH. Pakiet dokumentacyjny: żadnych artefaktów binarnych, żadnych
operacji na sprzęcie. Wszystkie twierdzenia o bajtach mają cytowania do
`analysis/om5_port_inventory/evidence/` ([INV]), narzędzi/dokumentów repo ([REPO]) albo raportu
priors ([PRIOR] — ślad do odzyskania, patrz proposal.md §9).

## Pliki

| Plik | Zawartość |
|---|---|
| `proposal.md` | pełna specyfikacja portu: cel/zakres, baza dowodowa (§2), katalog funkcji F1–F11 z klasami (§3), strategie A/B/B+ (§4), narzędzia T1–T4 (§4.5), szanse/zagrożenia (§5), workstreamy WS0–WS6 (§6), bezpieczeństwo (§7), otwarte pytania Q1–Q15 (§8), traceability (§9), DoD (§10) |
| `risks.md` | rozszerzona macierz ryzyk R1–R15: dotkliwość, wykrywalność, mitygacje, rezydualne + rejestr bramek G-* |

## Jak czytać

1. Najpierw `proposal.md` §0.1 (tagi) i §1 (zakres).
2. Decyzje kluczowe: strategia B (wave 1) → B+ (wave 2); A nienarekomendowana (§4.1.4);
   F5/F6/F9 warunkowe, F10 odrzucona (§3); zasady R-SID-1/R-CNT-1/R-NVRAM-1/R-PKG-1/R-UPD-1/R-ISA-1 (§4.4).
3. Wykonanie zaczyna się od WS0+WS1 (§6); żaden krok nie dotyka sprzętu (§7).

## Wejścia

- `analysis/om5_port_inventory/` (commit 19c3465): byte-grounded diff E144↔E148, regenerowalny
  `reproduce.py`; piny SHA-256 obu obrazów i evidence w `evidence/evidence.sha256`.
- Raport priors (agent read-only nad `D:\AI\re 100-400`) — przekazany w handoffie bez ścieżek
  artefaktów; wszystkie [PRIOR] wymagają odzyskania śladu zanim staną się podstawą patcha.
- `D:\AI\om-emu-port52to51`: `emu/` (modelcheck/nav/port.mjs/models.mjs/facts.mjs/lab parsers),
  `docs/` (mn10300-isa-spec, model-survey findings 65–68, firmware-container), `analysis/`
  (om-c-firmware §3.4/§3.6/§7.3, oly-fw-analysis r.15–r.17, nd128 precedens repack).

## Review & fixes

**Niezależny review 2026-11-12** (recenzent poza zespołem autorskim; baza: commit 2f1f675):
werdykt **SHIP_WITH_NOTES**; recenzent zweryfikował **>40 twierdzeń bajtowych** bez blokerów.
Wszystkie 9 uwag zastosowanych (minimal-diff):

1. **MAJOR:** tryb **block-resize** dodany do T4 (§4.5) i WS5; sprzeczność WS0-7 usunięta —
   inwentaryzacja wolnego miejsca gate'uje też pakowanie B (przy ~896 × 18 języków ≈ +1.3–1.6 MB
   bloku 0x0101 ponad ciągły zapas; kotwica: rekord enu 231,424 → 315,904 B).
2. Offset instrukcji `mov 0x60bcc594,d0` = **0x8fe0c8** (literał @0x8fe0ca), nie 0x8fe0d3
   (proposal §2.5 + inwentarz §3); wniosek (bound 667, rejestr @0xbab574, cmp @0x8fe0da) bez zmian.
3. „21 stringów SDRAM" → **20** (20/20, minlen=6, `ascii_strings_E1xx.tsv`); poprawka też w
   inwentarzu §2.
4. Cytowanie `scan_descriptors_E1xx.tsv` (proposal §2.5) poprawione — pliki są puste (0 B), liczby
   461/440 sesyjne, niezależnie zweryfikowane w review; przypis o regionach 1,243 (kanoniczne,
   zakomitowane CSV) vs 1,269 (re-merge recenzenta) dodany jako footnote §2.2.
5. „+17 wierszy enu /Bluetooth/" doprecyzowane: **+17 nowych tekstów (text-keyed); +11 nowych
   sidów** (4019/4020/4225/4226/4322/4323/4324/4429/4435/4547/4580) — proposal §2.6/§3.5 + inwentarz §2.
6. §3.5: odnotowana częściowa obecność UI w bazie E144 (sid 3356 „Power-off Standby" / 3357);
   klasyfikacja (iii) F5 bez zmian.
7. Sumy kosztów wave 1/B+ (§6.1) zsynchronizowane z zakresami komponentów (47–86 h / 0.88–1.85 M;
   67–126 h / 1.18–2.55 M); Q14 ma właściciela (WS0).
8. T2: reguła „sid bez tekstu enu w E148 (24 z 896) = pomijany + odnotowany w raporcie mappingu"
   (§4.2.5 krok 4 i §4.5 T2 fail-closed).
9. WS0-3/Q7: sub-pytanie o **jeden obraz vs banki A/B** i miejsce zapisu updatera (wpływa na
   strategię A i §7 rescue); evidence repo nie rozstrzyga.
