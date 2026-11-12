# Porównanie: nasze opracowanie (om5-wifi5g) vs om-c-firmware `om5-1.2` `wifi-5ghz` (dbv0.4.0)

Data: 2026-11-12. Semantyka patchy om-c odczytana naszym `tools/mn103dis.py` (old/new bajty z `profiles.json`;
deasemblacja od granicy patcha — granice są wyrównane do instrukcji). Oznaczenie: [D-omc] = odczyt z tabel om-c,
[D-dis] = nasza deasemblacja, [X] = zweryfikowane bajtowo u nas.

## 1. Semantyka patchy om-c (E144)

**Site B (clamp), @`0x140844e`, 6 B** [X old-bytes match]:
- OLD: `mov d0,d3; mov d3,d1; extbu d1; cmp 13,d1; ble +0x31` — przepisz kanał, clamp >13 → ścieżka „illegal".
- NEW: `mov 36,d0; mov d0,d3; mov d3,d1; extbu d1; bra +0x31` — **wymuś 36 w d0/d3 i bezwarunkowy skok** pod ten
  sam cel, co `ble` (ominięcie logu i zerowania). [D-dis]

**Site A (ścieżka log/zero), @`0x1408410`, 12 B** [X old-bytes match]:
- OLD: `mov 0x615315fc,a0` (string logu) + `call` loggera — obsługa „ch illegal range (0-13)".
- NEW: `mov (0xa272c208),d1` (odczyt **mode z OLNET_PRM**); `cmp 8,d1; bge`; `cmp 2,d1; bne`; `clr d1`;
  `mov 36,d3` — **mini-dispatcher zależny od trybu**: kanał 36 wpisywany warunkowo wg mode (AP). [D-dis;
  odczyt liniowy od granicy patcha — semantyka warunków NOT_PROVEN co do dokładnych celów gałęzi]

**Site C (rootfs, block 2):** przepisanie rekordów squashfs/`isc_olnet` — wg `implementation:
native-ap36-country-and-startup-r2` obejmuje country_code i ścieżkę startową. Poza zakresem naszej analizy. [D-omc]

## 2. Podobieństwa (niezależna zbieżność wniosków)

| Aspekt | Wspólny wniosek |
|---|---|
| Diagnoza | Jedyny bloker 5 GHz = clamp RTOS; ścieżka dual-band A53 (`hw_mode=a`, `ieee80211ac=1`) stockowa |
| Lokalizacja | Te same 2 site'y RTOS, te same offsety (0x1408410/12 B, 0x140844e/6 B) — bajt-w-bajt |
| Mechanizm | Wymuszenie kanału 36 → stockowy `band = (ch ≥ 35)` ustawia band=1 automatycznie |
| Radio | CYW43455 dual-band z fw/kalibracją 5 GHz (oni: metadata; my: stringi `cyw43455_*` w rootfs) |
| Rootfs | Zmiana `isc_olnet` konieczna (oni: patchują; my: wskazane jako komponent zmiany) |
| Dowolny kanał >13 | Stock obsługuje wartości >13 w dalszym ciągu (dowód: `wifi_mngr_set_apl_prm_fact` pisze kanał+band bez clampu) |
| Status HW | Oboje: brak weryfikacji na urządzeniu (`hardware_verified:false` ≙ nasze NOT_PROVEN) |

## 3. Różnice

| Aspekt | om-c (db firmware) | My (om5-wifi5g) |
|---|---|---|
| Cel | dystrybuowalny patch-tool (GUI, przed-byte checks, przeliczenie sum32, zapis `DCOLYMP/E1xx9999.BIN`) | opracowanie badawcze offline; zero artefaktów instalacyjnych |
| Site A | patch **zależny od trybu** (odczyt mode z OLNET_PRM, dispatch) — dopracowany | nasz projekt (README §4) = prostsze bezwarunkowe wymuszenie 36; dispatch trybu to ich przewaga |
| Site B | przepisanie łańcucha rejestrów + `bra` (równoważne naszemu „omiń cmp") | zgodna koncepcja |
| Weryfikacja | `expected_sha256` bloków po patchu; fizycznie NIE zweryfikowane | seal 20/20, reproduce.py, niezależny spot-check + zewnętrzne potwierdzenie ich tabeli vs nasz obraz |
| Metoda dostępu | własne tablice symboli (engine-baseline.json) zbudowane raz (E143) i przenoszone | od zera na E144: string anchors + deasemblacja + analog E143 jako roadmapa |
| Zakres | 23 profile korpusów, licencja brak, binaria release | 1 korpus, pełna provenance, licencje czyste (fakty/adresy tylko) |

## 4. Dobre ścieżki rev-eng (wzorce do powtarzania)

1. **Analog między modelami jako roadmapa:** study E143 (upstream om-emu) dał hipotezy adresów; na E144
   potwierdzone stringiem i deasemblacją. Koszt odnalezienia funkcji spadł z godzin do minut.
2. **String anchors:** „ch illegal range (0-13)", `C:\WFCL0%03d.BIN` — unikalne, mało ruchliwe między buildami
   (site A ma ten sam string-ptr wzorzec E143↔E144).
3. **Stałe jako kotwice:** id parametru 60577 (PRM_WIFI_CHANNEL) + 625/497 — natychmiastowa identyfikacja gettera
   `0x5003ea6d` i wszystkich wywołań.
4. **Ścieżka fabryczna jako dowód istnienia:** `wifi_mngr_set_apl_prm_fact` pisze kanał+band BEZ clampu → wartości
   >13 i band=1 są legalne dla konsumentów downstream; clamp to polityka UI/regulatory, nie ograniczenie
   infrastruktury. Najsilniejszy semantyczny argument obu stron.
5. **Before-bytes fail-closed:** om-c sprawdza old-bytes przed patchem; my — old-bytes w evidence przed wnioskowaniem.
   Ta sama dyscyplina, oba kierunki.
6. **Struktura danych przez dump funkcji:** OLNET_PRM (0xa272c208) zmapowany przez zapisy pól (mode+0, country+0x1d,
   channel+0xcc, band+0xd1) — cheaper niż odwracanie całej struktury.
7. **Zewnętrzny artefakt jako oracula:** profiles.json om-c (source_sha256 == nasz obraz) = darmowy, niezależny
   wektor potwierdzenia hipotez. Warto zawsze szukać narzędzi trzecich na tym samym binarnym wejściu.
8. **Anti-pattern (przestroga z ich metadanych):** `hardware_verified:false` po 3 iteracjach implementacji
   (r2/r3 w assets) — nawet z pełnym kontrolą statyczną efekt runtime pozostaje odrębnym poziomem dowodu
   (zgodne z naszym L0–L3 w spec portu).
