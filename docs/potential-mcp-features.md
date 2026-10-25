---
title: "Potencjalne rozszerzenia MCP — ocena wartości i wykonalności"
date: 2026-10-25
status: proposal
tags: [mcp, abap-cloud, rap, feature-assessment]
---

# Potencjalne rozszerzenia MCP

Raport ocenia propozycje dalszego rozwoju niezależnej dystrybucji ABAP FS. Punktem odniesienia jest **wersja 2.12.4 / ADT creation fix 5**, commit `8f939dfeeff3b5bf73a9c1b5973896eaae28dd4d`.

**To propozycje, nie katalog dostępnych funkcji ani zatwierdzony plan wdrożenia.** Nazwy nowych narzędzi są robocze. Analiza opiera się na kodzie rozszerzenia, bibliotece abap-adt-api 9.2.0, dostępnym katalogu MCP i dokumentacji SAP. Nie wykonano prób nowych operacji w SAP. Dostępność odpowiednich kontraktów ADT i uprawnień w konkretnym systemie wymaga osobnej weryfikacji.

Rekomendowana kolejność nowych funkcji: **API Inspector → OData Executor w trybie odczytu → RAP Metadata Inspector**. Równolegle można rozszerzać istniejącą diagnostykę i wykorzystać już zaimplementowane API. Stabilne wydanie v5 powinno pozostać niezależne od prac nad nowymi funkcjami; rozwój należy prowadzić na osobnej gałęzi, a wydane paczki zachować bez podmiany.

## Narzędzie a orkiestracja

Sekwencja „edytuj → sprawdź składnię → aktywuj → uruchom ATC → popraw błędy” to przede wszystkim workflow agenta lub Skill, ponieważ odpowiednie narzędzia już istnieją. Nowe narzędzie ma sens, gdy udostępnia brakującą operację, wiarygodny kontrakt danych albo wynik, którego obecne interfejsy nie zwracają w użytecznej postaci.

Funkcja w interfejsie VS Code, metoda w bibliotece ADT i narzędzie wystawione przez MCP to różne poziomy dostępności. Istnienie jednej z nich nie dowodzi, że agent może skorzystać z pozostałych. Uporządkowany odczyt danych już dostępnych w kodzie nadal może mieć dużą wartość, ale powinien być opisany jako rozszerzenie interfejsu, a nie nowa możliwość serwera SAP.

## Porównanie propozycji

Wartość i złożoność poniżej są oceną projektową, nie pomiarem ani zobowiązaniem terminowym. „Zbadać” oznacza potrzebę potwierdzenia kontraktu backendu przed implementacją.

| Propozycja | Potencjalna wartość | Złożoność / niepewność | Rekomendacja |
| --- | --- | --- | --- |
| `abapfs_inspect_api` | Bardzo wysoka: mniej błędnych wywołań klas i metod | Średnia–wysoka; kompletność metadanych i wersje SAP | **P1: najpierw zbadać i zbudować mały odczytowy MVP** |
| `abapfs_execute_odata_request` | Bardzo wysoka: rzeczywiste testy opublikowanego RAP/OData | Średnia dla odczytu, wysoka dla zapisów i autoryzacji | **P2: zacząć od GET i `$metadata`** |
| `abapfs_get_rap_metadata` | Wysoka: mniej ręcznego łączenia CDS/BDEF/usług | Wysoka; wiele warstw i wersji źródeł | **P3: model deklaratywny, jawnie częściowy** |
| `abapfs_apply_patch` | Wysoka przy zmianach współbieżnych | Wysoka; konflikty, blokady i częściowe zapisy | **Rozwijać istniejące mechanizmy, nie budować drugiego silnika od zera** |
| `abapfs_inspect_package_contract` | Wysoka przy diagnozie ABAP Cloud | Średnia dla odczytu, wysoka dla oceny naruszeń | **Rozważyć po inspectorach; oddzielić dane od wniosków** |
| `abapfs_change_package_assignment` | Średnia–wysoka w porządkowaniu repozytorium SAP | Średnia; istnieje API, pozostają testy i ograniczenia | **Dobry kandydat na małe rozszerzenie MCP, jeśli potwierdzi się potrzeba** |
| `abapfs_probe_adt_capabilities` | Wysoka praktycznie, częściowo już dostępna | Mała–średnia dla rozszerzenia diagnostyki | **Rozszerzyć obecne narzędzia zamiast dodawać duplikat** |
| `abapfs_get_cds_execution_plan` | Wysoka dla konkretnych problemów wydajnościowych | Wysoka; backend, baza, uprawnienia i kontekst wykonania | **Odłożyć do potwierdzenia diagnostyki SQL/HANA** |
| RAP EML Executor | Potencjalnie wysoka dla testów logiki BO | Bardzo wysoka; niepotwierdzona ścieżka wykonania | **Osobne badanie; nie pierwszy etap rozwoju** |

