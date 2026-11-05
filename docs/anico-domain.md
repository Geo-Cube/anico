# AniCo – doménový kontext pro agenty (MVP: US-01 až US-03)

Kompaktní výtah z business analýzy (BPMI DL Business Model – Tým 5). Je to **jediný zdroj pravdy pro agenty**.
Při rozporu s původní analýzou vyhrává analýza – rozpor nahlas ohlas a oprav tento soubor.
Odkazuj se na ID: `UC-01`, `UC-03/A3`, `WF 05`, `US-02`.

## 1. Rozsah

- AniCo: platforma pro bezpečné propojování ověřených chovatelů (psi, koně) za účelem krytí.
- **V MVP zpracováno:** UC-01 Ověřit chovatele, UC-02 Přidat zvíře (+ zobrazit/upravit/odstranit, fotografie), UC-03 Doložit údaje o zvířeti (doklady, posouzení, nové verze).
- **Nezpracováno (US-04 až US-10):** nabídky, vyhledávání, poptávky, sdílení kontaktů. Nenavrhuj ani neimplementuj je. Neblokuj je ale zbytečně (např. nevymýšlej vazby, které by se musely rušit).
- Registraci a přihlášení zajišťuje **základní správa uživatelů** (externí vůči AniCo). AniCo si po registraci „převezme účet“ (identifikátor účtu = `breeder_id`).

## 2. Aktéři a oprávnění

| Aktér          | Co smí                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Vlastník AniCo | Jmenuje administrátory (přes správu uživatelů). V UC nemá scénář.                                                              |
| Administrátor  | Posuzuje žádosti chovatelů a doklady zvířat, stahuje přílohy, vidí historii rozhodnutí.                                        |
| Chovatel       | Spravuje svůj účet; po schválení vlastní zvířata, fotografie, doklady. K soukromým přílohám jiného chovatele **nemá přístup**. |

- Admin práva zajišťuje správa uživatelů. **Schválení chovatelského účtu admin práva nepřiděluje.**
- Vlastníka a admina systém určuje **z přihlášení**, nikdy z payloadu požadavku (`breeder_id` u zvířete se přebírá z identity).
- Oprávnění se kontroluje při: otevření stránky/endpointu, práci se souborem (čtení, stažení, smazání), každé změně dat. Při každém čtení i zápisu.
- Po odhlášení nové přihlášení + nová kontrola práv.

## 3. Stavy účtu a dostupnost funkcí

| Stav účtu                        | Dostupné                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| Bez žádosti, `is_verified=False` | Můj účet, první doložení údajů                                |
| `PENDING`, `is_verified=False`   | Můj účet, stav žádosti; podané údaje nelze měnit              |
| `REJECTED`, `is_verified=False`  | Můj účet, výsledek a důvod; **další podání v MVP nedostupné** |
| `APPROVED`, `is_verified=True`   | Můj účet, Moje zvířata, doklady                               |

Správa zvířat a dokladů vyžaduje `is_verified=True` – ověřuje se **znovu na serveru při každé operaci**, ne jen při zobrazení menu.

## 4. Datový model (zkráceně)

Vazby: Chovatel 1—0..1 Žádost o ověření; Chovatel 1—0..N Zvíře; Zvíře 1—0..N Doklad zvířete (verze). Fotografie a Soubor jsou vnořené struktury.

**Chovatel:** `breeder_id` (= id účtu, neměnné), `first_name`, `last_name`, `email_address`, `has_breeding_station` (vždy True), `breeding_station_name` / `breeding_station_number` (NULL do prvního podání, pak povinné), `is_verified`.

**Žádost o ověření (`verification_request`):** `verification_request_id`, `breeder_id` (max. 1 žádost na chovatele), `status` PENDING/APPROVED/REJECTED, `submitted_at` (neměnné), `breeding_station_certificate` (Soubor, povinný), `reviewed_by`, `reviewed_at`, `rejection_reason` (NULL při podání a schválení, povinný při REJECTED).

**Zvíře (`animal`):** `animal_id`, `breeder_id` (neměnný vlastník), `animal_name` (volitelné), `species` (Pes/Kůň), `breed` (povinné, musí odpovídat druhu), `sex` MALE/FEMALE (povinné), volitelné: `birth_date` (≤ dnes), `coat_color`, `weight_kg` (> 0), `city`, `pedigree_number`, `microchip_number` (text, zachovat celý zápis – žádné ořezávání nul/mezer bez rozhodnutí), `description`, `photos[]`.
Bez jména UI zobrazí druh + plemeno + krátký identifikátor. Přesná adresa se neeviduje.

