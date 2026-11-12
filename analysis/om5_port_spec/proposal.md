# proposal.md — Specyfikacja portu: OM-5 Mark II (E148 v1.1) → OM-5 (E144 v1.2)

**Status:** OFFLINE / RESEARCH — tylko analiza statyczna, emulacja i generowanie artefaktów badawczych.
**Data:** 2026-11-12. **Autor:** maliboo. **Branch:** `spec/om5ii-to-om5-port`.
**Pakiety wejściowe:** `analysis/om5_port_inventory/` (commit 19c3465, byte-grounded diff E144↔E148),
raport priors od równoległego agenta read-only nad `D:\AI\re 100-400` (oznaczany `[PRIOR]`).

> **Nic w tym dokumencie nie uchyla decyzji bezpieczeństwa ani nie upoważnia do jakiejkolwiek operacji
> na sprzęcie.** Każdy artefakt wygenerowany na podstawie tej specyfikacji jest
> `RESEARCH_SKELETON_ONLY` i musi pozostać poza jakąkolwiek ścieżką instalacji na urządzeniu.
> Szczegóły: sekcja 7 (Bezpieczeństwo).

## 0.1. Tagi dowodowe

Zgodnie z konwencją repo (patrz `docs/model-survey.md`, `analysis/om5_port_inventory/README.md`):

| Tag | Znaczenie |
|---|---|
| **X** | zmierzone/wykonane w tym repo (komenda w `reproduce.py` odpowiedniego pakietu) |
| **D** | odczytane z firmware'u pod wskazanym offsetem |
| **I** | inferencja (domniemanie, które trzeba zweryfikować) |
| **?** | nieznane |
| **[PRIOR]** | twierdzenie z raportu priors nad `D:\AI\re 100-400` — traktowane jako poziom D-wstępnie; **ścieżki artefaktów nie zostały przekazane w handoffie**, odzyskanie śladu = zadanie WS0 |
| **[INV]** | dowód z pakietu `analysis/om5_port_inventory/evidence/` (plik podany w nawiasie) |
| **[REPO]** | dowód z dokumentacji/narzędzi tego clone (ścieżka podana) |

Zasada: **każde twierdzenie o bajtach w tym dokumencie musi dać się odnaleźć w pliku evidence
inwentarza albo w cytowanej ścieżce repo.** Twierdzenia `[PRIOR]` bez odzyskanego śladu nie mogą
być podstawą patcha — mogą być jedynie hipotezą roboczą do weryfikacji (sekcja 9, Traceability).

---

# 1. Cel i zakres

## 1.1. Cel

Określić pełny, wykonalny offline plan przeniesienia **funkcji i menu/UX** z firmware'u korpusu
OM System OM-5 Mark II (`OLY_E_148_1100_0000_0000.BIN`, E148 v1.1) na korpus OM System OM-5
(`OLY_E_144_1200_0000_0000.BIN`, E144 v1.2), wraz z klasyfikacją wykonalności per funkcja,
strategiami portu, macierzą szans/zagrożeń, workstreamami i bramkami bezpieczeństwa.

Specyfikacja jest „do zrobienia na potem": definiuje co, jak, w jakiej kolejności i za jaką cenę
(roboczogodziny i tokeny), ale **niczego nie wykonuje na sprzęcie i niczego nie odblokowuje**.

## 1.2. Co portujemy (in-scope)

1. **Framework menu/UX:** nowa rodzina klas `Menu_ListMenu_*` / `Menu_ListMenu_Tab_*` z E148
   (E144 ma wyłącznie `Menu_Viewer`/`Custom_Menu_Viewer`) [INV §3; REPO: docs/model-survey.md finding 65].
2. **Funkcje user-visible z katalogu** (sekcja 3): Live GND Shooting, rozszerzenia Live ND
   (ND128 7EV, typ filtra, auto-obrót), High Res Shot Handheld (+ Handheld Assist), Focus Stacking+
   (przypisania przycisków), Bluetooth power-off standby (warunkowo), Airplane Mode, USB Webcam,
   Power Supply from USB (warunkowo), Fn Lever (odrzucona — sekcja 3) oraz wiersze menu dla nich.
3. **Tablice stringów:** dopisanie brakujących sidów do tablic językowych E144 (przestrzeń
   append-only 4013..4908, zero usunięć po stronie E148 [INV: res_enu_diff_removed.tsv — plik pusty,
   SHA-256 = e3b0c442…, czyli 0 bajtów; INV §3]).
4. **Infrastrukturę portu:** kontener, sum32, repack, manifesty patchy, emulator/walidacja.

## 1.3. Czego NIE portujemy (out-of-scope)

1. **Czegokolwiek wymagającego różnic sprzętowych, których nie da się wykazać bajtami:** dźwigienka
   Fn Lever (F10), sensor/ISP bez parzystości (F6, RAW 12/14-bit), zachowania PMIC/USB-PD bez mapy
   (F9), radio bez identyfikacji chipu E144 (F5) — patrz klasyfikacja w sekcji 3.
2. **Kalibracji fabrycznej:** żadnych zapisów NVRAM/EEPROM, żadnych transformacji danych
   kalibracyjnych korpusu. Adapter NVRAM (WS2) jest **wyłącznie po stronie kodu** (remap offsetów
   w kodzie, nigdy w danych korpusu).
3. **Bloków radiowych cross-body:** firmware CYW43439 z E148 nie jest planowany do instalacji na
   E144 przed identyfikacją chipu E144 (INV §2/§6.1; [PRIOR] konflikt (c) — sekcja 8).
4. **Path powłoki Linux (0x0106) jako całości:** blok large-data różni się o −3 145 728 B
   [INV §1]; port rootfs-a poza ścisłymi, uzasadnionymi fragmentami jest poza zakresem fazy 1.
5. **Operacji flash/update/cross-flash:** `OMDS-SFTY-001/002` (STOP) i natywny updater EXE
   (`OMDS-SFTY-003`, BLOCKED) pozostają nienaruszone. Ta specyfikacja produkuje wyłącznie
   artefakty offline.
6. **Aparatu jako produktu:** nie poprawiamy, nie zastępujemy oficjalnego firmware'u; cel jest
   badawczy (zrozumienie frameworka menu i granic przenoszenia funkcji).

## 1.4. Definicje sukcesu (poziomy dowodu)

| Poziom | Definicja | Przykład akceptacji |
|---|---|---|
| L0 | artefakt statyczny przeszł checki lokalne | kontener przechodzi sum32 + head/tail 28 B [INV §1] |
| L1 | ścieżka statyczna zweryfikowana | lista patch-range z before-hashami kompletna, brak dryfu poza zakresami |
| L2 | ścieżka w emulatorze | `modelcheck.mjs`/`nav.mjs` przechodzą na bazie E144 z przeszczepionym kodem |
| L3 | zachowanie na sprzęcie | **POZA ZAKRESEM** — wymaga osobnej formalnej decyzji safety (sekcja 7); zawsze `not_proven` w tym repo |

Wszystkie rezultaty tej specyfikacji celują w L0–L2. L3 jest jawnie `not_proven` do odwołania.

---

# 2. Baza dowodowa (stan zmierzony, skrót)

Pełny wywód: `analysis/om5_port_inventory/README.md` i `evidence/` (regenerowane przez
`py -3.11 analysis/om5_port_inventory/reproduce.py`; drugi przebieg dał byte-identyczny
`evidence.sha256`, X [INV §0]).

## 2.1. Wejścia (piny)

| Plik | Bajtów | SHA-256 |
|---|---|---|
| `fw/OLY_E_144_1200_0000_0000.BIN` (OM-5 v1.2) | 92,274,688 | `a0c91f3ac7caaf0925b2af609e711183cf3b5982b3333224bcef26c0c5943d11` |
| `fw/OLY_E_148_1100_0000_0000.BIN` (OM-5 II v1.1) | 90,832,896 | `9de5d77e1d290fa2ed4ebc7d75cee0ed490befbc89566722467d1d421d66d637` |

Kontener: typ `OE`, **model nibble pair `1440` vs `1480`**, BCD wersji **`0x1200` vs `0x1100`**
na bloku głównym [INV §1; REPO: docs/firmware-container.md — nibble pair big-endian, OM-5 `14 40`].
Nazwa modelu Exif (UTF-16LE) w obrazach rozwiniętych: `OM-5` @ block 0x68390 vs `OM-5MarkII`
@ 0x698f8 [INV §5].

## 2.2. Bloki

| # | flaga | rola | E144 len | E148 len | delta |
|---|---|---|---|---|---|
| 0 | 0x0100 | main code | 24,903,616 | 24,903,616 | 0 |
| 1 | 0x0101 | resources (18 języków) | 14,024,640 | 12,582,848 | **E148 −1,441,792** |
| 2 | 0x0106 | large data (Linux, NN) | 45,744,064 | 42,598,336 | E148 −3,145,728 |
| 3 | 0x010e | misc/secondary loader | 262,080 | 262,080 | 0 (ale 115,500 B różne) |
| 4 | 0x0102 | images (updater grafika) | 7,339,968 | 10,485,696 | **E148 +3,145,728** |

[INV §1]. Wszystkie 5 bloków każdego pliku przechodzi u32 sum32 i zgodność head[:28]==tail[:28]
[INV §1; REPO: analysis/oly-fw-analysis/README.md — reguła sprawdzana przez updatera E143].
Blok 0x010e: identyczny prefiks 995 B, pierwsza różnica 0x3e3, 115,500 z 262,080 bajtów różne
[INV §1; INV: misc_block_diff.csv].

**Layout bloku głównego izomorficzny (D):** tabela `BCS\0` 10×12 B `{dst, src, flag}` o
byte-identycznej treści @ 0x6fd8 (E144) / 0x74d8 (E148, +0x500); dwa odcinki `olycompress`
w **tych samych** offsetach (A: 0x825fe0→0x60847000, raw 0x477800; B: 0xc9d7e0→0x60cbe800,
raw 0x685000), różne tylko payload packed (E148 ~200 KB ciaśniejszy) [INV §1].
Obrazy rozwinięte po 24,903,616 B; równość bajtowa całości **22.05 %**
(5,491,417/24,903,616; 1,243 regiony różnic po scaleniu luk ≤64 B; nagłówek 0x00..0x825fe0:
21.94 %) [INV §1; INV: expanded_main_diff_regions.csv].¹ Base run-time **0x60021020** dla obu
(main code; `runtime = block offset + 0x60021020`) [INV §0; REPO: docs/model-survey.md finding 65].

> ¹ Niezależny review 2026-11-12 przy własnym re-merge luk ≤64 B otrzymał **1,269** regionów na tym
> samym zbiorze różnic (różnica parametryzacji scalania, nie danych). Kanoniczne pozostaje liczba
> **1,243** z zakomitowanego `expanded_main_diff_regions.csv`; rozbieżność odnotowana, nie
> rozstrzygana w tym pakiecie.

## 2.3. Pokrewieństwo kodu (dlaczego port jest w ogóle realny)

- Mapy cross-build repo: **9,503,564 instrukcji E148 paruje z E144** (41 konfliktów), z E143 tylko
  2,471,331 — warstwa sprzętowa E148 i większość aplikacji to build E144 [INV §4; REPO:
  docs/model-survey.md finding 65; REPO: emu/bin/port.mjs].
- Sondy bajtowe (okno 96 B przed / 128 B za pierwszą referencją kodu kotwicy) [INV §4;
  INV: kinship_samples.csv]:

| kotwica (log-string) | code ref E144/E148 | równych bajtów /224 |
|---|---|---|
| `[FLSH]Flash Access Guard Error!!!` | **0x819 / 0x819** | 212 |
| `OlyTaSS` | **0x30a15 / 0x30a15** | 211 |
| `USBIP_GUSB3PIPECTL0  :` | 0xcb91c4 / 0xcb8f18 | 164 |
| `ch illegal range (0-13):` | 0x1408457 / 0x140a55e | 184 |
| `- uITRON Error Code  -` | 0x15f24d2 / 0x15f296a | 156 |
| `app_check_mode():mode=%d,check=%d,status=%d` | 0x8fe04a / 0x8fdf29 | 17 |

  Niskopoziomowy kernel i flash-access-guard są **byte-stabilne na tych samych offsetach**;
  radio i checker `app_check_mode` są mocno przerobione (`app_check_mode_card_setup` z E144
  @0xbadb88 nie ma odpowiednika w E148) [INV §4].

## 2.4. Menu i zasoby (kluczowe dla strategii B/B+)

- E144: **zero** stringów `Menu_ListMenu_*` — framework `Menu_Viewer`/`Custom_Menu_Viewer`
  (@0x12271xx) [INV §3]. E148 dodaje rodzinę: `Menu_ListMenu_Group_Level_VM_Actuator::Initialize
  this->kind =%d` @0x11bcc8c, `Menu_ListMenu_Group_Level_Viewer not supprt 2ND_TYPE : %d`
  @0x11bfa24, `Menu_ListMenu_Tab_Menu_VM_Actuator::Initialize …` @0x11c3798,
  `Menu_ListMenu_Tab_Menu_Viewer not supprt 2ND_TYPE : %d` @0x11ca476; `Menu_Viewer` **nadal
  obecny** @0x11ded9f — oba frameworki współistnieją w E148 [INV §3].
- Otwarcie ListMenu w E148 czyta getter obiektu ustawień z **vtable slotu 8** (nie 12) dla
  pamięci tab/page **1909/1910** (0x50e77adb/0x50e77afb — idy E147) [REPO: docs/model-survey.md
  finding 65; `emu/src/fw/facts.mjs` menuMemory próbuje slotu 12 i 8].
- Tablice stringów: 38 wpisów indeksu = 18 języków + fonty/ikony, per język **4,013 (E144,
  sid 0..4012) vs 4,909 (E148, sid 0..4908)**; E148 **dopisuje** sids 4013..4908, **0 usunięć**,
  **621 tekstów zmienionych in-place**; per-text: 1,196 nowych / 436 znikło [INV §3;
  INV: res_lang_table.csv, res_enu_diff_added/removed/changed.*]. Parsowanie=repo `StringTable`
  [REPO: emu/src/lab/resources.mjs].
- **Uwaga portowa:** zmiany in-place obejmują też rekomendację tekstu pod istniejącym sidem — np.
  sid 3978 w E144 = „Wireless Shutter Setting", w E148 = „Assign power to Fn Lever as follows:
  …"; sid 3979 „Start Pairing" → „Assign power to Fn Lever …" [INV: res_enu_diff_changed.csv
  linie 1000–1007]. Na bazie E144 **nie wolno nadpisywać tekstów in-place** (złamałoby feature
  E144); kod transplantowany z E148 musi zostać przepięty na **nowo dopisane** sidy (reguła
  R-SID-1, sekcja 4.3).