## 1. ABAP Cloud API Inspector

**Co daje:** maszynowo czytelną informację o rzeczywistym API: klasie/interfejsie, dostępnych metodach, parametrach, typach i dopuszczalności użycia w określonym kontekście. Agent może sprawdzić wywołanie przed wygenerowaniem kodu.

Obecny odczyt źródeł i analiza relacji pomagają znaleźć deklaracje oraz komponenty. Nie stanowią jednak kompletnego kontraktu sygnatur i statusu release w jednej odpowiedzi. To rzeczywista luka w interfejsie dla agenta.

**MVP:** jedna wskazana klasa lub interfejs, jawny system i wersja active/inactive; publiczne metody wraz z rodzajem wywołania, kierunkiem parametrów, opcjonalnością i referencjami typów. Do tego dostępne kontrakty release, ich stan i widoczność. Dziedziczenie oraz rozwijanie zależnych typów powinny mieć ograniczony, jawny zakres.

Stan API nie powinien być pojedynczym, pozbawionym kontekstu `RELEASED`. Znaczenie mają kontrakty, np. C1 i C2, oraz widoczność dla Cloud Development lub Key User Apps. Brak dostępu do metadanych oznacza **unknown**, nie automatycznie „unreleased”. Odpowiedź powinna podawać pochodzenie danych: metadane backendu albo analiza źródła, URI oraz wersję źródła.

**Warunek rozpoczęcia:** potwierdzić dostępne odczyty na rzeczywistym systemie, w tym API dopuszczone, niedopuszczone, z dziedziczeniem i z odmową dostępu. Porównać wynik z właściwościami ADT. Nie deklarować pełnej obsługi ECC i ABAP Cloud na podstawie jednego backendu.

Źródło znaczenia stanów i kontraktów: [SAP — Released APIs](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/released-apis?locale=en-us).

## 2. OData HTTP Executor

**Co daje:** agent otrzymuje status HTTP, odpowiedź, błędy OData i czas rzeczywistego wywołania usługi. Umożliwia weryfikację kontraktu RAP po publikacji, bez ręcznego przepisywania wyników z przeglądarki.

Obecna [komenda testowania bindingu](../client/src/commands/testServiceBinding.ts) pobiera informacje o usłudze i oferuje otwarcie adresów w przeglądarce. To przydatna podstawa, ale nie ogólny klient OData dostępny jako MCP.

**MVP:** wyłącznie odczyty dokumentu usługi, `$metadata` i danych wskazanej usługi. URL należy ustalić z rzeczywistych metadanych bindingu; nie zgadywać go z nazwy. Encje, np. hipotetyczne `/Invoice`, muszą być potwierdzone w `$metadata`. Potrzebne są limity odpowiedzi, stronicowanie i usuwanie credentiali z wyników. Nie powinien to być nieograniczony proxy HTTP do dowolnego adresu.

**Najważniejsza niewiadoma:** działające połączenie ADT nie gwarantuje dostępu do biznesowego endpointu OData. Sesja, host, role biznesowe lub konfiguracja komunikacji mogą być inne. Trzeba ustalić wspierany sposób uwierzytelnienia konkretnej usługi, bez ujawniania ani kopiowania tokenów do modelu.

Zapisy to osobny etap: CSRF dla właściwej usługi i sesji, aktualny ETag/`If-Match`, kontrola autoryzacji i jednoznaczny zakres operacji. Utrata odpowiedzi na POST/action wymaga odczytu i uzgodnienia stanu, nie ślepego ponowienia. Narzędzie nie powinno samo publikować bindingu, aby wykonać test.