**Doklad zvířete (`animal_document`):** `document_id` (id verze), `animal_id` (neměnné napříč řetězcem), `document_type` PEDIGREE/HEALTH_RESULTS/BREEDING_APPROVAL (neměnné napříč řetězcem), `version_number` (1, +1), `previous_document_id` (NULL u v1, jinak odkaz na nahrazenou REJECTED verzi), `file`, `assessment_status` PENDING/APPROVED/REJECTED, `submitted_at`, `reviewed_by`, `reviewed_at`, `rejection_reason`.

**Fotografie:** `photo_id`, `file`, `is_primary`. **Soubor:** `file_name`, `file_reference` (reference na uložený soubor; před použitím ověřit oprávnění).

**Číselník druhů a plemen:** jeden JSON konfigurační soubor, cca 250 položek, česky, aplikace ho za běhu **nemění**. Druh a plemeno se validují proti němu.

## 5. Invarianty a pravidla (testovatelné)

### UC-01 – Ověření chovatele

> **Schválená odchylka od analýzy (5. 11. 2026, [ADR-0004](adr/0004-vraceni-zadosti-k-doplneni.md)):** admin může
> žádost ve stavu `PENDING` vrátit k doplnění (`RETURNED`, povinný důvod). Chovatel ji pak opraví a znovu odešle
> (→ `PENDING`); body 1, 3, 5 a 8 níže a „další podání nedostupné“ v §3 proto platí jen pro `APPROVED` a `REJECTED`,
> které zůstávají konečné. Výtah níže zachycuje původní analýzu beze změny.

1. Chovatel podá **nejvýše jednu** žádost za život. Druhé podání → zobrazí se existující žádost, nová se nevytvoří (A3). Platí i po REJECTED.
2. Podání = **jedna transakce**: úprava profilu chovatele + vytvoření žádosti + uložení přílohy. Při chybě nezůstane nic částečně uloženo.
3. Po podání se data chovatele ani příloha žádosti nemění. `reviewed_by/at/rejection_reason` = NULL, `status=PENDING`, `is_verified` zůstává False.
4. Povinné: jméno, příjmení, e-mail, název a reg. číslo stanice, certifikát (PDF/JPEG/PNG).
5. Rozhodnutí admina je **konečné a neměnné**. Smí se uložit jen ze stavu PENDING; kontrola stavu a zápis jsou **atomické** (dva admini nesmí uložit dvě rozhodnutí; druhý dostane uložený výsledek, A4).
6. Schválení: `status=APPROVED` + `is_verified=True` + `reviewed_by/at` + `rejection_reason=NULL` – **společně**.
7. Zamítnutí: důvod **povinný**; `is_verified` zůstává False; společně s výsledkem.
8. Po rozhodnutí e-mail chovateli (u zamítnutí s důvodem a informací, že žádost lze podat jen jednou). **Selhání e-mailu rozhodnutí nevrací** – výsledek je vždy vidět v Můj účet.
9. Fronta admina: jen `PENDING`; rozhodnuté žádosti z ní mizí. Filtr Čekající/Schválené/Zamítnuté.

### UC-02 – Zvíře a fotografie

1. Povinné: `species`, `breed` (shodné s druhem dle číselníku), `sex`. Ostatní volitelné (prázdné → NULL). `weight_kg > 0` je-li vyplněno; `birth_date ≤ dnes`.
2. Bez `microchip_number` nelze doklad ověřit (jen informační; nebrání uložení profilu).
3. Fotografie volitelné, JPEG/PNG. Neprázdný seznam má **právě jednu** `is_primary=True`. Bez výběru je hlavní první. Po odebrání hlavní se hlavní stane první zbývající. Prázdný seznam je legální.
4. Vytvoření a úprava (profil + fotografie + soubory) = **jedna transakce**. Úprava zachovává `animal_id`, `breeder_id`, `photo_id` zachovaných fotek a **dřívější rozhodnutí o dokladech**.
5. Odebrané fotografie → smazat i nepotřebné soubory z úložiště.
6. **Odstranění zvířete:** nevratné, jedna transakce; smaže profil, fotografie, **všechny verze dokladů** a jejich soubory. Účet chovatele a jeho žádost zůstávají. Odstraněné zvíře/doklady zmizí i z fronty admina.
7. Chovatel smí číst/měnit/mazat **jen svá** zvířata a přílohy.

### UC-03 – Doklady

