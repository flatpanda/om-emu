# Potwierdzenie zewnętrzne: om-c-firmware dbv0.4.0 (2026-11-11) vs niniejszy pakiet

Data: 2026-11-12. Metoda: pobranie release `dbv0.4.0` (asset `DBFirmware-macOS-AppleSilicon-0.4.zip`, 175,198,007 B) z
github.com/azqeurio/om-c-firmware; z `profiles.json` wyekstrahowano profil `om5-1.2` (features `wifi-5ghz`) i porównano
patche bajtowe z naszym obrazem. Żaden kod/narzędzie om-c nie został uruchomiony; odczyt wyłącznie jako dane
(repozytorium om-c nie ma licencji — cytowane wyłącznie fakty i adresy, atrybucja: azqeurio/om-c-firmware).

## Profil `om5-1.2`

- `source_sha256` = `a0c91f3ac7caaf0925b2af609e711183cf3b5982b3333224bcef26c0c5943d11` — **identyczny z naszym
  obrazem wejściowym** (`input_manifest.csv`), więc adresy om-c są wprost porównywalne z naszymi.
- `runtime_base` = `0x60021020` (1610747936), model_id 144 — zgodne z naszą konwencją VMA = offset bloku + 0x50000000
  dla głównego bloku (offset bloku = VMA − 0x50000000; runtime_base om-c odnosi się do bazy obrazu).

## `wifi-5ghz` — 3 patche vs nasze ustalenia

| # | Blok | Offset (blok) | Stare bajty (om-c) | Nasz blok | Werdykt |
|---|---|---|---|---|---|
| 1 | 0 | 0x1408410 (12 B) | `fc dc fc 15 53 61 1c cd af 90 00 04` | identyczne | **MATCH** — to samo okno, które zidentyfikowaliśmy jako site-A (log „ch illegal range") @`0x51408410..1b` |
| 2 | 0 | 0x140844e (6 B) | `83 8d 1d a5 0d c3` | identyczne | **MATCH** — zawiera nasz clamp `cmp 13,d1` @`0x51408451` (bajty `a5 0d c3`); patch om-c obejmuje dokładnie region sprawdzenia zakresu kanałów |
| 3 | 2 | 0x2179ce0 (rootfs, squashfs) | przepisanie rekordów `isc_olnet` | n/d (poza zakresem naszego badania statycznego bloku 0) | zgodne z naszym UNRESOLVED #2 (modyfikacja isc_olnet) |

Nowe bajty patcha 1: `fc a5 08 c2 72 a2 a5 02 c9 04 8f 24`; patcha 2: `80 24 83 8d 1d ca` (odczytane jako dane; ich
semantyka instrukcji — wymuszenie kanału 36 i obejście clampu — pozostaje naszym NOT_PROVEN, nie deasemblowaliśmy
patchowanych bajtów po zmianie).

## Potwierdzenia merytoryczne (D-level, z metadanych om-c)

1. **Radio:** om-c `detail` (KO): „CYW43455의 5GHz 펌웨어·보정값을 확인했습니다" — CYW43455 zawiera firmware i
   kalibrację 5 GHz; zgodne z naszym skanem (`cyw43455_softap/sta/mfg.bin`, evidence 09).
2. **Status sprzętowy:** `hardware_verified: false`, `release_status: HARDWARE_UNVERIFIED` — om-c też NIE potwierdza
   działania 5 GHz na urządzeniu; spójne z naszym NOT_PROVEN efektu runtime.
3. **Zakres zmiany:** `implementation: native-ap36-country-and-startup-r2` — patch obejmuje kanał 36, **country_code**
   i ścieżkę startową; potwierdza nasz UNRESOLVED #4 (regulacyjny country_code w gałęzi 5 GHz) jako realny składnik
   zmiany, nie tylko nasze przypuszczenie.

## Wnioski

- Oba punkt-site'y RTOS om-c pokrywają się bajt-w-bajt z naszymi adresami (site-A @`0x51408410`, clamp
  @`0x51408451`) — niezależna walidacja naszej analizy statycznej E144.
- Różnica zakresu: om-c edytuje też rootfs (block 2) — nasz pakiet tego nie projektował poza wskazaniem
  isc_olnet; pełny port zmiany wymaga trzeciego komponentu (isc_olnet/country).
- Nadal NOT_PROVEN: efekt runtime, country_code per region, zachowanie na urządzeniu.

Plik referencyjny zip: `refs/omc-0.4.0/dbf.zip` (poza seal; nie commitowany — 175 MB, licencja om-c nieznana).