**Warunek rozpoczęcia:** potwierdzić odczyt istniejącej usługi oraz zachowanie przy braku uprawnień. Dopiero potem projektować mutacje.

Kontekst autoryzacji: [SAP — Authorization Basics](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/authorization-basics), [Communication Management](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/communications-operations-communication-management).

## 3. RAP Metadata Inspector

**Co daje:** spójny obraz encji, kluczy, associations/compositions, projekcji, actions, validations, determinations i draft, zamiast ręcznego składania wielu plików przez agenta.

Istnieją odczyty źródeł, elementów CDS i [analiza relacji obiektów](../client/src/services/lm-tools/relationAnalysisTool.ts). Brakuje połączenia ich w model RAP z informacją o kompletności i źródłach dowodów.

**MVP:** analiza wskazanego modelu z konsekwentnym wyborem active albo inactive. Łączyć CDS i BDEF bazowy z projekcjami oraz deklaracją usługi. Zwracać odwołania do źródeł i jawne luki, np. brak BDEF lub niedostępne metadane.

**Ograniczenie:** deklaracja validation lub determination nie dowodzi, że jej implementacja działa poprawnie. Model źródłowy, kontrakt wystawiony przez `$metadata` i zachowanie runtime muszą być rozróżnione. Odczyt nie zastępuje aktywacji, ABAP Unit ani testu OData.

**Rekomendacja:** trzeci priorytet. Najpierw mały, weryfikowalny model deklaratywny; pełną semantykę RAP rozszerzać dopiero według konkretnych przypadków użycia.

## 4. Conflict-Safe ABAP Patch Engine

**Co daje:** edycję określonego elementu, np. metody, z kontrolą wersji i dokładnym raportem skutków. Wartość rośnie przy współpracy kilku osób lub agentów.

Nie zaczynamy od zera. [replaceStringTool](../client/src/services/lm-tools/replaceStringTool.ts) sprawdza jednoznaczność dopasowania, serializuje zapisy dla obiektu i weryfikuje źródło nieaktywne po zapisie. [Assisted apply](../client/src/services/repositoryWorkflow/assistedApplyService.ts) sprawdza hashe źródła i celu względem przejrzanego planu. Jest też [narzędzie zastosowania obiektu workflow](../client/src/services/lm-tools/repositoryWorkflowApplyTool.ts). Nie są one jednak równoważne ogólnemu `replace_method` z kontrolą rewizji.

**MVP:** jeden obiekt i jedna konkretna wersja źródła, podgląd diffu, oczekiwany hash/rewizja, blokada SAP, ponowny odczyt po uzyskaniu blokady, sprawdzenie konfliktu i dopiero zapis. Kontrola wykonana jedynie przed blokadą nie zamyka okna wyścigu. Edycja metody wymaga wiarygodnego rozpoznawania struktury ABAP, nie samego regexu.

**Ograniczenie:** lokalna kolejka nie koordynuje wszystkich procesów i developerów. Zapis wielu obiektów nie powinien być obiecywany jako atomowy bez odpowiedniego kontraktu backendu. Raport musi wskazywać częściowe zapisy i stan wymagający ponownego odczytu.

**Rekomendacja:** rozwijać istniejącą ścieżkę. W pierwszym etapie pojedynczy obiekt; bez automatycznej aktywacji i własnego drugiego mechanizmu transportów.

## 5. Package Contract Inspector

**Co daje:** wyjaśnienie ustawień pakietu i dostępności zależności: wersji języka, rejestrowania zmian, komponentu, package interfaces i use accesses.

W v5 diagnostyka tworzenia już odczytuje `recordChanges`. Dalszy inspector ma sens, jeśli dostarczy także relacje i kontrakty przydatne przy analizie zależności, a nie tylko drugi sposób pokazania tych samych atrybutów.

**MVP:** odczyt konfiguracji pakietu, interfejsów, dostępów i komponentu z odwołaniami do źródeł. Osobno prezentować dane, wnioski i rzeczy nieweryfikowane.