> **Schválená odchylka od analýzy (5. 11. 2026, [ADR-0005](adr/0005-doklady-zvirat-vnorene-ve-zvireti.md)):** zvíře má
> pro každý typ dokladu nejvýše jednu řadu verzí. Nové podání dokladu existujícího typu vytvoří další verzi této řady
> i nad `PENDING` nebo `APPROVED` verzí; starší verze, její soubor i rozhodnutí zůstávají v historii. Bod 4 níže
> (nová verze jen nad `REJECTED`) platí pro explicitní náhradu konkrétní verze. Tím je rozhodnuta i otevřená otázka §6/1.

1. Podání obsahuje ≥ 1 přílohu; ke každé povinný typ. Doklady PDF/JPEG/PNG. Každá příloha = **samostatný doklad** s v1, `previous_document_id=NULL`, `PENDING`. Celé podání v jedné transakci.
2. Admin posuzuje **každý doklad zvlášť**; rozhodnutí se týká konkrétní verze. Schválení/zamítnutí jen ze `PENDING` a jen u **aktuální** verze; atomicky (A4 jako u UC-01). Zamítnutí vyžaduje důvod.
3. Výsledek posouzení verze se **už nemění**. `is_verified` účtu se doklady **nedotýká**.
4. Nová verze: jen na **aktuální verzi ve stavu REJECTED**. Zvíře a typ se přebírají. `version_number = předchozí + 1`, `previous_document_id` = nahrazovaná verze, status `PENDING`, `reviewed_*`/`rejection_reason` = NULL. Původní soubor a rozhodnutí zůstávají.
5. **Každá verze má nejvýše jednoho přímého nástupce** – druhá náhrada téže verze se odmítne (A3) a zobrazí se aktuální verze. Vynutit na úrovni DB (unique na `previous_document_id`), nejen v kódu.
6. Aktuální verze = poslední v řetězci. Do fronty admina patří jen aktuální `PENDING` verze, ne historické.
7. „Stav dokladů“ zvířete v UI je odvozený údaj: priorita PENDING > APPROVED > REJECTED; bez dokladů „Nedoložené“. **Není uložen.** Filtr: Všechna / Ověřená / K posouzení / Zamítnutá / Nedoložená.
8. Historii verzí (soubor, čas, admin, rozhodnutí, důvod) smí vidět vlastník zvířete a admin; jinak odmítnout.

### Soubory (průřezově)

- Formát a úspěšné uložení kontroluje systém. Technické limity (velikost apod.) určuje implementace.
- Otevření/stažení po ověření oprávnění, pod uloženým `file_name`. Vestavěný náhled PDF se neřeší.
- Chyba ukládání/nahrávání → původní data beze změny, krátká chybová zpráva, lze opakovat.
- Soubor bez záznamu a záznam bez souboru jsou chyby konzistence – chraň se proti nim (pořadí operací, úklid při rollbacku).

### UI zprávy

Krátká zavíratelná zpráva nahoře; zavření nemění data. Výsledek a důvod zamítnutí zůstávají trvale v obsahu stránky.

## 6. Otevřené otázky (nerozhodnuto v analýze – neuhaď, ohlas)

1. Smí chovatel nahrát další doklad **téhož typu** ke zvířeti, které už má aktuální doklad toho typu (PENDING/APPROVED)? UC-03 to nezakazuje ani nepovoluje.
2. Co se stane s **APPROVED dokladem**, když chovatel později změní `microchip_number` / `species` / `breed` zvířete? Analýza říká, že dřívější rozhodnutí zůstane (UC-02 CAF) – riziko, že „ověřený“ doklad už neodpovídá profilu.
3. Chovatel koní: analýza mluví o „jménu hospodářství a reg. čísle hospodářství“, datový model má jen `breeding_station_name/number`. Použít stejná pole?
4. Odkaz na kontrolu čipu koně: Processes uvádí integrovaný zemědělský registr, UC-03 Centrální přístupové místo pro evidenci koní. (Jen manuální kontrola admina, systém ji neautomatizuje.)
5. Zda smazání zvířete s dokladem ve stavu PENDING vyžaduje něco navíc (analýza: prostě se smaže a zmizí z fronty).
6. Chování při přístupu k cizímu zvířeti/souboru: 403 vs. 404 (zvolit a držet jednotně; doporučení: 404 pro cizí zdroje chovatele, 403 pro chybějící roli).
7. Limity souborů (velikost, počet fotek, počet dokladů v jednom podání) – „určí implementace“.
8. Kdo/jak zakládá administrátory a odkud se bere `reviewed_by` (id admina ze správy uživatelů) – závislost na externím systému.

## 7. Zdroje

`01-business-discipline.md`, `02-processes.md`, `03-business-actors.md`, `04-products.md`, `05-business-use-cases.md` (umístění v repozitáři: `docs/business/` (zatím v repozitáři chybí – doplnit)).