- Block zasobów E144 jest **większy** o 1,441,792 B mimo mniejszej liczby stringów — E148
  zmieścił +896 sidów × 18 języków w bloku o 1.44 MB mniejszym, więc dopisanie ~900 sidów na
  bazie E144 ma materialny zapas miejsca [INV §1; I — część różnicy mogą stanowić nie-stringi].
  **Zastrzeżenie (review 2026-11-12):** szacowany wzrost z dopisania (~896 × 18 języków ≈
  **+1.3–1.6 MB**; kotwica per-rekord: enu 231,424 B → 315,904 B [INV: res_lang_table.csv]) jest
  **tego samego rzędu** co cała różnica 1.44 MB — zapas **nie jest gwarantowany**. Dlatego
  inwentaryzacja wolnego miejsca (WS0-7) gate'uje też pakowanie B: dopóki nie wykaże ciągłego
  zapasu, dopisanie sidów wymaga trybu block-resize T4/WS5 (patrz risks.md R12).

## 2.5. Rejestry trybów (app_check_mode i tabela równoległa)

- **E144 (D):** rejestr row-disable 12-bajtowych wierszy `{u16 mode, u16, u32 ptr, u8 n}`:
  **667 wierszy** @ block 0xbab574 (runtime 0x60bcc594); bound `cmp 667,d3` @ rozwinięte 0x8fe0da
  po `mov 0x60bcc594,d0` @0x8fe0c8 (literał stałej @0x8fe0ca); scan mostkowany przechodzi 652/667,
  650 unikalnych mode-id [INV §3; INV: scan_appcheck_E144.tsv; REPO: analysis/om-c-firmware/README.md
  §3.6 — E143 miała 637 wierszy @0x60e4bdcc i 172 callbacki @0x60e4ad9c].
- **E148 (D, częściowo):** równoległy region istnieje (ścisły bieg 357 wierszy @0xbab084, pierwszy
  mode 3356; kotwica mode 23 kotwiczy 336 kolejnych @0xbab4e0), ale **count-compare nie został
  zlokalizowany — liczba wierszy UNRESOLVED** [INV §3; INV: scan_appcheck_E148.tsv].
- Tabela równoległa: E144 @0x477b78 (461 wierszy mostkowanych) vs E148 @0x475110 (440; pierwsze
  mode `24,15205,3010,15258,1482,…` vs `24,15205,3008,15258,1446,…`); zbiory id różnią się
  ~190/side, ale oba scany są podatne na urwanie — surowe dane, **nie** materiał na patch
  [INV §3; poza zakomitowanym evidence — przebieg sesyjny, treść niezależnie zweryfikowana
  w review 2026-11-12; pliki `scan_descriptors_E1xx.tsv` w evidence są puste (0 bajtów)].
- Tabela deskryptorów ustawień (20-bajtowy wiersz, kształt `emu/refs/settings.mjs DESCRIPTORS`)
  **nie została znaleziona** na żadnym build (reguła biegów ≥200 wierszy) — UNRESOLVED [INV §3/§6.3].
- Implikacja portowa: dodanie wiersza menu do E144 (styl om-c) wymaga poprawy **bound** 667 przy
  relokacji/rozszerzeniu rejestru E144 [REPO: analysis/om-c-firmware/README.md §3.6 — om-c podniósł
  bound 637→639 i zrelokował rejestr]; dla E148 brak znanego boundu blokuje analogiczny zabieg po
  stronie E148 (nie jest nam potrzebny — portujemy na bazę E144).

## 2.6. Sprzętowo-istotne różnice widoczne w bajtach

| Domena | Stan | Dowód |
|---|---|---|
| USB IP | **ten sam** DWC3-class gadget IP (`USBIP_GUSB2PHYCFG0`, `USBIP_GUSB3PIPECTL0`), klastry 8 szablonów deskryptorów **bcdUSB 0x0300** @0x15bae53 (E144) / 0x15bf68f (E148), niemal identyczne bajty (164/224 w oknie) | [INV §2] |
| Wi-Fi | E148: `cyw43439-brcmfmac-v5.15.58-2023_1128`, `brcmfmac43439-sdio.clm_blob`, kernel 5.10.197 (0x0106). **E144: chip UNRESOLVED** (payload inaczej kompresowany: squashfs 4.0 @0x216cfe0, bytes_used 0x435929; E148: squashfs @0x1b6ffe0, bytes_used 0x8bc0de; buildroot path E144 `…S0101_20220714/PF20/src/buildroot`, `GLIBC_2.7`) | [INV §2/§6.1; REPO: analysis/om-c-firmware/README.md §7.3] |
| Bluetooth | 184 stringi „bluetooth" w main block obu; E148: **+17 nowych tekstów** /Bluetooth/ (text-keyed) [INV: res_enu_textnew_in_E148.tsv] na **+11 nowych sidach** (4019/4020/4225/4226/4322/4323/4324/4429/4435/4547/4580) [INV: res_enu_diff_added.tsv]; BLE 69→102 | [INV §2; INV: feature_census_enu.tsv] |
| Display | te same panele (TFT 720×480, EVF 1024×768), modelcheck przechodzi na TFT i EVF dla obu | [INV §2; REPO: emu/src/fw/models.mjs; docs/model-survey.md finding 65] |
| RAM | rodzina płyty `board: {family: 'E144'}` także dla E148; DRAM end 0xb0000000 (256 MiB wg `board.mjs`); MMIO ISC 0x8fe00000, VSC 0x9c000000, engine 0x9c100000; kensus literałów: scratch 0xa2xxxxxx 8,576/8,537, image-range 654,000/604,424; 20 stringów „SDRAM" (minlen=6) każda strona, 20/20 [INV: ascii_strings_E1xx.tsv]. **[PRIOR] twierdzi 1 GB RAM — KONFLIKT do rozstrzygnięcia (sekcja 8, Q9)** | [INV §2; INV: ram_literal_census.csv; REPO: emu/src/fw/board.mjs; docs/model-survey.md finding 65] |
| Sensor/ISP | **nic bajtowo-widocznego** (po 1 trafieniu „IMX", w danych niepowiązanych); różnice za sterownikiem ISC — ? | [INV §2/§6.4] |
| GPS | brak różnicy user-visible (9→9 wierszy enu; kod modułu TG: 341/352 stringów „GPS") | [INV §2; INV: feature_census_enu.tsv] |
| Grafika updaterra | E148 +3,145,728 B, własny indeks 126 wpisów (rekordy 0x2600 B w E144 vs 0x1a00 B w E148); brak JPEG/RIFF po magic-scan, po 1 magii PNG; customowa forma bitmapy | [INV §2] |
| Napędy/leverage | E148 nazywa **Fn Lever power assignment** („Assign power to Fn Lever as follows: Position 1/2 … Power Lever is disabled"); main-block „lever" 74→96 — patrz F10 | [INV §2] |

## 2.7. Co mówią narzędzia repo o obu korpusach (stan emulacji)

- `modelcheck.mjs` **przechodzi** dla E144 (TFT i EVF) i dla E148 (TFT i EVF; port chainowany
  **przez E144** — 98 z 117 override'ów E144 przejętych, 900 adresów przetłumaczonych, 49
  unmapped, 7 kolizji) [REPO: docs/model-survey.md tabela i finding 65; REPO: emu/out/port/E148/port.json].
- Menu w laboratorium: sesje play od findings 66–68; E148 ListMenu memories 1909/1910 czytane z
  slotu 8; `nav.mjs` na E144 zatrzymuje się na tabelach buforów GUI (rodzinny limit: 18 adresów
  menu lab unmapped, `0x62b3e364` — dane modułu tekstu) [REPO: docs/model-survey.md findings 65–68].

## 2.8. Czego inwentarz NIE mówi (bounded absence — lista jawna)

Reguła raportowania: „brak" = brak w granicach przeprowadzonych testów. Czego **nie testowano /
nie wiadomo** (każda pozycja blokuje odpowiednie twierdzenia):

1. **Rozpakowany 0x0106 E144 rekord po rekordzie** — testowano tylko magic-scan i wybrane stringi
   [INV §2]; dlatego twierdzenia o NN models / rootfs są sekcyjne, nie kompletne (Q8).
2. **Kształty tabeli ustawień inne niż 20-bajtowy bieg ≥200** — reguła skanu jednego kształtu
   [INV §3]; nie testowano kształtów 8/12/16/24-bajtowych ani list zamiast tablic (Q3).
3. **Teksty CJK/jpn/chn** — zdekodowane strukturą, nie porównane treściowo [INV §6.6] (Q6);
   tłumaczenia nowych funkcji mogą różnić się semantycznie między językami — R-SID-1 dotyczy
   wszystkich 18 tablic, nie tylko enu.
4. **Semantyka trybów (mode-id) nowszych wierszy** — scany rejestrów trybów są truncation-prone
   [INV §3] — nie wnioskujemy o disabled-state żadnej nowej funkcji bez pełnego scanu (Q5).
5. **Każde twierdzenie o zachowaniu sprzętowym** — poza granicami statycznych bajtów i emulatora;
   klasa (i) oznacza „nie ma znanego zależności sprzętowej w bajtach", nie „nie ma zależności".
6. **Kod aktualizatora E144** — nieczytany [INV §5] (Q7); nie twierdzimy nic o akceptacji obrazów.
7. **Wpływ poprawek in-place 621 tekstów** na działające funkcje E148 — nie testowano (poza
   zidentyfikowanymi 3978/3979); dla portu na E144 nie istotny (R-SID-1 zakazuje in-place).
8. **Zachowanie PMIC/ładowania, wejścia GPIO/ADC, rail'ów** — brak jakichkolwiek bajtów; klasy (iii)
   wynikają z braku dowodu, nie z dowodu braku (Z6, sekcja 3).

---

# 3. Katalog funkcji E148 do przeszczepienia

Klasyfikacja: **(i) czysto software'owa** — cała logika i dane w przenoszonym kodzie/danych obrazu;
**(ii) zależna od NVRAM-kalibracji** — kod przenośny, ale semantyka zależy od danych kalibracyjnych
korpusu, których layoutu różnice są udokumentowane/wnioskowane; **(iii) PRAWDOPODOBNIE SPRZĘTOWA** —
brak dowodu parzystości podłoża (urządzenie wejściowe, radio, sensor, PMIC); port odrzucony albo
warunkowy do momentu dowodu. Klasa nie jest wyrokiem — zmienia się dowodem (reguła: klasa (iii)
przechodzi do (i)/(ii) wyłącznie po bajtowym dowodzie parzystości, nigdy po wnioskowaniu z „podobnej
platformy").

Kluczowa metoda poprawy klasy: mapa parowania 9,503,564 instrukcji [INV §4] pozwala ustalić, czy kod
funkcji E148 ma **pâr na bazie E144** — jeśli cała funkcja (kod + dane + brak zależności od urządzeń
poza wspólnym MMIO) paruje z kodem obecnym w E144, argument „software-only" jest bajtowo wsparty.

## 3.1. F1 — Live ND Shooting: rozszerzenia (ND128 7EV, Filter Type, Filter Auto Rotate)

- **Wiersze E148 (dodane sidy):** 4037–4042 „Live ND Shooting : ND2(1EV)"…„ND64(6EV)" (nowe sidy,
  te same teksty co stare 3426–3430 w E144 — re-binding pod nowy framework), 4702 „Live ND Shooting
  : ND128(7EV)", 4750 „ND128(7EV)", 4703–4705 „Filter Type: Soft/Medium/Hard", 4719 „Filter Type",
  4720–4722 „Filter Auto Rotate" + opisy [INV: res_enu_diff_added.tsv; INV: res_strings_E144_enu.tsv
  sids 3426–3430, 3438]. Kensus: Live ND 7→14 enu wierszy [INV: feature_census_enu.tsv].
- **Baza w E144:** Live ND Shooting już działa (7 wierszy enu: 3426–3430 wartości ND2..ND32,
  3438 tytuł, 3437 opis trybu handheld) [INV: res_strings_E144_enu.tsv].
- **Klasa: (i) czysto software'owa.** Uzasadnienie: silnik live-kompozycji jest współdzielony
  (Live ND istnieje w E144), E148 dokłada wartość 7 EV i parametry typu filtra — typowo tablice
  wartości/parametryzacja ścieżki kompozytu; kod per-feature powinien parować mapą 9.5M [INV §4].
- **Warunek wejścia WS4-F1:** wykazać parowanie kodu handlerów wartości ND (znajd przez stringi
  4037/4702 + tablice wartości), potwierdzić, że **kody tabeli wartości ND** są tablicą
  {wartość→czas/ekspozycja} w main block, nie w 0x0106.
- **Ryzyko specyficzne:** niskie. ND128(7EV) wydłuża okienko kompozytu — ryzyko timeoutów/tasków
  schedulera przy bardzo długich naświetlaniach na słabszym chłodzeniu E144 (I; test emulatorowy
  ograniczony — L3 not_proven).

## 3.2. F2 — Live GND Shooting (gradated ND „live")

- **Wiersze E148:** 4706–4710 „Live GND : GND2(1EV)"…„GND32(5EV)", 4753–4757 (krótkie formy),
  4716 „Live GND Shooting", 4717 (opis „As when using the graduated…"), 4718 „GND Number", 4745
  (przełącznik on/off), 4739/4740 (przypisania przycisków), 4746 „Accessing to Card in progress",
  4719–4722 Filter Type/Auto Rotate współdzielone z F1 [INV: res_enu_diff_added.tsv].
  Kensus: GND **0→15** enu wierszy; main-block stringów „GND" 3→52 [INV: feature_census_enu.tsv,
  feature_census_ascii.tsv].
- **Baza w E144:** brak (0 wierszy) [INV: feature_census_enu.tsv].
- **Klasa: (i) czysto software'owa, z warunkiem potwierdzenia LUT/ISP.** Uzasadnienie: GND to
  przestrzennie gradientowa wariacja tej samej live-kompozycji co Live ND (F1) — kod aplikacyjny
  + współczynniki gradientu; oba korpusy dzielą ISC/VSC MMIO i silnik obrazowania (base 0x60021020,
  MMIO ISC 0x8fe00000 / VSC 0x9c000000) [INV §2; REPO: docs/model-survey.md finding 65].
- **Warunek wejścia WS4-F2:** (a) zlokalizować tablice współczynników GND (gradient kernels/LUT) —
  muszą być w main block lub 0x0106 jako dane statyczne; (b) wykazać parowanie tasku kompozytu GND
  z kodem kompozytu Live ND w E144; (c) sprawdzić, czy kod nie sięga po model/mikrokod w 0x0106
  poza wspólnymi obszarami (blok różni się o −3,145,728 B [INV §1]).
- **Ryzyko specyficzne:** średnie. Jeśli współczynniki gradientu są policzone w warstwie ISP/Linux
  (0x0106), port rośnie o element cross-block; wówczas klasa spada do (iii-warunkowa) do czasu
  dowodu. Bufory kompozytu: kensus literałów obrazu 654,000 vs 604,424 — E148 używa więcej literałów
  obrazu; brak dowodu o braku RAM (see Q9 konflikt RAM) [INV: ram_literal_census.csv].

## 3.3. F3 — High Res Shot Handheld (+ Handheld Assist, trójstan Off/Tripod/Handheld)

- **Wiersze E148:** 4125 „High Res Shot Handheld", 4126 „High Res Shot Off", 4127 „High Res Shot
  Tripod", 4219 „Handheld Assist", 4293/4294/4295 (opisy handheld/tripod), 4274 (przypisanie
  przycisku/diala), 4354 (opóźnienie startu), 4032 „High res shot error. Image composite failed."
  [INV: res_enu_diff_added.tsv]. Kensus: High Res 3→12, Handheld 3→7 [INV: feature_census_enu.tsv].
- **Baza w E144:** High Res Shot już istnieje w wariancie jedynym — bez rozróżnienia
  handheld/tripod (2438 „High Res Shot", 2440 opis z post-shutter delay, 3386 błąd kompozytu;
  3437 „Shoots in handheld mode…" należy do Live ND, nie High Res) [INV: res_strings_E144_enu.tsv
  sids 2438/2440/3386]; rozróżnienie wariantów jest dopiero w E148 (4125/4126/4127).
- **Klasa: (ii) zależna od NVRAM-kalibracji.** Uzasadnienie: handheld high-res komponuje 8 ekspozycji
  z estymacją ruchu opartą o dane żyroskopu/IBIS; wariant tripod działa na E144 (silnik kompozytu
  obecny), ale wariant handheld konsumuje strumienie gyro/IBIS skorygowane kalibracją fabryczną.
  **[PRIOR] (byte-verified w repo priors, ślad do odzyskania):** layout NVRAM gyro/IBIS dryfował
  między E144/E148 — `gyro_ofs_y` 0x10→0x28, `gyro_ofs_p` 0x14→0x08, `int1_yaw` 0x24→0x20,
  `int1_pitch` 0x2c→0x30. Kod E148 czytający NVRAM po offsetach E148 na NVRAM-ie E144 czyta
  przesunięte wartości → błędna estymacja ruchu, a w skrajnym wypadku błędne rozkazy do cewek IBIS
  (ryzyko mechanizmem, nie tylko błędnym obrazem) [PRIOR; patrz WS2 i risks.md R1].
- **Warunek wejścia WS4-F3:** kompletna tabela remapu offsetów NVRAM (WS2), test emulatorowy czytający
  syntetyczne NVRAM o layoucie E144 przez kod E148 z adapterem; parowanie kodu estymacji ruchu z mapą.
- **Ryzyko specyficzne:** wysokie przy naiwnym porcie (mechanika IBIS), średnie po WS2. Handheld
  Assist (4219) — wyświetlanie poziomu stabilizacji przy długich naświetleniach [INV: tekst 4454]
  — jest czysto prezentacyjne, (i), może być portowane niezależnie jako najmniejszy krok F3.

## 3.4. F4 — Focus Stacking+ (przypisania przycisków i przepływ)

- **Wiersze E148:** 4218 „Focus Stacking", 4236 „Press-and-hold button assigned to Focus Stacking
  pulls up its setting screen", 4273 „Press to switch Focus Stacking On/Off…", 4031 „Focus stacking
  error. Image composite failed." [INV: res_enu_diff_added.tsv]. Kensus: Focus Stacking 2→6
  [INV: feature_census_enu.tsv].
- **Baza w E144:** 3272 „Focus Stacking" + 2871 błąd kompozytu — funkcja bazowa istnieje
  [INV: res_strings_E144_enu.tsv].
- **Klasa: (i) czysto software'owa.** Uzasadnienie: dokładamy przepływ UI (przypisania przycisków,
  ekran ustawień) i sekwencję bracketingu ostrości; napęd ostrości idzie istniejącym protokołem AF
  (E144 ma pełny AF); kompozyt współdzielony z High Res tripod (działa w E144).