**Ograniczenie:** klasyczne package checks, kontrakty release API i relacje komponentów Cloud nie są jednym mechanizmem. Sam odczyt pakietu nie dowodzi wszystkich naruszeń; ocena zgodności może wymagać kontroli backendu lub ATC. Pojedynczej flagi, pustej listy transportów ani HTTP 403 nie należy traktować jako kompletnej diagnozy.

**Rekomendacja:** wartościowe rozszerzenie po inspectorach API/RAP, jeśli pojawią się konkretne problemy zależności. Kontekst: [SAP — Software Component Dependencies](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/software-component-dependencies).

## 6. Change Package Assignment

**Co daje:** kontrolowane przenoszenie istniejącego obiektu do innego pakietu, z preview i wynikiem odczytu po operacji.

Biblioteka abap-adt-api zawiera już `changePackagePreview` oraz `changePackageExecute`: [pinned ADTClient](https://github.com/marcellourbani/abap-adt-api/blob/d8d0bd91d40545c8ad8ee3d907254b78b0cbb861/src/AdtClient.ts). Główna praca to integracja MCP, walidacja parametrów i testy, a nie wymyślanie nowej reprezentacji ADT.

**MVP:** preview dla jednego obiektu, jawny pakiet docelowy, uzgodniony transport tylko wtedy, gdy jest wymagany, wykonanie zaakceptowanego zakresu i odczyt potwierdzający przypisanie.

**Ograniczenie:** zmiana komponentu, reguł języka lub widoczności zależności może być zabroniona. Narzędzie nie powinno samodzielnie zmieniać ustawień pakietu, obniżać wersji języka ani tworzyć transportu, aby obejść odmowę SAP.

**Rekomendacja:** dobry, relatywnie ograniczony projekt, jeśli mamy rzeczywisty przypadek migracji. Samo istnienie metod biblioteki nie potwierdza wykonania we wszystkich systemach.

## 7. ADT Capabilities Probe

**Co daje:** informację, które kontrakty są reklamowane przez backend i które operacje faktycznie zostały sprawdzone. Nasze doświadczenia z mediatypami i pakietami pokazują dużą wartość takiej diagnostyki.

Znaczna część już istnieje: `abapfs_get_creation_diagnostics` zwraca wersję rozszerzenia, typy, kolekcje discovery, mediatypy, ustawienie pakietu i ślady tworzenia. `abapfs_export_adt_discovery` udostępnia eksport discovery. Warto rozszerzyć te mechanizmy zamiast mnożyć podobne narzędzia.

**MVP rozszerzenia:** rozróżnić „reklamowane”, „potwierdzone odczytem”, „potwierdzone zapisem”, „odmowa dostępu” i „nieustalone”, z informacją o systemie/wersji i czasie sprawdzenia.

**Ograniczenie:** obecność kolekcji lub formatu w discovery nie dowodzi uprawnień do tworzenia. Brak wpisu nie zawsze oznacza brak obsługi kontraktu. Domyślne badanie powinno być odczytowe; tworzenie testowych obiektów wymaga jawnie uzgodnionego zakresu.

**Rekomendacja:** małe, praktyczne usprawnienia obecnej diagnostyki. Nie traktować jako dużej nowej funkcji wymagającej osobnej implementacji wszystkich odczytów.

## 8. CDS Execution Plan

**Co daje:** przy diagnozie wydajności plan wykonania bywa dużo bardziej użyteczny niż sama treść CDS. Wartość jest jednak zależna od konkretnego przypadku.

**Pierwszy krok:** ustalić dostęp do diagnostyki SQL i planów w backendzie. Nazwa CDS nie identyfikuje jednego rzeczywistego zapytania: znaczenie mają filtry, parametry, użytkownik, warunki autoryzacji i kontekst wykonania. Plan estymowany, plan wykonany, koszt optymalizatora i zmierzony czas to różne dane.

Istniejące ślady wykonania ABAP nie są automatycznie planami SQL/HANA. Dla systemów bez HANA nie można zakładać dostępności planów HANA ani tego samego interfejsu.

**Rekomendacja:** odłożyć szeroki tool. Jeżeli pojawi się problem wydajnościowy, najpierw zbudować integrację z potwierdzoną diagnostyką i jasno wskazywać pochodzenie oraz ograniczenia wyników. [SAP — Analyzing SQL Statement Performance](https://help.sap.com/docs/ABAP_PLATFORM_NEW/6d9d967c861d4f78b5b90a4fe9b7d2e7/3b27703e7ad24982931db245f23d6bcf.html).

## 9. RAP EML Executor

**Co daje:** wykonywanie scenariuszy READ/MODIFY/actions bezpośrednio na modelu RAP, przydatne do testów jego logiki transakcyjnej.

Nie potwierdziliśmy uniwersalnego endpointu ADT wykonującego dowolny EML. Koncepcja może wymagać osobnego komponentu ABAP lub ograniczonego mechanizmu testowego. Nie należy przedstawiać jej jako prostego wrappera istniejącego REST API.

Projekt musiałby rozstrzygnąć typowanie kluczy i parametrów, bufor transakcyjny, COMMIT/ROLLBACK, obsługę `FAILED`/`REPORTED`, blokady oraz uprawnienia. Uprzywilejowane tryby wykonania nie mogą być domyślnym sposobem obchodzenia kontroli biznesowych. Test EML nie zastępuje testu zewnętrznego kontraktu OData.

**Rekomendacja:** osobne badanie na później. Obecnie większy zwrot dają OData Executor oraz istniejące testy ABAP Unit. Semantyka: [SAP — EML](https://help.sap.com/docs/abap-cloud/abap-rap/entity-manipulation-language-eml).

## Wspólne wymagania dla nowych narzędzi

- **Kontrole podczas wykonania:** w tej implementacji serwer MCP wywołuje `invoke()` bez ścieżki dialogowej `prepareInvocation`. Sam dialog Copilota nie zapewnia kontroli mutacji przez MCP. Zachować guard autoryzujący wywołującego i osobno egzekwować zakres dozwolonej operacji. [Registry](../client/src/services/lm-tools/toolRegistry.ts), [tool guard](../client/src/services/lm-tools/toolGuard.ts).
- **Pochodzenie i kompletność:** zwracać system/klienta, URI, wersję active/inactive, źródło informacji i stan unknown. Nie ukrywać brakujących danych pod wiarygodnie wyglądającym JSON-em.
- **Brak sekretów:** nie zwracać Authorization, Cookie, CSRF ani credentiali. Źródła i odpowiedzi biznesowe mogą zawierać dane wymagające ograniczenia zakresu oraz rozmiaru.
- **Oddzielne skutki:** zapis, aktywacja, publikacja, transport i wykonanie operacji biznesowej mają osobne wyniki. Sukces jednej czynności nie potwierdza pozostałych.
- **Kompatybilność oparta na dowodach:** rozróżniać wersje SAP, odmowę dostępu, brak obsługi, błąd klienta i nieznany wynik. Nie naprawiać różnych kontraktów identycznym payloadem bez weryfikacji.

## Proponowane kolejne kroki

1. Zachować v5 jako stabilne wydanie i uzupełniać jego dokumentację dowodami testów niezależnie od rozwoju nowych funkcji.
2. Dla API Inspectora przeprowadzić małe badanie odczytowe: dostępne kontrakty, przykładowe odpowiedzi, kompletność sygnatur/release i różnice wersji. Dopiero na tej podstawie ustalić schemat MCP i zakres MVP.
3. Po potwierdzeniu wykonalności dodać jeden tool na osobnej gałęzi, testy z zanonimizowanymi odpowiedziami i weryfikację porównawczą z ADT. Nie rozszerzać od razu zakresu o edycję i automatyczne workflow.
4. Następnie zbadać klienta OData w trybie odczytu. RAP Metadata Inspector oprzeć na konkretnych potrzebach i potwierdzonych odczytach, zamiast od razu budować pełny model wszystkich BO.

Nie rekomendujemy jednoczesnego wdrażania całej listy, drugiego niezależnego silnika zapisów ani ogólnego wykonawcy biznesowych mutacji jako pierwszej nowej funkcji. Każde zwiększenie zakresu powinno mieć konkretny przypadek użycia i mierzalny wynik akceptacji.
