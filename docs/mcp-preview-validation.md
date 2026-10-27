---
title: "MCP preview 3 — walidacja, instalacja i ograniczenia"
date: 2026-10-27
tags: [abap-fs, mcp, abapgit, odata, validation]
---

# ABAP FS 2.13.2 — MCP preview 3

[Pobierz VSIX](https://github.com/scaamp/abap-fs-creation-fix/releases/tag/v2.13.2-mcp-preview.3) · [Narzędzia abapGit](version-control/abapgit.md#mcp-tools-2130-preview) · [OData V4](odata-read-tools.md) · [Historia zmian](../PATCH_CHANGELOG.md)

To pierwsze publiczne preview obejmujące osiem narzędzi abapGit, trzy narzędzia OData i osobną komendę konfiguracji credentiali Git. Zawiera poprawki tworzenia obiektów ze stabilnej 2.12.4 / fix 5. Wersje 2.13.0 i 2.13.1 były lokalnymi kandydatami; historia ich zmian jest zachowana w changelogu. To nie jest oficjalne wydanie upstream ani dowód zgodności ze wszystkimi systemami SAP.

## Wyniki lokalne

| Kontrola | Wynik i zakres |
| --- | --- |
| Testy rozszerzenia | **4462 testy / 264 pliki PASS**, w tym 83 dodatkowe testy względem fix 5 |
| Build i typecheck | `pnpm build` PASS, obejmuje compile i typecheck źródeł/testów całego workspace |
| Formatowanie | `pnpm format`, `pnpm format:check` i `git diff --check` PASS |
| Zależność API | API 9.2.0 z przypiętym patchem; **371 testów / 25 zestawów PASS** w pracach nad warstwą API; ostatnia poprawka UI nie zmieniała API |
| Źródła API | 14 kolejnych patchy źródłowych do przypiętej bazy; oddzielne poprawki XML/media, abapGit i limitów HTTP |
| Pakowanie | VSIX prerelease; bundle zgodny bajtowo ze zbudowanym i przetestowanym live runtime |
| Izolowany host | Rzeczywisty zainstalowany VSIX: nowa komenda zarejestrowana i dostępna do wyszukania, MCP udostępnia 11 nowych narzędzi; ten smoke nie wykonywał żądań SAP |
| Profil użytkownika | Proces MCP potwierdził **2.13.2**, `development=false`, `logging=false`; testy live poniżej dotyczą tej instalacji |

Kod wykonywalny, manifest funkcji i patch API paczki do pobrania są zgodne bajtowo z kandydatem zainstalowanym do testów live. Po uzupełnieniu dokumentacji publikacyjnej ponownie spakowano VSIX i sprawdzono paczkę w izolowanym hoście. Bieżący checksum znajduje się w **SHA256SUMS.txt** dołączonym do wydania.

Kod i dokumentacja odpowiadają opublikowanym źródłom; uzupełnienie raportu nie zmieniło przetestowanej logiki. Pliki profilu, poświadczenia, prywatne ślady SAP i lokalna konfiguracja F5 nie są publikowane.

## abapGit — rzeczywisty test przez MCP

Użytkownik zatwierdził nową, pustą klasę testową w swoim środowisku nieprodukcyjnym i eksport wyłącznie jej plików. Utworzenie i aktywacja zostały potwierdzone odczytem active; diagnostyka i ATC nie wykazały ustaleń. Klasa nie ma metod, uruchamialnego interfejsu ani dostępu do danych biznesowych.

| Krok | Wynik |
| --- | --- |
| repositories, capabilities, remote_refs | PASS, istniejące repozytorium i branch odczytane z SAP |
| status i diff | PASS, dokładnie dwa nowe pliki klasy: źródło i XML, bez innych zmian/usunięć |
| prepare_commit | PASS po skonfigurowaniu credentiali w tym samym profilu; sprawdzono dokładne pliki, treść, tożsamości commita, komunikat i remote SHA |
| commit_and_push | Wywołano raz z zatwierdzonym reviewId; backend odpowiedział `accepted` |
| Niezależne potwierdzenie | API GitHub i ponowny odczyt refs potwierdziły nowy commit, właściwego rodzica, komunikat i dokładnie dwa dodane pliki |
| Kontrola treści | Źródło zgodne bajtowo; XML zgodny po uwzględnieniu UTF-8 BOM w serializacji backendu, Git blob hashes zgodne |
| Stan po eksporcie | staged=0, unstaged=0, ignored=0; jedna próba w lokalnym rejestrze operacji |

Bezpośrednie `remoteAfter` w odpowiedzi POST wskazywało jeszcze stary SHA. Endpoint kończy eksport asynchronicznie: **`accepted` nie dowodzi końcowego commita**. Potwierdzenie uzyskano oddzielnym odczytem, bez ponawiania POST. Rejestr operacji przechowuje migawkę tej próby, a nie autorytatywną historię Git.

Pierwotna blokada `AUTH_REQUIRED` wynikała z braku credentiali Git w magazynie ABAP FS, mimo działającego publicznego odczytu repozytorium. Rozwiązała ją komenda konfiguracji; token wpisał sam użytkownik. Nie przenoszono sekretów z innych aplikacji ani nie podawano ich modelowi.

Nie testowano tu zmian binarnych, usunięć ani wszystkich wersji backendu. Backendowy odczyt serializacji tekstowej może ukrywać BOM; ten preview nie obiecuje przeglądu bajtowego dowolnych plików binarnych. Nie ma osobnego commita bez push, pełnego Git fetch, merge, zmiany brancha ani importu SAP. Nie wykonywano pull/importu, zwalniania transportów ani automatycznego usuwania fixture po teście.

## OData — rzeczywiste uwierzytelnione odczyty

Adres runtime wyznaczono z aktywnego, opublikowanego bindingu. Użyto istniejącego połączenia Cloud OAuth tego samego origin; nie odczytywano credentiali przez model i nie sterowano przeglądarką do wywołań HTTP.

| Krok | Wynik |
| --- | --- |
| resolve_service | PASS: istniejący opublikowany binding V4 i referencja powiązana z połączeniem |
| get_metadata | **HTTP 200**, XML CSDL 4.0, trzy entity sets |
| query | Trzy kolekcje, każda `top=1`, select wyłącznie kluczy: **HTTP 200**, po jednym rekordzie |
| query z expand | Jeden rodzic i dwie bezpośrednie kolekcje dzieci; osobne select kluczy i top=1: **HTTP 200**, po jednym dziecku |
| Błędna referencja | Oczekiwany `SERVICE_EXPIRED` |
| Nieznane pole | Oczekiwany `UNKNOWN_PROPERTY` |

Nie zapisywano wartości danych biznesowych w raporcie. Nie wykonywano OData write, publikacji usługi, zmiany DCL ani automatycznego stronicowania. Test potwierdza dostęp bieżącego użytkownika do jednej usługi, nie izolację autoryzacji między użytkownikami ani pełny scenariusz biznesowy RAP.

OData preview obsługuje V4 XML CSDL, już połączony profil Cloud OAuth i ten sam origin. Nie potwierdzono V2, ECC, innych metod logowania lub oddzielnego hosta API. Nie zaimplementowano filtrów, kluczowanych ścieżek, akcji/funkcji, draft, batch, next_page ani zapisów. Limit odpowiedzi wynosi 512 KiB; przekierowania są wyłączone. Decimal/Int64 wymagają bezpiecznej reprezentacji string IEEE754.

## Instalacja i pierwszy test

1. Pobierz VSIX z wydania preview 3 i sprawdź checksum. Zainstaluj go w wybranym profilu przez **Extensions → Install from VSIX**.
2. Uruchom **Developer: Reload Window** i ponownie połącz MCP. Sam restart extension hosta może pozostawić stare deklaracje narzędzi w oknie; diagnostyka powinna wskazywać 2.13.2, a lista MCP zawierać 11 nowych narzędzi.
3. Połącz własny system SAP. Dla abapGit uruchom **ABAP FS: Configure abapGit credentials** z palety, wybierz repozytorium i podaj login/token wyłącznie w formularzu rozszerzenia. Komenda niczego nie eksportuje ani nie importuje. Sukces potwierdza zapis credentiali, nie ich uprawnienia na serwerze Git.
4. Zacznij od odczytów abapGit: repositories → capabilities → status → wybrany diff → remote_refs. Export wymaga osobno przejrzanych plików i autoryzacji; nie używaj automatycznego stage-all.
5. OData: resolve istniejącego bindingu → get_metadata → query top=1 z jawnym select. Dla expand wybierz wyłącznie nawigacje i klucze zwrócone przez metadata. Nie zgaduj URL.
6. Przy błędzie zapisz oczyszczony kod/status i zakres testu. Nie wklejaj tokenów, cookies ani poufnych odpowiedzi. Nie ponawiaj niejednoznacznego pushu.

## Rollback

Zainstaluj zachowany VSIX 2.13.1 lub [stabilny fix 5 / 2.12.4](https://github.com/scaamp/abap-fs-creation-fix/releases/tag/v2.12.4-adt-creation-fix.5), przeładuj okno i połączenie MCP. Nie używaj abapGit Pull jako rollbacku rozszerzenia. Reinstalacja nie cofa zdalnego commita ani nie usuwa obiektów SAP. Sprzątanie fixture i ewentualny commit usuwający wymagają oddzielnego przeglądu.