- **Warunek wejścia WS4-F4:** parowanie handlerów 4236/4273; weryfikacja, że liczba klatk stacku
  i zakresy drive'u ostrości są parametrami kodu, nie tabel kalibracji lens-side (lens-gates repo:
  patrz REPO: analysis/lens-gates/README.md — wzorzec bramek lensowych).
- **Ryzyko specyficzne:** niskie/średnie. Wymaga menu-row pipeline (WS3 albo B-wave add-row, sekcja 4.3).

## 3.5. F5 — Bluetooth power-off standby (import przy wyłączonym zasilaniu)

- **Wiersze E148:** 4322 „Activate Wi-Fi/Bluetooth Power-off Standby so images can be imported
  while power is off?", 4323/4324 (opisy stanów), 4019/4020 „Activates Bluetooth…", 4225/4226
  (enable/disable komunikacji), 4429, 4435 „Sets Bluetooth action", 4547, 4580 „Wi-Fi/Bluetooth",
  +17 nowych tekstów /Bluetooth/ (text-keyed) na +11 nowych sidach ogółem; BLE 69→102;
  „Reset all … and Bluetooth settings" [INV §2; INV: res_enu_diff_added.tsv;
  INV: res_enu_textnew_in_E148.tsv; INV: feature_census_enu.tsv]. Main-block: 184 stringi
  „bluetooth" w obu buildach [INV §2].
- **Baza w E144:** Bluetooth pairing/ustawienia istnieją (3347–3357) [INV: res_strings_E144_enu.tsv].
  **Uwaga:** baza E144 zawiera już sid **3356 „Power-off Standby"** i **3357** („@A08F@/Bluetooth
  connection cannot…") — częściowa obecność UI w E144; E148 dokłada re-binding ścieżki pod nowymi
  sidami 4322–4324/4225–4226 (analogicznie do wzorca F1: 4037–4042 vs istniejące 3426–3430). To
  **nie zmienia** klasyfikacji (iii) — dotyczy warstwy menu, nie radia/zasilania.
- **Klasa: (iii) PRAWDOPODOBNIE SPRZĘTOWA — warunkowa (radio + zasilanie).** Uzasadnienie: sam
  kod BLE/gap jest w main block obu build (184 stringi), ale **standby** wymaga utrzymania zasilania
  radia przy „wyłączonym" korpusie — decyzja PMIC/rail + zdolność chipu do duty-cycle standby.
  Chip E144 jest **UNRESOLVED** [INV §2/§6.1]; jeśli chip ≠ CYW43439, firmware radio z E148 nie
  wystarczy. Zapis „images can be imported while power is off" implikuje ścieżkę zapisu karty przy
  wyłączonym SoC — to konstrukcja płyty.
- **Warunek prze-klasyfikowania:** WS0 identyfikuje chip E144 (rozkompresja 0x0106 E144) i dowodzi
  identyczności z E148 albo obecność odpowiednika; dopiero wtedy klasa (i) z portem sterownika.
- **Ryzyko specyficzne:** wysokie (pytanie PMIC/zasilania bez mapy płyty); domyślnie odrzucona w
  wave 1, kandydat do wave 2 po WS0.

## 3.6. F6 — AF Focus Adjustment (fine-tuning AF)

- **Wiersze E148:** 4072 „AF Focus Adjustment", 4073 „Fine-tuning Value" [INV: res_enu_diff_added.tsv].
  Kensus: AF Focus Adjustment 0→2, Fine-tuning 0→1 [INV: feature_census_enu.tsv].
- **Baza w E144:** brak.
- **Klasa: (iii) PRAWDOPODOBNIE SPRZĘTOWA — warunkowa (sensor/PDAF).** Uzasadnienie: korekta AF
  dotyka ścieżki fazowej detekcji (PDAF) — strojenie offsetu fazowego ma sens tylko przy parzystości
  układu sensor+fazowe piksele+AF engine między korpusami; różnice sensor/ISP są bajtowo niewidoczne
  [INV §2/§6.4 — „no sensor part-number strings"], więc **brak jakiegokolwiek dowodu parzystości**.
  Zapis wartości do ustawień jest trywialny; **stosowanie** korekty w pętli AF bez dowodu =
  ryzyko systematycznie błędnego AF. OM-5 II dostał tę funkcję fabrycznie — ale to twierdzenie o
  produkcie, nie o bajtach (I; nie jest podstawą klasy).
- **Warunek prze-klasyfikowania:** wykazanie parowania kodu aplikacji korekty (path od 4072) z kodem
  AF-engine E144 via mapa 9.5M **oraz** parzystości wejścia PDAF (lub jawne stwierdzenie, że korekta
  jest czysto aplikacyjnym biasem do C-AF — wtedy (i)). Do tego czasu: brak portu; dopuszczalny
  wyłącznie inertny port UI **nie** podłączony do AF (RESEARCH_SKELETON_ONLY, eksperyment emulatorowy).

## 3.7. F7 — Airplane Mode

- **Wiersze E148:** 4080 „Airplane Mode" [INV: res_enu_diff_added.tsv]. Kensus „Airplane": 2→4 —
  **uwaga na podstawę:** 2 trafienia E144 to stringi detekcji obiektów („Airplanes" 3516, „Airplanes
  and helicopters will be detected…" 3520) [INV: res_strings_E144_enu.tsv], **nie** tryb samolotowy.
  Funkcja jest więc **nowa** w E148 (delta realna 0→2 wiersze trybu).
- **Klasa: (i) czysto software'owa.** Uzasadnienie: tryb samolotowy = sekwencja wyłączenia radio-
  modułów w warstwie aplikacyjnej (WLAN/BT/GPS-gating); kod zarządzania radiami jest w main block
  obu buildów (184 stringi BT, stack WLAN wspólny rodzaj [INV §2]); GPS wspólny (9→9) [INV §2].
  Wyłączenie radio jest operacją „w stronę bezpieczną" (off), więc warunek nieznajomości chipu E144
  nie podnosi klasy — najgorszy przypadek to brak radia do wyłączenia.
- **Warunek wejścia WS4-F7:** parowanie handlera 4080 + identyfikacja hooków power-down radio;
  emulator: ścieżka menu → wywołania off bez dereferencji nieistniejących urządzeń.
- **Ryzyko specyficzne:** niskie.

## 3.8. F8 — USB Webcam (tryb UVC)

- **Wiersze E148:** 4748 „USB Webcam", 4749 „@A087@ Control", 4698 „Webcam" (krótka forma), 4570
  „USB Settings" [INV: res_enu_diff_added.tsv]. Kensus: Webcam 1→2 (E144 ma pojedynczy string
  wewnętrzny 3991 „Webcam" — w kontekście zapisu na dwie karty, nie trybu) [INV: res_strings_E144_enu.tsv
  sid 3991].
- **Baza w E144:** brak trybu user-visible; jest pojedynczy string „Webcam" pod sidem **3991**
  [INV: res_strings_E144_enu.tsv]. **Uwaga:** w E148 ten sam sid 3991 znaczy co innego („Saves to
  both cards applying same …settings") — sids **nie są stabilne między buildami**; to materialny
  argument dla R-SID-1 (transplantowane stałe sidów zawsze re-mapować przez tabelę, nigdy 1:1).
- **Klasa: (i) czysto software'owa** — **najlepiej uzasadniona hardware-owo funkcja katalogu.**
  Uzasadnienie: oba korpusy mają **ten sam** DWC3-class USB IP i niemal identyczne szablony
  deskryptorów bcdUSB 0x0300 (164/224 bajtów w oknie) [INV §2]; tryb webcam = gadget UVC w warstwie
  aplikacyjnej (strumieniowanie z silnika obrazowania przez wspólny IP). Brak xhci/dwc3/ehcd
  stringów ≠ brak IP (nazwy rejestrowe USBIP_* są obecne) [INV §2].
- **Warunek wejścia WS4-F8:** parowanie klasy webcam handlera; analiza endpointów izochronnych w
  deskryptorach obu buildów (diff 60/224 bajtów w oknie — zrozumieć różnice PID/VID/interfejsów);
  emulator: brak pełnego UVC host-side testu — ścieżka statyczna + emulator do momentu wysłania
  pierwszego deskryptora (L2), reszta L3 not_proven.
- **Ryzyko specyficzne:** średnie. Bandwidth/jakość streamingu zależą od taktowań IP — L3 not_proven
  z definicji.

## 3.9. F9 — Power Supply from USB (zasilanie z USB)

- **Wiersze E148:** 4569 „Power Supply from USB", 4883 „Power Supply", 4570 „USB Settings", 4749
  „@A087@ Control" (kontekst USB) [INV: res_enu_diff_added.tsv]. Kensus: USB 11→18 [INV:
  feature_census_enu.tsv].
- **Baza w E144:** USB menu istnieje (11 wierszy) [INV: feature_census_enu.tsv].
- **Klasa: (iii) PRAWDOPODOBNIE SPRZĘTOWA — warunkowa (PMIC/USB-PD).** Uzasadnienie: pobór zasilania
  z USB wymaga negocjacji PD i ścieżki ładowania w PMIC; mapa PMIC nie jest widoczna w bajtach
  main block (brak stringów PMIC w diff inwentarza) i **brak schematów płyty** (sekcja 8, Q13).
  Deskryptory USB są wspólne (IP takie samo), więc **warstwa negocjacji może być portowalna**, ale
  zachowanie zasilania (czy korpus faktycznie pobierze energię i nałuje akumulator) jesthardware.
- **Warunek prze-klasyfikowania:** identyfikacja kontrolera ładowania/PD w bajtach (np. stringi
  driverów w 0x0106) i parzystość z E148; do tego czasu port wyłącznie jako **struktura menu bez
  podłączenia do ścieżki zasilania** (RESEARCH_SKELETON_ONLY) jest dozwolony w fazie emulatorowej.
- **Ryzyko specyficzne:** wysokie dla wariantu „na żywo" (nieterminalne stany ładowania); zero dla
  struktury menu w emulatorze.

## 3.10. F10 — Fn Lever (dźwigienka; ustawienia i przypisanie zasilania)

- **Wiersze E148:** 4365 „Fn Lever Settings", 4458 „Sets the function switched using Fn Lever",
  rekomendacje tekstów **in-place** sids 3978/3979 na „Assign power to Fn Lever as follows:
  Position 1: Power Off/On, Position 2: Power On/Off, Power Lever is disabled" [INV:
  res_enu_diff_added.tsv; INV: res_enu_diff_changed.csv linie 1000–1007; INV: res_enu_textnew_in_E148.tsv
  linie 477–478]. Kensus: Lever 24→30 enu; main-block „lever" 74→96 [INV: feature_census_enu.tsv,
  feature_census_ascii.tsv].
- **Baza w E144:** **26 wierszy enu zawierających „lever"** istnieje (menu „Button/Dial/Lever"
  2071–2073, „@A088@ Lever Function" 2151/2152, „Disables lever function" 2275)
  [INV: res_strings_E144_enu.tsv] —
  **obecność stringów nie jest dowodem obecności dźwigienki** (stringi platformowe dziedziczone z
  rodziny E-M5/E-M1; placeholder @A088@ jest body-dependent, I).
