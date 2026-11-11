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