- **Klasa: (iii) PRAWDOPODOBNIE SPRZĘTOWA — ODRZUCONA.** Uzasadnienie: korpus OM-5 **nie ma
  dźwigienki Fn** (wiedza produktowa, I — potwierdzenie checklistą WS0: brak wejścia GPIO/ADC
  lever'a jest nieweryfikowalny bajtowo bez schematu). Wiersze E148 (4365/4458 i power assignment
  3978/3979) targetują urządzenie, którego nie ma, a „Assign power to … Position 1/2" operuje
  **stanem zasilania** pozycji dźwigienki — pisanie w ścieżkę zasilania nieistniejącego urządzenia
  to najgorszy możliwy kandydat na ślepy port. Port wierszy menu bez urządzenia tworzy dead-UI i
  potencjalne ścieżki zapisu w PMIC — odrzucamy całkowicie (nawet jako inertny skeleton).
- **Wyjątek badawczy:** dekodacja kodu handlerów 4365/4458 w emulatorze (read-only) jest dozwolona
  jako materiał poznawczy o frameworku (lista wywołań), bez portowania.

## 3.11. F11 — Framework menu ListMenu/Tab (przeniesienie rodziny klas)

- **Stringi E148:** `Menu_ListMenu_Group_Level_VM_Actuator` @0x11bcc8c, `Menu_ListMenu_Group_Level_Viewer`
  @0x11bfa24, `Menu_ListMenu_Tab_Menu_VM_Actuator` @0x11c3798, `Menu_ListMenu_Tab_Menu_Viewer`
  @0x11ca476; `Menu_Viewer` @0x11ded9f współistnieje [INV §3]. E144: `Custom_Menu_Viewer` @0x12271xx
  [INV §3]. Pamięci ustawień tab/page **1909/1910** czytane z **vtable slotu 8** [REPO: finding 65].
- **Klasa: (i) czysto software'owa — największy pojedynczy element portu.** Uzasadnienie: klasy GUI,
  ich tabele vtable i dane są w main block; oba buildy mają wspólny base i izomorficzny layout
  [INV §1]; E148 dowodzi koegzystencji obu frameworków (Menu_Viewer nadal obecny), więc port B+
  nie musi usuwać frameworka E144.
- **Zależności:** pamięci 1909/1910 wymagają sklepu ustawień o znanym layoucie — tabela deskryptorów
  **niezlokalizowana na obu buildach** [INV §6.3] → WS0-4; wiersze nowego frameworka konsumują sidy
  4013+ → reguła R-SID-1; klik w menu-rows pipeline (styl om-c: page record + row-order list +
  tabele per-mode + app_check_mode + SettingController sloty [REPO: analysis/om-c-firmware/README.md
  §3.6]) — do przeprowadzenia na bazie E144 (tam znamy bound 667 [INV §3]).
- **Ryzyko specyficzne:** średnie/wysokie (inwazyjność), ale ograniczone koegzystencją frameworków
  i gotowym portem E148→E144 w emulatorze (98/117 override'ów już przejętych [REPO: finding 65]).

## 3.12. Katalog dodatkowy (kandydaci niskokosztowi/odroczeni, poza wave 1)

| Funkcja (sids E148) | Klasa wstępna | Nota |
|---|---|---|
| Starry Sky AF (4053–4055, 4494) | (i) warunkowa (AF engine) | E144 ma 5 wierszy Starry (sceny); nowe = dedykowany AF; wymaga parowania kodu AF |
| Subject Detection AF / C-AF Area (4723–4744) | (i) warunkowa | E144 ma detekcję obiektów (3520 airplane-detect); E148 rozszerza UI; **[PRIOR] twierdzi „AI subject detection impossible on this platform" — KONFLIKT z obecnością NN models w 0x0106 E148 i wierszami UI** (sekcja 8, Q10); nie-portowane do rozstrzygnięcia |
| RAW 12/14-bit (4713–4715, 4751/4752) | (iii) warunkowa (sensor readout) | ścieżka odczytu sensora niewidoczna bajtowo |
| AF target by face (4014, 4017), MF focus helper (4018) | (i) warunkowa | wymaga parowania kodu AF/MF UI |
| Blur/Shade Effect (4062–4065) | (i) | silnik obrazowania wspólny |
| Brighten/Shadow/Midtone Area Adjust (4044–4046) | (i) | parametryzacja tonalna |
| Playback Frame Rate (4067), BULB/TIME/COMP (4088) | (i) | niskokosztowe wiersze |
| Custom mode auto-save (4013), Menu op. by @A076@ (4741/4742) | (i) | niskokosztowe |
| Card-slot error rows (4023–4030) | (i) | per-slot błędy; tekstowe |
| „Executing reset…" (4908) i inne opisy systemowe | (i) | dołączą z frameworkiem |

Te pozycje przechodzą przez ten sam pipeline WS4, ale mają zero priorytetu przed katalogiem głównym.

---

# 4. Strategie portu

Trzy strategie. Rekomendacja: **B (wave 1) → B+ (wave 2)**; A opisana dla kompletności i
świadomie nie-rekomendowana (patrz 4.1.4). Wspólne zasady dla wszystkich strategii: R-SID-1,
R-CNT-1, R-NVRAM-1, R-PKG-1 (4.4). Wszystkie produkują wyłącznie `RESEARCH_SKELETON_ONLY`.

## 4.1. Strategia A — pełny transplant bloku głównego z E148 + adaptacja

### 4.1.1. Idea

Wgrać do korpusu OM-5 **blok główny (0x0100) E148** w całości (z zasobami E148), adaptując:
identyfikację kontenera (Model ID), layout NVRAM (remap offsetów w kodzie — nigdy danych korpusu),
blok 0x010e oraz decyzje o 0x0106. To jest „zamiana mózgu" z minimalną liczbą punktowych zmian.

### 4.1.2. Kroki

1. **Kontener:** build kontenera typu `OE` z model nibble pair `1440` (zamiast `1480`), BCD `0x1200`
   (zamiast `0x1100`) [INV §1; REPO: docs/firmware-container.md]; blok główny = E148 0x0100
   bez zmian treści w fazie 0.
2. **NVRAM remap (krytyczny):** na bazie tabeli WS2 przełatać w kodzie E148 wszystkie odczyty/zapisy
   pól NVRAM o udokumentowanym dryfie (`gyro_ofs_y` 0x10→0x28, `gyro_ofs_p` 0x14→0x08, `int1_yaw`
   0x24→0x20, `int1_pitch` 0x2c→0x30 [PRIOR, do re-weryfikacji]) i o **pełną inwentaryzację**
   pól odczytywanych przez transplatowane taski (IBIS/gyro, MDN, EEPROM). Remap **w kodzie**,
   nie w danych korpusu (R-NVRAM-1).
3. **Blok 0x010e (misc loader):** zdecydować — E144-owy (zgodny z bootem korpusu) albo E148-owy;
   115,500 różniących się bajtów [INV §1] czynią wybór materialnym; domyślnie **zostawić E144-owy**,
   chyba że mapa zależności pokaże, że main E148 wymaga nowego loadera (WS0-6).
4. **Blok 1 (resources):** użyć zasobów E148 (framework ListMenu czyta sidy 4013+). Strata: większe
   bloki fontów/ikon? — inwentaryzacja różnicy 1.44 MB (WS0-7). Wariant A2 (merge): dopisać do
   zasobów E148 brakujące wpisy E144 — tylko jeśli inwentaryzacja wykaże braki.
5. **Blok 2 (0x0106):** zostawić E144-owy (radio E144) albo E148-owy (CYW43439 — patrz F5).
   Domyślnie **E144-owy**; sprawdzenie interfejsu main↔Linux (kanały IPC) na rozbieżności (WS0-8).
6. **Blok 4 (images):** bez znaczenia funkcjonalnego (grafika updaterra) — E144-owy.
7. **sum32 + head/tail:** przeliczyć sum32 każdego bloku i zgodność head[:28]/tail[:28]
   [INV §1; REPO: analysis/nd128/README.md — precedens re-encode + tail sum32; „checksum only shows
   the container is well formed locally"].
8. **Walidacja offline:** modelcheck/nav na obrazie A w emulatorze; komplet manifestów patchy.

### 4.1.3. Wymagane modyfikacje i narzędzia

- Model ID re-pack (nibble pair + BCD), sum32 recompute, wygenerowanie manifestu (R-PKG-1).
- **NVRAM remap** — narzędzie: mapa parowa `emu/bin/port.mjs` + własny skanner stałych offsetów
  NVRAM; walidacja w emulatorze na syntetycznym NVRAM E144.
- **Sprzęt ratunkowy (poza autoryzacją):** [PRIOR] recovery mode mieszka w Block 0 (OK+Power,
  task 95) — uszkodzenie Block 0 = brick bez programatora SPI. Strategia A **zakłada istnienie
  programatora SPI jako warunku wstępnego** (bez niego: P sukcesu drastycznie niżej; ryzyko
  nieodwracalne). To wymaganie jest dokumentacyjne — sam zakup/podłączenie SPI to operacja sprzętowa
  wymagającej osobnej decyzji safety (sekcja 7).
- Emulator: pełny harness WS1 (modelcheck, nav, golden traces).

### 4.1.4. Szacunek, prawdopodobieństwo, werdykt

| Parametr | Wartość | Podstawa |
|---|---|---|
| Praca | **50–80 h** [PRIOR]; rewidowane: 60–100 h z pełną inwentaryzacją NVRAM i decyzjami 0x010e/0x0106 | priors + szczegółowość tego dokumentu |
| Tokeny | 0.8–1.5 M | proporcjonalnie do zakresu analizy NVRAM/loader |
| P sukcesu (funkcjonalny boot L3 bez SPI) | **15–25 %** [PRIOR] | brick-risk Block 0, updater E144 UNRESOLVED, NVRAM drift |
| P sukcesu (z SPI rescue i pełnym WS2) | 40–55 % (I) | nieznane braki: sensor/ISP, PMIC, radio |
| Wymagane narzędzia | emulator + SPI programator (sprzętowy warunek ratunku) | [PRIOR] |

**Werdykt: NIE rekomendowana** jako pierwszy krok. Uzasadnienie: koszt i ryzyko nieproporcjonalne
do celu (menu/UX), chyba że cel rozszerzy się na pełny feature-set E148 łącznie z radio. Strategia A
staje się rozsądna dopiero po: WS2 (tabela remapu) + dowodzie akceptacji updatera E144 (WS0-3) +
dostępności rescue SPI + formalnej decyzji safety.

## 4.2. Strategia B — cherry-pick modułów na bazie E144 v1.2

### 4.2.1. Idea

Zostawić **cały firmware E144 v1.2** jako bazę. Portować pojedyncze funkcje z E148 jako
**przeszczepy kodu+danych** identyfikowane mapą parowania 9,503,564 instrukcji [INV §4], z wierszami
menu dodanymi metodą om-c [REPO: analysis/om-c-firmware/README.md §3.6] na istniejącym frameworku
Menu_Viewer E144, z sidami dopisanymi append-only.

### 4.2.2. Kroki (szablon per funkcja)

1. **Lokalizacja modułu E148:** kotwice = stringi logów funkcji (sekcja 3) → referencje kodu
   (metoda kinship_samples: okno ±(96/128) B [INV §4]) → granice modułu (funkcje wywoływane/wywołujące,
   tabele vtable, dane statyczne).
2. **Mapa parowania:** dla każdego elementu modułu ustalić, czy w E144 istnieje odpowiednik
   (instrukcje parują) — elementy **parujące** są w E144 (możliwy selection: tylko wariant E148);
   elementy **nieparujące** = nowy kod do transplantacji.
3. **Transplantacja:** wstawienie kodu/danych w code-cave lub za rozszerzeniem bloku (miejsca:
   wolne przestrzenie i/lub powiększenie packed spans — decyzja per moduł; raw spans mają równe
   rozmiary w obu buildach [INV §1], więc powiększenie wymaga re-encode spanów z olycompress).
4. **Przepięcie sidów (R-SID-1):** stałe sidów w transplatowanym kodzie przepięte na appendowane
   sidy E144 (czytaj 4.4).
5. **Wiersze menu (add-row pipeline, styl om-c):** page record + row-order list + tabele per-mode +
   **app_check_mode: bound 667→667+k z relokacją** + SettingController sloty [REPO:
   analysis/om-c-firmware/README.md §3.6; INV §3 — E144 bound 667 @0x8fe0da].
6. **Rejestr disabled (R-CNT-1):** nowe wiersze nie mogą wpaść w rejestr trybów z błędnym boundem;
   dla E148 boundu nie znamy — ale portujemy na E144, gdzie jest znany.
7. **sum32/repack + manifest** (R-PKG-1), walidacja emulatorowa L2.

### 4.2.3. Kolejność funkcji w B (wave 1)

| Kolejność | Funkcja | Szacunek | P (L2) | Uwagi |
|---|---|---|---|---|
| B-1 | F1 Live ND rozszerzenia | 3–5 h | 85–90 % | najmniejszy element katalogu głównego |
| B-2 | F7 Airplane Mode | 2–4 h | 85–90 % | tryb „w stronę bezpieczną" |
| B-3 | F4 Focus Stacking+ | 4–6 h | 80–85 % | wymaga add-row pipeline |
| B-4 | F8 USB Webcam | 5–8 h | 75–85 % | największy moduł, deskryptory |
| B-5 | F2 Live GND | 6–10 h | 70–80 % | zależny od dowodu LUT/ISP (WS4-F2) |
| B-6 | F3 High Res handheld (prezentacyjna część: Handheld Assist) | 3–5 h | 80–85 % | pełny handheld po WS2 (wave 2) |
| — | F5/F6/F9/F10 | — | — | odrzucone/warunkowe (sekcja 3) |

### 4.2.4. Szacunek, prawdopodobieństwo, narzędzia

| Parametr | Wartość | Podstawa |
|---|---|---|
| Praca pierwszej funkcji | **8–14 h, P=85–90 %** [PRIOR] — zgodne z B-1+B-2 powyżej | priors („selective feature injection on E144 base") |
| Praca całej wave 1 (B-1..B-6) | 23–38 h (I) | suma tabeli 4.2.3 + narzuty add-row pipeline amortyzowane |
| Tokeny | 0.3–0.6 M | skanery + dekodacja modułów + repack |
| Narzędzia | emulator (modelcheck/nav), `emu/bin/port.mjs` mapa, StringTable parser [REPO: emu/src/lab/resources.mjs], skaner code-cave, repack+sum32 (nd128 precedens) | — |

**Werdykt: REKOMENDOWANA wave 1.** Najlepszy stosunek dowodu do ryzyka; każdy krok odwracalny
(artefakty offline), brick-risk zerowy (nie dotykamy ścieżki flash).

### 4.2.5. Przykład end-to-end (B-1 = F1 Live ND rozszerzenia) — procedura oczekiwana, nie wynik

Poniższe jest **procedurą** (wszystkie kroki [I], dopóki nie wykonane); służy kalibracji budżetu
i pokazuje, jak reguły 4.4 grają razem.

1. **Kotwice (T1):** sidy nowe 4037–4042 (wartości), 4702 (ND128), 4750 (forma krótka), 4703–4705
   (Filter Type), 4719–4722 (Auto Rotate) [INV: res_enu_diff_added.tsv]; baseline E144: 3426–3430,
   3438 [INV: res_strings_E144_enu.tsv]. Referencje kodu = wskaźniki na teksty w main block E148
   (metoda kinship ±(96/128) B [INV §4]).
2. **Lokalizacja handlera wartości:** od referencji 4037/4702 w górę grafu wywołań do wspólnego
   handlera Live ND (istniejącego w E144 przez sids 3426–3430); spodziewany kształt: tabela wartości
   `{poziom → parametry kompozytu}` + bound liczby poziomów (E144: 5 poziomów; E148: 7 z ND128).
3. **Decyzja per element (T1):** tabela wartości → `TRANSPLANT` (nowa liczba wierszy) albo
   `PAIRS+extension`, jeśli tablica E144 ma rezerwę; handler bound → patch stałej (R-CNT-1 nie
   dotyczy — to bound tabeli wartości, nie rejestru trybów); Filter Type/Auto Rotate → `TRANSPLANT`
   (brak bazowych w E144).
4. **Sid map (T2):** 4037–4042/4702/4750/4703–4705/4719–4722 → dopisać pod tymi samymi numerami
   na E144 (przestrzeń 4013+ jest wolna; sidy E148 == sidy nowe E144, 1:1 dla czytelności),
   18 języków; **zakaz** ruszania 3426–3430 (stare wiersze zostają — oba zbiory współistnieją w E148).
   Sid E148 z zakresu 4013..4908 **bez tekstu enu** (24 takich w E148 [INV: res_enu_diff_added.tsv
   ma 872 z 896]) jest **pomijany** w mapie 1:1 i odnotowany w raporcie mappingu — nie wyzwala
   fail-closed T2.
5. **Menu row:** page/row-order per metoda om-c [REPO: analysis/om-c-firmware/README.md §3.6] —
   wiersz „Live ND Shooting" rozszerzony o wartości; app_check_mode bound 667→667+k z relokacją,
   jeśli rejestr trybów obejmuje te mody (ustala pełny scan WS0-12/scan_appcheck).
6. **Repack (T4):** patch-range manifest (spodziewana skala: dziesiątki–setki bajtów kodu + tablice
   + delta bloku zasobów rzędu kilkunastu KB), sum32, head/tail.
7. **Walidacja:** V-F1 PASS; V-00 regression PASS; `not_proven`: L3 (długość naświetlań ND128 na
   sprzęcie, thermal).
8. **Budżet:** 3–5 h; ~40–80k tokenów. Gdy krok 2 pokaże handler rozciągający się w 0x0106 — STOP,
   eskalacja do warunku F2 (sekcja 3.2) i re-klasyfikacja funkcji.

## 4.3. Strategia B+ — hybryda: port frameworku ListMenu z E148 + selektywne funkcje

### 4.3.1. Idea

Przenieść z E148 rodzinę `Menu_ListMenu_*`/`Tab_*` (F11) na bazę E144 **obok** istniejącego
frameworka Menu_Viewer (koegzystencja dowiedziona: oba obecne w E148 [INV §3]), a funkcje
katalogu portować już **natywnie** na ListMenu (tak jak są napisane w E148). Usuwa koszt
reimplementacji wierszy na starym frameworku i ryzyko rozjazdu semantyki (np. tab/page memories).

### 4.3.2. Kroki

1. **Granice klas:** od stringów 0x11bcc8c/0x11bfa24/0x11c3798/0x11ca476 do tablic vtable i
   konstruktorów; pełny graf zależności (VM_Actuator ↔ Viewer, Genifa path [REPO:
   docs/om1-menu-spec.md §1]) w obu buildach.
2. **Rozszerzenie bloku:** transplantacja klas (największy pojedynczy wstawka — szacunkowo
   0.5–2 MB kodu+danych, I) z re-encode spanów olycompress (raw spans równe, packed się różnią
   [INV §1] — procedura re-encode z nd128).
3. **Getter ustawień slot 8:** przepięcie ścieżki `menuMemory` na slot 8 + idy 1909/1910 [REPO:
   finding 65; emu/src/fw/facts.mjs]; wymaga sklepu ustawień E144: **blokada — deskryptory
   niezlokalizowane** [INV §6.3] → WS0-4 musi najpierw zlokalizować tabelę i mechanizm dodania
   dwóch pamięci (1909/1910) na E144.
4. **Add-row pipeline na ListMenu:** odwzorować strukturę stron/tabów E148 (pamięci 1909/1910,
   row-order per tab) — koszt per wiersz maleje względem B (jeden kształt danych).
5. **Funkcje katalogu** wg 4.2.2 krok 1–7, ale wiersze natywnie w ListMenu.
6. Walidacja: emulator L2 — **novum:** nav musi dojść do strony ListMenu (obecnie nav na E144
   zatrzymuje się na GUI buforach [REPO: finding 65/68] — WS1 rozwiązuje).

### 4.3.3. Szacunek, prawdopodobieństwo, narzędzia

| Parametr | Wartość | Uzasadnienie |
|---|---|---|
| Praca frameworku | 20–40 h | graf klas + transplantacja + slot 8 + pamięci |
| Praca funkcji po frameworku | katalog 4.2.3 minus 25–40 % narzutu add-row | jeden kształt danych |
| Łącznie B+ | **45–80 h** | I |
| P sukcesu (L2: ListMenu rysuje stronę na E144) | **40–60 %** | zależność od WS0-4 (deskryptory) i nav-bar |
| Tokeny | 0.4–0.8 M | — |
| Narzędzia | jak B + dekoder menudata/nav [REPO: emu/src/lab/menudata.mjs, nav.mjs] | — |

**Werdykt: REKOMENDOWANA wave 2** — start po WS0-4 i pierwszych dwóch funkcjach z B (dowód
pipeline'u). Jeśli WS0-4 nie zlokalizuje deskryptorów, B+ zostaje wstrzymany (twarda zależność).

## 4.4. Wspólne zasady projektowe (wiążące dla wszystkich strategii)

- **R-SID-1 (append-only sid discipline):** na bazie E144 **nigdy nie nadpisywać tekstów pod
  istniejącymi sidami** (621 zmian in-place E148, w tym rekomendacja 3978/3979 [INV:
  res_enu_diff_changed.csv]) i nie zmieniać sids 0..4012. Transplantowane stałe sidów →
  przepięcie na appendowane sidy (przestrzeń od 4013 w górę, 1:1 z E148 gdzie możliwe dla
  czytelności diffów). **Sids nie są stabilne między buildami** — przykład: sid 3991 = „Webcam"
  w E144, ale „Saves to both cards…" w E148 [INV: res_strings_E144_enu.tsv;
  res_strings_E148_enu.tsv] — każde stała sidowa transplantowanego kodu przechodzi przez mapę
  „sid E148 → tekst → sid E144/nowy sid", weryfikowaną tabelą, nie pamięcią. Dopisanie =
  modyfikacja tablicy językowej (38 wpisów, kształt `StringTable` [REPO: emu/src/lab/resources.mjs])
  + pointer-array + header {first,end}.
- **R-CNT-1 (registry bound):** każdy nowy wiersz menu wymaga poprawy boundu app_check_mode E144
  (667→667+k) z relokacją rejestru; kontrola: scan_appcheck po patchu przechodzi w całości
  [REPO: analysis/om-c-firmware/README.md §3.6; INV §3].
- **R-NVRAM-1 (kod remapuje, dane nigdy):** jakakolwiek różnica layoutu NVRAM jest obsługiwana
  wyłącznie modyfikacją **kodu** (offsety stałe); dane kalibracyjne korpusu są nietykalne
  (read-only dla wszystkich narzędzi tej specyfikacji). Wykaz pól: WS2.
- **R-PKG-1 (manifest i sum32):** każdy artefakt = pełny manifest (wszystkie zakresy bajtowe z
  before/after-hashami — precedens 153 zakresów + 99 edycji oly-fw-analysis [REPO:
  analysis/oly-fw-analysis/README.md r.17]) + sum32/head-tail + kontrola braku dryfu poza
  zakresami; etykieta RESEARCH_SKELETON_ONLY w nazwie pliku i wewnątrz kontenera.
- **R-UPD-1 (akceptacja updaterra nieznana):** reguły akceptacji updatera E144 są UNRESOLVED
  [INV §5]; z E143 znamy tylko: porównanie pierwszych pięciu słów head/tail (błąd 0x3202),
  mapowanie liter bloków A/E/L/F na 0x3210..0x3213, stale main checksum → 0x3211 [INV §5;
  REPO: analysis/oly-fw-analysis/README.md r.16]. Artefakty tej specyfikacji **nie są przeznaczone
  dla updatera**; pre-checki 0x3202/0x3210-3213 implementujemy jako sanity, bez twierdzenia o
  akceptacji.
- **R-ISA-1 (ISA decode):** narzędzia repo dekodują **MN10300** (main RTOS CPU) [REPO:
  docs/mn10300-isa-spec.md; emu/src/core/cpu.mjs]; payload Linux w 0x0106 to 32-bit ARM
  [REPO: analysis/om-c-firmware/README.md §7.3]; tagowanie „ARM Thumb-2" z repo obiektywów
  (`D:\AI\re 100-400`) dotyczy kontrolerów obiektywów — **inne produkty**. Każde narzędzie portowe
  przyjmuje dekodowanie MN10300 z guardem (nieznana forma = fail-closed, jak UDF-form [REPO:
  docs/mn10300-isa-spec.md §2.3]).

## 4.5. Specyfikacja narzędzi portowych (do zbudowania w ramach workstreamów)

Cztery narzędzia offline; wszystkie deterministyczne (ten sam input → byte-identical output,
wzorzec [INV §0]), wszystkie fail-closed (sekcja 7.2), wszystkie z własnym `reproduce.py`-style
runnerem i pinami SHA-256 wejść. Miejsce: `analysis/om5_port_spec/tools/` albo podpakiety
`analysis/` — decyzja implementacyjna, nie w tym dokumencie.

### T1 — `transplant-locator` (WS4)

- **Cel:** od kotwicy stringa (offset E148) do granic modułu (zestaw adresów kodu/danych) i
  decyzji per element: `PAIRS` / `TRANSPLANT` / `E144-ONLY` / `UNKNOWN(fail)`.
- **Wejście:** piny obu obrazów (SHA-256 [INV §1]), mapa parowa z `emu/bin/port.mjs` [REPO],
  lista kotwic (stringi z sekcji 3), parametry okna (domyślnie ±(96/128) B jak kinship_samples
  [INV §4]).
- **Wyjście:** CSV `module_bounds.csv` — element, offset E148, offset E144 (jeśli PARUJE),
  klasyfikacja, uzasadnienie (1 linia), hash okna.
- **Fail-closed:** element bez decyzji = `UNKNOWN` i **blokuje** dalsze narzędzia dla modułu;
  konflikt parowania (rzadkie 41/9.5M [INV §4]) = manual review, nie automat.
- **Sprawdzenie poprawności:** 3 kotwice kinship muszą wyjść identycznie z committingiem
  `kinship_samples.csv` [INV §4] (regression test).

### T2 — `sid-append` (WS4, R-SID-1)

- **Cel:** dopisanie sidów do tablic językowych E144 (18 języków) z pełną walidacją struktury.
- **Wejście:** rozwinięty resource block E144 (lub jego rozwinięcie bloku 0x0101), tabela mapowa
  „sid E148 → tekst(18 języków) → sid nowy/istniejący E144" (tworzona ręcznie z review, per
  funkcja), walidator `StringTable` [REPO: emu/src/lab/resources.mjs].
- **Wyjście:** zmodyfikowane tablice + raport `sid_append_report.csv` (per język: liczba sidów,
  hash przed/po, długości bajtowe) + twarde limity (docelowy rozmiar bloku po re-encode ≤ rozmiar
  kontenera; ostrzeżenie przy przekroczeniu zapasu — patrz S4 i ryzyko R12 (risks.md)).
- **Fail-closed:** odmowa dopisania, gdy: którykolwiek język brakuje tekstu (nie „fallback enu" —
  puste = stop; decyzja o placeholderach wymaga osobnego zapisu per sid), kolizja sid istniejącego,
  zmiana treści istniejącego sida. **Wyjątek (żeby 1:1 append nie zahaczył o własny fail-closed):**
  sid z zakresu E148 4013..4908 bez tekstu enu (24 takich; `res_enu_diff_added.tsv` pokrywa 872
  z 896) = **pomijany**, nie błąd — każde pominięcie trafia do raportu mappingu (`sid_append_report`).
  Tryb 1:1 „sidy E148 == nowe sidy E144" stosuje tę regułę domyślnie.
- **Zakaz:** nadpisywanie tekstów in-place (621 przykładów E148 pokazuje, że producent tak robi —
  my nie, aby nie łamać funkcji E144).

### T3 — `nvram-remap` (WS2, R-NVRAM-1)

- **Cel:** tabela offsetów pól NVRAM E144↔E148 + przepięcie stałych w transplantowanym kodzie.
- **Wejście:** rozwinięte obrazy main obu buildów, lista tasków czytających NVRAM (WS2-2 graf
  wywołań), fixtures syntetyczne WS1-5.
- **Wyjście:** `nvram_field_map.csv` (pole, offset E144, offset E148, task-odczyt/y, dowód offset
  [instrukcja+offset], status `VERIFIED`/`UNKNOWN(fail)`), patch-list stałych do przepięcia.
- **Fail-closed:** `UNKNOWN` pole dotknięte przez moduł = moduł nie przechodzi bramki G-NVRAM;
  narzędzie nigdy nie generuje zapisu do NVRAM (read-only z definicji; testy zapisu tylko na RAM
  emulatora).
- **Sprawdzenie poprawności:** 4 pola [PRIOR] drift (gyro_ofs_y/p, int1_yaw/pitch) muszą wyjść
  zgodnie z priors albo dokumentujemy rozbieżność — **nie dopasowujemy wyniku do priors**.

### T4 — `repack-builder` (WS5, R-PKG-1)

- **Cel:** deterministyczny build kontenera `OE` z manifestem.
- **Tryby:** (a) **patch-in-place** (domyślny) — edycje w istniejących zakresach, rozmiary bloków
  i offsety pliku bez zmian; (b) **block-resize** — zmiana długości całego bloku (np. dopisanie
  sidów do 0x0101, gdy zapas ciągły jest niewystarczający): per blok nowa długość, przesunięcie
  offsetów plikowych wszystkich bloków za nim, aktualizacja pól head bloku zmienianego (w tym
  **body length @0x0C** [REPO: docs/firmware-container.md; tools/olyfw.py parse_head]) i wynikowej
  długości pliku; kontrola, że tablica bloków nadal tile-uje cały plik i żadna para head/body/tail
  nie nachodzi. Regresja trybu (b): **re-unpack outputu przez `tools/olyfw.py`** (parsowanie head,
  descramble, tile'ing) + sum32 każdego bloku + piny SHA-256 (digest pins) wejść i oczekiwanych
  długości.
- **Wejście:** bazowy kontener E144 (pin), lista patch-range (z T1–T3), parametry kontenera
  (Model nibble `1440`, BCD `0x1200`).
- **Wyjście:** `*.RESEARCH_SKELETON_ONLY.BIN` + `*.manifest.csv` (zakres, before-hash, after-hash,
  źródło-decyzji) + `*.sha256` (detached) + log sum32/head-tail per blok.
- **Fail-closed:** odmowa gdy manifest nie pokrywa 100 % różnic (porównanie bajtowe output vs input
  musi się sprowadzać do manifestu — zero dryfu), gdy którykolwiek zakres dotyka segmentów boot
  (Block 0 boot/recovery — [PRIOR] Z3) bez formalnego flaga `SAFETY_DECISION_PRESENT`, gdy wywołania
  w transplantowanym kodzie trafiają w blacklist MDN (WS6-3), gdy BCD/nibble niezgodne z parametrami;
  w trybie block-resize dodatkowo odmowa przy niespójnym tile-ing head/body/tail po resize.
- **Sprawdzenie poprawności:** idempotencja (build z tego samego manifestu = identyczne bajty),
  round-trip (rozkodowanie output przez narzędzia inwentarza musi dać przewidywane wartości
  [INV reproduce.py jako oracle]).

### Wspólne wymagania narzędziowe

1. Każde narzędzie: `--check` tryb (tylko walidacja, bez zapisu), kody wyjścia 0/1/2 (OK/fail-closed/
   input-błąd), log JSONL do archiwum pakietu.
2. Testy: co najmniej smoke test tworzenia/odczytu w docelowym katalogu (konwencja repo AGENTS
   preflight — ścieżki ze spacjami cytowane osobno), oraz regression na pinach inwentarza.
3. Zależności: tylko to, co już jest w repo (`tools/olyfw.py`, port.mjs mapy, lab parsers) + własny
   kod w pakiecie; żadnych binarnych zależności bez recenzji.

---

# 5. Macierz SZANSE vs ZAGROŻENIA

Rozszerzenie z mitygacjami i detectability: `risks.md` (pakiet). Tutaj zwięzła macierz decyzyjna.

## 5.1. SZANSE (S1–S12)

| # | Szansa | Dowód | Wpływ na strategię |
|---|---|---|---|
| S1 | Wspólna platforma: ten sam base 0x60021020, izomorficzny layout main block, byte-identyczna tabela BCS | [INV §1] | fundament wszystkich strategii |
| S2 | **9,503,564 sparowanych instrukcji E148↔E144** (41 konfliktów) — gotowa mapa homologii | [INV §4; REPO: emu/bin/port.mjs] | transplantacja ma adres → adres; B/B+ |
| S3 | Ten sam DWC3-class USB IP + niemal identyczne szablony deskryptorów bcdUSB 0x0300 (164/224) | [INV §2] | F8 klasa (i); rzetelna podstawa portu USB |
| S4 | **Append-only sids:** +896 sidów, 0 usunięć; E148 zmieścił je w bloku zasobów o 1.44 MB mniejszym → zapas miejsca na E144 | [INV §1/§3; INV: res_enu_diff_removed.tsv pusty] | dodawanie bez renumeracji (R-SID-1) |
| S5 | Live ND już w E144 (7 wierszy) — silnik live-kompozytu obecny | [INV: res_strings_E144_enu.tsv 3426–3438] | F1/F2 tańsze; B-1 start |
| S6 | Focus Stacking bazowo w E144 (3272 + 2871) | [INV: res_strings_E144_enu.tsv] | F4 tańsze |
| S7 | Flash access guard byte-stable na tych samych offsetach (code ref 0x819/0x819, 212/224) | [INV §4] | mechanizm ochrony zapisu przewidywalny — mniejsze ryzyko patchy wokół guardu |
| S8 | Dual-band path stock w RTOS+olnet (band +0xd1 → hw_mode=a/ieee80211ac=1) — ścieżka istnieje w kodzie rodziny | [REPO: analysis/om-c-firmware/README.md §3.4] | radio: gdy chip E144 ≡ E148, potencjał 5 GHz (badawczo; patrz Z12) |
| S9 | Emulator rodziny gotowy: modelcheck przechodzi dla E144 i E148 (port chainowany przez E144: 98/117 override'ów), sesje menu od findings 66–68 | [REPO: docs/model-survey.md finding 65–68] | walidacja L2 bez sprzętu; WS1 tanie |
| S10 | Komplet narzędzi offline: StringTable parser, menudata/nav, fw-survey, reproduce.py inwentarza (deterministyczny) | [REPO: emu/src/lab/*; INV reproduce.py] | powtarzalność dowodów (seal/manifest) |
| S11 | Ta sama rodzina płyty (board family E144 także dla E148), 20× „SDRAM" equal (20/20), brak różnic paneli | [INV §2; INV: ascii_strings_E1xx.tsv; REPO: emu/src/fw/models.mjs] | memory-map/DRAM init bez zmian — brak Ryzyka relokacji stosu/heapu |
| S12 | Precedensy repack i add-row: nd128 (re-encode + tail sum32, 58 B diff) i om-c (menu rows + bound +639→…) udokumentowane end-to-end | [REPO: analysis/nd128/README.md; analysis/om-c-firmware/README.md §3.6] | WS5/WS4 nie zaczyna od zera |

## 5.2. ZAGROŻENIA (Z1–Z13)

| # | Zagrożenie | Dowód/podstawa | Dotkliwość | Mitygacja (→ risks.md) |
|---|---|---|---|---|
| Z1 | **IBIS/gyro NVRAM drift** — [PRIOR]: `gyro_ofs_y` 0x10→0x28, `gyro_ofs_p` 0x14→0x08, `int1_yaw` 0x24→0x20, `int1_pitch` 0x2c→0x30; naiwny cross-flash grozi uderzeniem cewek IBIS (mechanika) | [PRIOR, byte-verified w repo priors; ślad do odzyskania] | **krytyczna (sprzęt)** | R-NVRAM-1 + WS2 remap; F3 blokowany do WS2 |
| Z2 | **Destructive MDN paths** — [PRIOR]: 74 komendy MDN (RESET_CAM_CALIBDATA 0x12, DEFAULT_CALIB_DATA 0x36, ONENAND_STLFORMAT 0x26), EEPROM clear — bad magic/sum nadpisuje kalibrację fabryczną | [PRIOR] | **krytyczna (nieodwracalne)** | blacklist komend w narzędziach (fail-closed); żadnych eksperymentów w ścieżkach MDN |
| Z3 | **Recovery w Block 0** — [PRIOR]: OK+Power, task 95; uszkodzenie Block 0 = brick bez SPI | [PRIOR; REPO: oly-fw-analysis r.15 — updater task 95 na E143] | **krytyczna** | strategia A tylko z SPI-rescue; B/B+ nie dotykają ścieżki flash |
| Z4 | **PMIC/USB-PD niewidoczne** — „Power Supply from USB" bez mapy PMIC | [INV §2 brak PMIC strings; brak schematów] | wysoka (F9) | F9 = (iii) warunkowa; port menu bez ścieżki zasilania |
| Z5 | **Różnice rozmiarów bloków:** resources −1.44 MB, large-data −3.15 MB, images +3.15 MB, 0x010e rewritten (115,500 B) | [INV §1] | wysoka (A), średnia (B+) | offsety cross-blokowe nie przenoszą się 1:1 — każdy transplant re-mapyzowany indywidualnie |
| Z6 | **Brak schematów płyty** — klasyfikacje (iii) opierają się na stringach; wejścia GPIO/ADC/rail nieweryfikowalne bajtowo | strukturalny brak | wysoka | zasada: brak dowodu = klasa (iii); nie „prawdopodobnie OK" |
| Z7 | **Regulatory WiFi / region codes** — country codes 0..10 → XC/XD, JP/XB, XE/XF; kanał clamp 0..13 | [REPO: om-c §3.4] | średnia | nie portujemy ścieżek 5 GHz; F7/F5 tylko off-state |
| Z8 | **Utrata gwarancji / trwałe zmiany fabryczne** — NVRAM/EEPROM nieodwracalne | strukturalny | średnia (reputacyjna) | offline-only; kalibracja nietykalna (R-NVRAM-1) |
| Z9 | **Brick bez SPI + updater E144 UNRESOLVED** — reguły akceptacji nieznane; [PRIOR] PC updater odmawia niezgodnego Model ID; in-camera flasher porównuje Model ID z EEPROM/OTP (repack „bypassable", STATIC_CFG) | [INV §5; PRIOR] | **krytyczna dla A** | R-UPD-1: artefakty nie-idą do updatera; A dopiero po WS0-3 + SPI |
| Z10 | **ISA tagging conflict** — „ARM Thumb-2 vs mn10300" ze starego repo; pomyłka unieważnia mapę par i patche | [PRIOR konflikt (b); REPO: docs/mn10300-isa-spec.md; om-c §7.3] | wysoka (jeśli błędne) | R-ISA-1: MN10300 z fail-closed; WS0-1 potwierdzenie formalne |
| Z11 | **Sensor/ISP niewidoczne bajtowo** — klasy (i) mogą kryć zależności ISP; 0x0106 różni się −3.15 MB (NN models!) | [INV §2/§6.4, §1] | wysoka (F2/F6) | warunki wejścia WS4-F2/F6; fail-closed |
| Z12 | **CYW43439 vs 5 GHz napięcie** — om-c wycofał 5 GHz z OM-3 (CYW43439), ale listuje OM-5 1.2 jako wifi-5ghz-capable; E148 = CYW43439 [INV §2] | [REPO: om-c §3.4/§7.3 i tabela features; PRIOR konflikt (c)] | średnia (badawcza) | port nie planuje 5 GHz; WS0 badawczo rozstrzyga (Q11) |
| Z13 | **E148 app_check_mode count UNRESOLVED** — bound nieznany po stronie E148 (nie blokuje B/B+, które portują na E144 z znanym boundem 667) | [INV §3] | niska dla B/B+, wysoka dla A | R-CNT-1; dla A: wymóg pełnego scanu WS0-2 |

## 5.3. Bilans decyzyjny

Szanse S1–S4 + S9–S12 są **mierzalne i już posiadane** (nie trzeba ich zdobywać) — to podstawa
rekomendacji B. Zagrożenia krytyczne Z1–Z3, Z9 są związane ze **ścieżką flash/NVRAM** — strategia
B/B+ z definicji ich nie dotyka (artefakty offline), więc ryzyko rezydualne B/B+ spada do jakości
analizy (odwracalna), nie do sprzętu (nieodwracalna).

---

# 6. Workstreamy, kolejność, kryteria wyjścia

Zależności: `A ← B` (A zależy od B), `→` (potem). Każdy workstream kończy się artefaktem w
`analysis/` i wpisem w tym pakiecie; żaden nie wykonuje operacji na sprzęcie.

## WS0 — Priorytety i zamknięcie luk dowodowych

**Cel:** zredukować listę UNRESOLVED (INV §6 + sekcja 8) do stanu „rozstrzygnięty albo formalnie
zaparkowany z powodem".

Zadania (priorytetowo):
1. WS0-1 **ISA formalne potwierdzenie:** dekodowanie MN10300 vs mapy par — cross-check na 3 kotwicach
   kinship (0x819, 0x30a15) w obu buildach; raport jednostronicowy. [Blokada dla R-ISA-1]
2. WS0-2 **E148 app_check_mode count:** zlokalizować count-compare (analogia E144: `cmp imm,d3`
   po `mov base,d0`); pełny scan z bridgingiem. [Blokuje tylko A; niski priorytet]
3. WS0-3 **Updater acceptance E144:** przeczytać walidację updatera korpusu E144 (static); katalog
   kodów błędów (analogia E143 0x3202/0x3210–0x3213 [INV §5]). Sub-pytanie (review 2026-11-12):
   czy E144 trzyma **jeden obraz czy banki A/B** i **gdzie updater faktycznie zapisuje** (blok
   docelowy/offset) — wpływa na strategię A i na §7 (plan rescue); evidence w repo tego nie
   rozstrzyga. [Blokuje A; wyższy priorytet dla dokumentacji bezpieczeństwa]
4. WS0-4 **Settings-descriptor table:** zlokalizować (kształt 20 B `emu/refs/settings.mjs` albo
   inny), mechanism memories 1909/1910 na E144. [**Twarda blokada B+**]
5. WS0-5 **E144 radio chip:** rozpakować 0x0106 E144 (squashfs @0x216cfe0), identyfikacja chipu
   (CYWxxxx) i wersji kernela. [Blokuje F5; informuje Z12/Q11]
6. WS0-6 **0x010e decision:** map zależności main↔misc loader (który build wymaga którego).
   [Blokuje A]
7. WS0-7 **Resources diff inwentaryzacja (w tym zapas wolnego miejsca 0x0101):** co jest w +1.44 MB
   E144 (fonty/ikony/nie-stringi) **oraz** ile ciągłego wolnego miejsca zostaje w bloku zasobów
   E144 po policzeniu wzrostu z dopisania sidów: ~896 sidów × 18 języków ≈ **+1.3–1.6 MB** bloku
   0x0101 (I; kotwica: rekord enu **231,424 B** w E144 vs **315,904 B** w E148 [INV:
   res_lang_table.csv]). **[Blokuje A zasoby; B: gate pakowania — gdy dopisywane sidy przekroczą
   ciągły zapas, B wymaga trybu block-resize T4/WS5 zamiast append w wolną przestrzeń; patrz
   risks.md R12 i §2.4]**
8. WS0-8 **NVRAM drift re-verification:** odzyskać ślady [PRIOR] (gyro offsets) i zweryfikować na
   obrazach tego clone (kod czytający NVRAM — offsety stałe); tabela remapu WS2. [**Blokada F3/A**]
9. WS0-9 **CJK diff:** rozszerzyć diff tekstów na jpn/chn (obecnie tylko sids-count [INV §6.6]).
   [Niski priorytet]
10. WS0-10 **PMIC map z bajtów:** scan 0x0106/main po driverach charger/PD. [F9]
11. WS0-11 **RAM size rozstrzygnięcie:** dramSize probe w emulatorze dla E144/E148 (konflikt Q9).
    [Informuje F2 bufor]
12. WS0-12 **Mode-id set drugiej tabeli:** poprawić scan (redukcja truncation) — surowe dane do B+
    [INV §3/§6.5].

**Exit criteria:** każda pozycja sekcji 8 ma status `RESOLVED (dowód)` albo `PARKED (powód, koszt
otwarcia)`. Minimum do startu wave 1: WS0-1, WS0-8. **Szacunek:** 4–10 h; 150–350k tokenów.
**Zależności:** brak (start natychmiast).

## WS1 — Emulator/validation harness

**Cel:** wszelka walidacja L2 powtarzalna i automatyczna.

Zadania:
1. Modele E144 i E148 w `emu/src/fw/models.mjs` są aktywne i modelcheck green (regresja).
2. Golden traces bootu E144 (S1/S2/PLAY/INFO) jako baseline diff dla transplantów.
3. Feature-probe protocol: per funkcja z katalogu — sekwencja wejść menu + oczekiwane log-stringi
   (kotwice z sekcji 3), ścieżka „menu → handler → brak crashy".
4. Nav-bar: pracować nad ograniczeniem nav E144 (GUI bufor tables [REPO: finding 65]) — przy najmniej
   dla ścieżek wave 1 (niepełny nav dozwolony, jawny status per funkcja).
5. Syntetyczne NVRAM E144/E148 (fixtures) dla WS2 testów.

**Exit criteria:** `modelcheck E144` green po każdym patchu (regresja), feature-probe ma specyfikację
i runner, fixtures NVRAM z pinami SHA-256. **Szacunek:** 6–12 h; 150–300k tokenów. **Zależności:** brak.

## WS2 — NVRAM adapter (remap table)

**Cel:** kompletna tabela offsetów pól NVRAM E144↔E148 + adapter w kodzie (nie w danych).

Zadania:
1. Odzyskać i zweryfikować ślady [PRIOR] (gyro_ofs_y/p, int1_yaw/pitch) — bajtowo, na kodzie obu
   buildów (odczyty stałych offsetów przy stringach kalibracji).
2. Rozszerzyć inwentaryzację: wszystkie taski czytające NVRAM (IBIS, gyro, MDN, EEPROM, MDN table)
   — skaner stałych offsetów + graf wywołań; **każde pole z dowodem lub „?"+fail-closed**.
3. Adapter: per strategia — dla B: transplantowane moduły czytają offsety E144 (przepięcie stałych);
   dla A: pełny remap warstwy dostępu.
4. Testy emulatorowe: fixtures WS1-5, odczyt/zapis (zapis tylko na kopie w RAM emulatora).

**Exit criteria:** tabela remapu z per-pole dowodem (plik CSV + SHA-256), testy green, żaden zapis
do NVRAM poza emulator RAM. **Szacunek:** 6–10 h; 100–250k tokenów. **Zależności:** WS0-8, WS1.
**Blokada dla:** F3 (pełny), A.

## WS3 — Menu framework (ListMenu port, rdzeń B+)

**Cel:** ListMenu/Tab rysuje stronę na bazie E144 w emulatorze (L2).

Zadania:
1. Graf klas i granic modułu (stringi 0x11bcc8c/0x11bfa24/0x11c3798/0x11ca476 [INV §3]).
2. Transplantacja kodu/danych (re-encode spans), przepięcie sidów (R-SID-1).
3. Getter slot 8 + memories 1909/1910 — **po WS0-4**.
4. Add-row pipeline na ListMenu; CNT-1.
5. Emulator: nav do strony ListMenu, golden screenshot diff (canvas lab).

**Exit criteria:** L2: strona ListMenu narysowana na E144 w emulatorze; memories read/write w
emulatorze; komplet manifestów. **Szacunek:** 20–40 h; 300–700k tokenów. **Zależności:** WS1,
WS0-4, WS5. **Blokada dla:** B+; F-katalog wave 2.

## WS4 — Per-feature port (katalog sekcji 3)

**Cel:** funkcje katalogu w kolejności 4.2.3, każdy wg szablonu B (4.2.2).

Kolejność i warunki wejścia:
- B-1 F1 (brak blokad) → B-2 F7 (brak blokad) → B-3 F4 (add-row pipeline gotowy po B-1/B-2)
  → B-4 F8 (deskryptory diff zrozumiany) → B-5 F2 (**wejście: WS4-F2 dowód LUT** [warunek z 3.2])
  → B-6 F3-prezentacyjna (Handheld Assist) → F3 pełna (**po WS2**).
- F5/F6/F9: tylko po warunkach prze-klasyfikowania (sekcja 3). F10: **nigdy** (odrzucona).

**Exit criteria (per funkcja):** static checks (manifest zakresów, sum32), L2 emulator path
(feature-probe), jawne `not_proven` dla L3, artefakt `*.RESEARCH_SKELETON_ONLY.BIN` + manifest,
aktualizacja risks.md. **Szacunek:** 23–38 h wave 1; 350–700k tokenów. **Zależności:** WS1, WS5;
F3: WS2; wave 2: WS3 + WS0-4.

## WS5 — Packaging/repack + sum32

**Cel:** powtarzalny, audytowalny build kontenerów badawczych.

Zadania:
1. Builder kontenera `OE`: Model nibble `1440`, BCD `0x1200`, bloki, sum32, head/tail 28 B
   [INV §1; REPO: docs/firmware-container.md].
2. Re-encode spanów olycompress (raw sizes równe [INV §1]) — precedens nd128 (58 B packed diff +
   4 B tail [REPO: analysis/nd128/README.md]).
3. **Tryb block-resize (T4b):** powiększenie bloku (np. 0x0101 po dopisaniu sidów poza ciągły
   zapas): per blok nowa długość, przesunięcie offsetów kolejnych bloków, aktualizacja head
   (body length @0x0C) i długości pliku; regresja = re-unpack `tools/olyfw.py` + sum32 + piny
   digestów (szczegóły: T4, §4.5).
4. Manifest: wszystkie zakresy z before/after-hashami (styl 153+99 oly-fw-analysis [REPO:
   oly-fw-analysis r.17]), deterministyczny (byte-identical na powtórny run — jak reproduce.py
   inwentarza [INV §0]).
5. Sanity pre-checki 0x3202/0x3210–0x3213 jako testy lokalnej poprawności (bez twierdzenia o
   akceptacji updatera — R-UPD-1).
6. Naming: `*.RESEARCH_SKELETON_ONLY.BIN`, sha256 sidecar, brak nazw sugerujących użyteczność
   instalacyjną.

**Exit criteria:** builder deterministyczny, manifesty kompletne, dryf zerowy poza zakresami
(fail-closed). **Szacunek:** 4–8 h; 80–150k tokenów. **Zależności:** używany przez WS3/WS4;
może startować równolegle (API builder na starcie).

## WS6 — Safety review + bramki (ciągłe)

**Cel:** formalne bramki między pracą offline a jakimkolwiek hardware; przegląd ryzyk.

Zadania:
1. Risk register live (risks.md) — aktualizacja per WS4 feature.
2. Bramki: HW-GATE-0 (jakakolwiek operacja na korpusie) — wymaga osobnej formalnej decyzji safety
   (odpowiednik OMDS-SFTY), osobno dla: odczyt diagnostyczny, flash, cross-flash —
   **każda domyślnie odmowna**; obecna specyfikacja żadnej nie otwiera.
3. Blacklist destructive: MDN 0x12/0x36/0x26 i EEPROM-clear [PRIOR] zakodowane jako asercje
   fail-closed w builderze/skanerach (żaden wygenerowany kod ścieżki nie może ich wywołać).
4. Przegląd „co gdy jednak kto wgra" — lista skutków i rescue (dokumentacyjnie; SPI jako jedyne
   ratunek dla Block 0 [PRIOR Z3]).

**Exit criteria:** każdy artefakt ma etykietę safety; bramki udokumentowane; blacklist aktywny.
**Szacunek:** 4–8 h rozłożone; 50–100k tokenów. **Zależności:** wszystkie.

## 6.1. Harmonogram (zależności, nie kalendarz)

```
WS0 ────────────────► (ciągłe; min. WS0-1+WS0-8 przed F3/A)
WS1 ────────────────► (równolegle od startu)
   ├─► WS2 ─► (F3 pełny, A)
   ├─► WS5 ─► (WS3, WS4)
   ├─► WS4(B-1..B-2) ─► WS4(B-3..B-6) ─► wave 1 done
   └─► WS0-4 ─► WS3 ─► WS4(wave 2: F-katalog na ListMenu)
WS6 ────────────────► (wszystkie)
```

**Suma wave 1 (B):** suma arytmetyczna zakresów komponentów (WS0 min 4–10 h + WS1 6–12 h + WS2
6–10 h + WS4 23–38 h + WS5 4–8 h + WS6 4–8 h) = **47–86 h** pracy, **0.88–1.85 M tokenów**.
**Suma z B+:** + WS3 (20–40 h; 300–700k) = **67–126 h**, **1.18–2.55 M tokenów** (koszt funkcji
katalogu wave 2 na ListMenu budżetowany jest osobno w 4.3.3 — nie sumowany tu dwukrotnie).
A pozostaje poza harmonogramem do czasu bramek.

## 6.2. Scenariusze walidacyjne (szablony WS1 — konkret per funkcja)

Każdy feature-probe to skrypt emulatorowy o stałym kształcie: `SETUP → DRIVE → OBSERVE → ASSERT →
REPORT`. Wszystkie scenariusze działają na rozwiniętych obrazach w RAM; nic nie wychodzi poza
emulator. Poniżej szablony katalogu wave 1 (uzupełniane per WS4; kotwice = stringi logów z sekcji 3).

| ID | Scenariusz | SETUP | DRIVE (wejścia emulatora) | OBSERVE (kotwice/logi) | ASSERT (min.) |
|---|---|---|---|---|---|
| V-00 | baseline boot E144 | czysty obraz E144 | power-on | boot trace, S1/S2/PLAY [REPO: modelcheck] | trace ≡ golden (regresja) |
| V-01 | baseline boot E148 | czysty obraz E148 | power-on | j.w. | trace ≡ golden E148 |
| V-F1 | Live ND wartość 7 EV | obraz B-1 | menu → Live ND → wybór ND128 | logi handlera wartości (kotwica 4037-family), brak crashy | wartość akceptowana przez handler; timeout kompozytu nie przekracza limitera tasków |
| V-F7 | Airplane on/off | obraz B-2 | menu → Airplane Mode toggle | power-down wywołania radio (lista wywołań z T1), brak deref nieistniejących urządzeń | sekwencja off kompletna; on przywraca stan |
| V-F4 | Focus Stacking przypisanie | obraz B-3 | przypisanie przycisku → tryb → ekran ustawień | kotwice 4236/4273 | ekran ustawień rysuje; kompozyt rozpoczyna sekwencję bracketingu (log) |
| V-F8 | USB Webcam attach | obraz B-4 | tryb webcam; emulowany attach USB | ścieżka deskryptorów (bcdUSB 0x0300 [INV §2]) | pierwszy deskryptor wysłany; endpointy skonfigurowane |
| V-F2 | Live GND on | obraz B-5 | menu → Live GND → GND8 | kotwice 4706/4716 | handler przyjmuje wartość; task kompozytu startuje |
| V-F3a | Handheld Assist (prezentacja) | obraz B-6 | long-exposure + assist on | kotwica 4219/4454 | poziom stabilizacji rysowany |
| V-F3b | High Res handheld pełny | obraz po WS2 | tryb handheld high-res | odczyty gyro (fixtures) | **odczyty po remapie mieszczą się w sane ranges** (assert R1); kompozyt 8 klatek |
| V-LM | ListMenu strona (B+) | obraz WS3 | nav do strony ListMenu | paint canvas lab | strona narysowana; memories 1909/1910 read ok |
| V-NEG | negative control | czysty E144 | próba odpalenia funkcji nieportowanej | brak handlera | clean fail (brak ścieżek-phantom) |

Zasady wspólne: każdy scenariusz ma pin obrazu wejściowego (SHA-256), zapis trace do archiwum
pakietu i binarny werdykt (PASS/FAIL) — bez „wygląda OK". Scenariusze V-F1..V-F3a mają status L2;
L3 jest jawnie `not_proven` (sekcja 1.4). Scenariusze nie testują jakości obrazu/AF — tylko ścieżki
sterowania (granica dowodu, §0.1).

---

# 7. Bezpieczeństwo (wiążące)

## 7.1. Status normatywny tej specyfikacji

1. **Ta specyfikacja jest OFFLINE/RESEARCH.** Obejmuje: analizę statyczną, dekodowanie, emulację,
   generowanie artefaktów badawczych i dokumentację. Nie obejmuje i **nie autoryzuje** żadnej
   operacji na fizycznym aparacie, obiektywie, akumulatorze ani jakimkolwiek urządzeniu.
2. **Jakakolwiek operacja na sprzęcie wymaga osobnej, formalnej decyzji safety** (odpowiednik
   reżimu OMDS-SFTY w repo `D:\AI\re 100-400`): osobny dokument, osobne bramki (HW-GATE-0, WS6-2),
   osobne upoważnienie właściciela ryzyka. **Nic w tym pakiecie takich bramek nie otwiera** — ani
   fakt istnienia specyfikacji, ani jej zatwierdzenie, ani wynik testów emulatorowych.
3. Wszystkie artefakty wygenerowane na podstawie tej specyfikacji są oznaczane
   **`RESEARCH_SKELETON_ONLY`** (nazwa pliku + wnętrze kontenera + sidecar) i trzymają się poza
   jakąkolwiek ścieżką importu do urządzenia. Zapis na dysku nie jest dowodem bezpiecznej instalacji.
4. **Zakazane bez względów (nawet „tylko żeby sprawdzić"):** flash (`OMDS-SFTY-001`-analog), cross-flash
   (`OMDS-SFTY-002`-analog), uruchamianie natywnych updaterów producenta (`OMDS-SFTY-003`-analog),
   zapis do NVRAM/EEPROM korpusu, wywoływanie ścieżek MDN/EEPROM-clear (Z2), testy aktuatorów
   (IBIS/AF/migawka). Nowa prośba ani `--dry-run` nie uchylają zakazu.
5. **Granica dowodu:** L0/L2 (kontener/emulator) nie dowodzą zachowania urządzenia. Każde twierdzenie
   o zachowaniu sprzętowym w dokumentach tego pakietu jest `not_proven` do odwołania (sekcja 1.4).

## 7.2. Zasady fail-closed narzędzi portowych

- Nieznana forma instrukcji (R-ISA-1), nieznane pole NVRAM (WS2-2), nieuzgodniony zakres patcha
  (R-PKG-1) → **stop generacji z błędem**, nigdy „best effort".
- Builder odmawia wygenerowania obrazu, jeśli: manifest zakresów niekompletny, suma kontrolna nie
  przeliczona, którykolwiek zakres dotyka Block 0 boot/recovery bez formalnej decyzji (Z3), którykolwiek
  wywołanie kodu wchodzi w blacklist MDN (WS6-3).
- Determinizm: ten sam input → byte-identical output (wzorzec: reproduce.py inwentarza [INV §0]).

---

# 8. Otwarte pytania (gaps inwentarza + luki priors + konflikty)

Numeracja Q1..Q15; każdy ma właściciela-WS i koszt wstępnego rozstrzygnięcia.

**Z inwentarza (INV §6):**

- **Q1 — E144 Wi-Fi chip number** (INV §6.1): payload 0x0106 kompresowany inaczej; rozpakować
  squashfs @0x216cfe0, zidentyfikować CYWxxxx. WS0-5. Koszt: 2–4 h. Blokuje F5.
- **Q2 — E148 app_check_mode row count** (INV §6.2): count-compare niezlokalizowany. WS0-2. 2–5 h.
  Blokuje tylko A.
- **Q3 — Settings-descriptor table** (INV §6.3): 20-bajtowy kształt nieznaleziony na obu buildach.
  WS0-4. 4–10 h. **Twarda blokada B+ (memories 1909/1910).**
- **Q4 — Sensor/ISP differences** (INV §6.4): bajtowo niewidoczne. Niezałatwialne statycznie
  w pełni; granica dowodu dla F2/F6 — PARKED z regułą fail-closed (Z11).
- **Q5 — Mode-id set diff drugiej tabeli** (0x477b78/0x475110) (INV §6.5): scany podatne na urwanie.
  WS0-12. 3–6 h. Surowe dane dla B+.
- **Q6 — CJK/jpn resource diff** (INV §6.6): zdekodowane, nieporównane jako tekst. WS0-9. 2–4 h.
- **Q7 — E144 updater acceptance rules** (INV §6.7/§5): kod walidacji nieprzeczytany. WS0-3. 3–6 h.
  Blokuje A; normatywnie dla WS6. Sub-pytanie (review 2026-11-12): czy E144 trzyma jeden obraz
  czy banki A/B i gdzie updater zapisuje (wpływa na strategię A i §7 rescue) — evidence w repo
  nie rozstrzyga.
- **Q8 — 0x0106 record-level** (NN models, rootfs detail) (INV §6.8): inwentaryzacja per rekord.
  Dotyczy F2 (warunek LUT/ISP). 4–10 h (częściowe 1–2 h na sam warunek F2).

**Z priors (ślad do odzyskania — handoff nie podał ścieżek artefaktów; WS0-8/WS0-1):**

- **Q9 — RAM size konflikt:** [PRIOR] „1 GB RAM" vs repo `board.mjs` DRAM end 0xb0000000 (256 MiB)
  [INV §2]. Rozstrzygnąć probe `dramSize` w emulatorze (REPO: emu port rules, dramSize fact). 1–2 h.
- **Q10 — AI subject detection:** [PRIOR] „impossible on this platform (no CPU3/AI DMA)" vs E148
  z NN models w 0x0106 i wierszami Subject Detection AF (4723–4744) [INV: res_enu_diff_added.tsv].
  Konflikt oznacza prawdopodobnie: claim dotyczy replikacji ścieżki OM-1 (CPU3/AI DMA), a E148 robi
  detekcję inaczej (A53/NN). Do rozstrzygnięcia zanim ktokolwiek zacznie portować detekcję. 2–5 h.
- **Q11 — CYW43439 vs 5 GHz** (konflikt (c)): om-c wycofał 5 GHz z OM-3 (CYW43439) [REPO: om-c
  tabela features; §3.4], ale listuje OM-5 1.2 jako `wifi-5ghz`; E148 (OM-5 II) = CYW43439 [INV §2].
  Napięcie rozstrzyga WS0-5 + om-c release notes; **port nie planuje 5 GHz** niezależnie od wyniku.
- **Q12 — NVRAM drift table** (Z1): odzyskanie śladów [PRIOR] i re-weryfikacja bajtowa. WS0-8.
  3–6 h. **Blokada F3/A.**
- **Q13 — PMIC map** (Z4): skan driverów charger/PD w 0x0106 i main. WS0-10. 2–5 h. Blokuje F9.
- **Q14 — Homology liczby** — [PRIOR] „~82% shared strings, 9122 new in E148" vs inwentarz:
  1,196 nowych tekstów enu / 896 nowych sidów (per-sid), 436 znikło [INV §3]. Różnica metodyki
  (prawdopodobnie content-keyed all-languages vs enu) — ustalić, zanim liczby wejdą do dalszych
  dokumentów. **Właściciel: WS0** (przy odzyskiwaniu śladów [PRIOR] — WS0-8/WS0-1). 1 h.
- **Q15 — „Micro-USB vs USB-C"** (konflikt (a)): **ROZSTRZYGNIĘTY przez inwentarz** — oba korpusy
  mają ten sam DWC3-class IP i szablony bcdUSB 0x0300; E148 dodaje jedynie wiersze menu USB
  (4569/4570/4748) [INV §2]. Priors-claim nieaktualny; zostaje tylko pytanie o **kontroler ładowania**
  (Q13).

**Uwaga o ISA (konflikt (b), R-ISA-1):** repo dekoduje MN10300 dla korpusów [REPO:
docs/mn10300-isa-spec.md]; „ARM Thumb-2" z repo obiektywów dotyczy kontrolerów obiektywów; payload
Linux 0x0106 = 32-bit ARM [REPO: om-c §7.3]. Formalne potwierdzenie spójności dekodowania z mapą
parowania — WS0-1 (koszt 1–2 h). Dopóki nie potwierdzone: R-ISA-1 fail-closed.

---

# 9. Traceability

## 9.1. Reguły

1. Każde twierdzenie o bajtach w tym dokumencie ma cytowanie jednego z typów:
   `[INV §n]` / `[INV: <plik evidence>]` / `[REPO: <ścieżka w tym clone>]` / `[PRIOR]` /
   `[I]/[D]/[X]/[?]`.
2. **[PRIOR]** = raport priors nad `D:\AI\re 100-400` (agent read-only). Handoff **nie zawierał
   ścieżek artefaktów priors** — do czasu odzyskania śladu (WS0-8/WS0-1) twierdzenia [PRIOR] są
   hipotezami roboczymi i **nie mogą być podstawą patcha**. Odtworzenie śladu ma priorytet w WS0.
3. Plik evidence są regenerowalne: `py -3.11 analysis/om5_port_inventory/reproduce.py`; piny
   SHA-256 plików evidence: `analysis/om5_port_inventory/evidence/evidence.sha256` [INV §0].

## 9.2. Mapa kluczowych twierdzeń → dowody

| Twierdzenie (skrót) | Dowód |
|---|---|
| Model nibble 1440/1480, BCD 0x1200/0x1100, 5 bloków sum32+head/tail | [INV §1] |
| Rozmiary bloków i delty (−1.44 MB, −3.15 MB, +3.15 MB, 0x010e 115,500 B) | [INV §1] |
| BCS byte-identical, spans A/B same offsets, base 0x60021020 | [INV §1; REPO: finding 65] |
| 22.05 % equal expanded; 1,243 regiony | [INV §1; INV: expanded_main_diff_regions.csv] |
| 9,503,564 par instrukcji; kinship 212/224 guard | [INV §4; REPO: emu/bin/port.mjs; INV: kinship_samples.csv] |
| Zero ListMenu w E144; klasy E148 @0x11bcc8c/0x11bfa24/0x11c3798/0x11ca476; Menu_Viewer współistnieje | [INV §3] |
| 4013 vs 4909 sidów; +896 append, 0 usunięć, 621 in-place; 1196/436 text-keyed | [INV §3; INV: res_enu_diff_removed.tsv (pusty, SHA-256 e3b0c442…)] |
| sidy funkcji katalogu (4013–4908 rozkład) | [INV: res_enu_diff_added.tsv; res_strings_E144_enu.tsv; res_strings_E148_enu.tsv] |
| Kensus per-feature (GND 0→15 itd.) | [INV: feature_census_enu.tsv; feature_census_ascii.tsv] |
| app_check_mode E144 = 667 @0xbab574, cmp @0x8fe0da; E148 UNRESOLVED | [INV §3; INV: scan_appcheck_E1xx.tsv; REPO: om-c §3.6] |
| USB ten sam IP + deskryptory bcdUSB 0x0300 (164/224) | [INV §2] |
| CYW43439 E148; E144 chip UNRESOLVED; kernel 5.10.197 | [INV §2; REPO: om-c §7.3] |
| Panels/RAM/MMIO/GPS/Exif-name | [INV §2; REPO: emu/src/fw/models.mjs; finding 65] |
| Updater E143 0x3202/0x3210–0x3213/0x3211; E144 UNRESOLVED | [INV §5; REPO: oly-fw-analysis r.16] |
| Repack precedens (58 B packed diff + tail sum32; well-formedness only) | [REPO: analysis/nd128/README.md] |
| Add-row pipeline (page record, row-order, 6 tabel, bound, SettingController sloty) | [REPO: analysis/om-c-firmware/README.md §3.6] |
| ListMenu memories 1909/1910, vtable slot 8 | [REPO: docs/model-survey.md finding 65] |
| Port chain E148 via E144 (98/117 overrides, 900 addr, 49 unmapped) | [REPO: finding 65; emu/out/port/E148/port.json] |
| NVRAM gyro drift; MDN destructive; recovery Block 0; effort priors; model-ID gate updaterra | **[PRIOR]** — ślad do odzyskania (WS0-8/WS0-3) |
| ISA MN10300 (korpusy) / ARM (0x0106 Linux) / Thumb-2 (obiektywy — inne produkty) | [REPO: docs/mn10300-isa-spec.md; om-c §7.3; kontekst D:\AI\re 100-400 — PRIOR konflikt (b)] |

## 9.3. Zgodność tej specyfikacji z regułami raportowania

- Twierdzenia „brak" są formułowane jako **bounded absence** z listą tego, czego **nie testowano**
  (np. Q3: kształt 20 B nieznaleziony regułą biegów ≥200 — nie testowano innych kształtów; Q4:
  brak stringów part-number ≠ brak różnic sensora).
- Liczby w tym dokumencie pochodzą z plików evidence lub są jawnie oznaczone [I] (szacunki h/tokeny
  to planistyczne [I], nie pomiary).
- Twierdzenia [PRIOR] nigdy nie są mieszane z [INV] bez etykiety.

## 9.4. Checklisty bramek i szablon decyzji safety (do wykorzystania, nie do wypełnienia teraz)

### G-PKG (każdy artefakt) — checklist

```
[ ] manifest pokrywa 100% różnic bajtowych (byte-diff output vs input ≡ manifest)
[ ] wszystkie zakresy mają before-hash zgodny z bazą (pin SHA-256 [INV §1])
[ ] sum32 wszystkich 5 bloków przeliczony i zgodny; head[:28]==tail[:28] każdego bloku
[ ] Model nibble = 1440; BCD = 0x1200 (albo jawna, uzasadniona decyzja strategii A z bramką)
[ ] nazwa pliku zawiera RESEARCH_SKELETON_ONLY; sidecar *.sha256 present
[ ] build powtórzony drugi raz → byte-identical (determinizm)
[ ] nazwa NIE sugeruje przydatności instalacyjnej; brak katalogu DCOLYMP/
```

### G-NVRAM (F3 pełny, A) — checklist

```
[ ] każdy odczyt NVRAM w transplantowanym module ma wpis w nvram_field_map.csv
[ ] zero pól status UNKNOWN dotkniętych przez moduł
[ ] V-F3b (albo analog) PASS: odczyty na fixtures E144-layout w sane ranges
[ ] zero instrukcji zapisu do NVRAM/EEPROM w wygenerowanym kodzie
```

### HW-GATE-0 — szablon decyzji safety (SZKIELTON; wypełnienie = osobna formalna decyzja
poza tym pakietem, z upoważnieniem właściciela ryzyka; **obecnie: ODMOWA**)

```
DECYZJA SAFETY HW-GATE-0 (szablon)
Data / decydent / zakres operacji (odczyt diagnostyczny | flash | cross-flash | inny):
Obraz (SHA-256) i manifest patchy:
Analiza ryzyk (odnośnik do risks.md wersja):
Plan ratunku (SPI rescue: sprzęt, procedura, kto):
Testy offline wykonane (L0/L1/L2, wyniki):
Pozostałe not_proven (jawna lista):
Bramki wyższe (STOP/BLOCKED) — sprawdzone: [ ] OMDS-SFTY-analogi nienaruszone
Wniosek: ZEZWALENIE (warunki) / ODMOWA (powody)
Podpisy / zatwierdzenia:
```

Zasada: **brak wypełnionego HW-GATE-0 = stan domyślny „wszystko offline"**. Wynik testów
emulatorowych ani dojrzałość artefaktów nie tworzą przesłanki do zezwolenia (sekcja 7.1).

---

# 10. Definition of Done (DoD) dla całego portu i dla etapów

## 10.1. DoD etapu (wave 1, strategia B)

1. WS0 minimum: WS0-1 (ISA) i WS0-8 (NVRAM drift) mają status RESOLVED albo PARKED z powodem.
2. Każda funkcja katalogu wave 1 (F1, F7, F4, F8, F2, F3-prezentacyjna) ma: moduł zlokalizowany (T1),
   sid map (T2), patch manifest (T4), V-scenario PASS, jawne `not_proven` dla L3.
3. `modelcheck E144` green na każdym pośrednim stanie (regresja).
4. Artefakty: `*.RESEARCH_SKELETON_ONLY.BIN` + manifest + sha256, deterministyczne.
5. risks.md zaktualizowany per funkcja; bramki G-* rozliczone.
6. Raport końcowy pakietu: klasyfikacje funkcji (przejścia klas na dowodach), liczby (zakresy patchy,
   sidy, bound rejestru), granice (co zostało nieweryfikowalne statycznie).

## 10.2. DoD wave 2 (B+)

1. WS0-4 RESOLVED (settings store), WS3 exit criteria spełnione (V-LM PASS).
2. Funkcje przeniesione na ListMenu z memories 1909/1910 działającymi w emulatorze.
3. Cost-benefit rozliczony: czy add-row na ListMenu rzeczywiście tańszy (pomiar per wiersz) — decyzja
   o kontynuacji/zamknięciu B+.

## 10.3. DoD port „zakończony"

Port uznajemy za zakończony wyłącznie po spełnieniu 10.1 (i opcjonalnie 10.2). **„Zakończony" nie
oznacza „działa na korpusie"** — poziom L3 pozostaje poza DoD z definicji (sekcja 1.4, sekcja 7).
Raport końcowy musi zawierać sekcję „Czego ta praca nie dowodzi" z listą bounded absence aktualną
na dzień zamknięcia.

---

**Koniec proposal.md. Szczegółowa macierz ryzyk: risks.md.**




