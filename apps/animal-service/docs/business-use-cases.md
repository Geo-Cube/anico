---
title: Business use cases
source: business use cases.pdf
language: cs
audience: AI agents
---

# Business use cases

> Strojově čitelný převod zdrojového PDF. Obsah zahrnuje všechny use case, scénáře, alternativní toky a datové vazby.

Kontext po registraci
Registraci a přihlášení zajišťuje základní správa uživatelů. Následuje převzetí účtu do AniCo.

Převzetí účtu po registraci

#### Happy day scénář

1. Základní správa uživatelů předá identitu a data nového chovatele. – AniCo vytvoří profil. Převezme identifikátor účtu a uloží data chovatele.

2. Systém nastaví breeder.is_verified = False – Data stanice nastaví na NULL. Žádost, zvířata a doklady vznikají až v dalších krocích.
3. Systém otevře Můj účet. – Zobrazí data chovatele a stav Zatím neověřený. Nabídne první doložení údajů. Správa zvířat je zatím nedostupná.

## UC-01 - Ověřit chovatele

Administrátor posoudí doklady chovatele. Schválení účtu zpřístupní správu zvířat.

#### Trigger List

Triggered by Trigger Description

Chovatel Po registraci otevře Můj účet a zvolí Doložit údaje k ověření.

Administrátor Otevře Žádosti chovatelů a vybere čekající žádost.

Chovatel Otevře Můj účet a zobrazí výsledek.

#### Pre-conditions

Chovatel má účet. Pro první podání dosud nemá žádost. Oprava je dostupná pouze po vrácení ve stavu RETURNED. Administrátor má právo posuzovat žádosti. Před
posouzením má žádost PENDING a chovatel má is_verified = False. Obsahuje certifikát stanice (pes - Certifikát o chráněném názvu chovatelské stanice, kůň - Potvrzení o
registraci na ČMSCH).

#### Post-conditions

Po podání má žádost PENDING. Po schválení má žádost APPROVED a chovatel is_verified = True. Po zamítnutí má žádost REJECTED a chovatel is_verified = False. Po
vrácení má žádost RETURNED, povinný důvod a chovatel zůstává neověřený. Stejnou žádost smí opravit a znovu odeslat. Důvod je uložený. Rozhodnutí obsahuje
administrátora a čas. Chovatel dostane e-mail a výsledek uvidí v Můj účet.

Příprava a první podání

#### Happy day scénář

1. Chovatel otevře Můj účet. – Systém načte jeho profil. Pokud dosud nepodal žádost, nabídne Doložit údaje k ověření.
2. Chovatel otevře formulář. – Zkontroluje a doplní svá data. Zkontroluje údaje chovatelské stanice. Změny jsou zatím jen ve formuláři. (A1)

3. Chovatel doloží údaje chovatelské stanice. – Doplní název a registrační číslo stanice a přiloží certifikát o chráněném názvu nebo potvrzení o registraci na ČMSCH.
4. Chovatel zvolí Odeslat k ověření. – Systém zkontroluje přihlášení, povinná data a přílohy. Také ověří, že jde o první podání nebo opravu žádosti ve stavu RETURNED.
   (A2, A3)
5. Systém uloží data chovatele. – Uloží data stanice. breeder.is_verified zůstává False.

6. Systém vytvoří identifikátor žádosti. – Přiřadí chovatele a uloží přílohy. Nastaví verification_request.status = PENDING. Do verification_request.submitted_at uloží
   čas podání. Nastaví verification_request.reviewed_by = NULL, verification_request.reviewed_at = NULL a verification_request.rejection_reason = NULL. Změny
   profilu a žádost uloží společně.
7. Systém přejde na Můj účet. – Nahoře zobrazí zavíratelné potvrzení. Chovatel vidí stav K posouzení a datum podání. Další podání je nedostupné.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 2)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře Můj účet. Uložená data zůstanou stejná.

##### A2 - Chybí povinná data nebo soubor nevyhovuje (HDS 4)

Po opravě se opakuje kontrola v uvedeném kroku.

1. Systém označí problém ve formuláři. – Uložená data zůstanou stejná. Uživatel může data opravit nebo zvolit Zrušit.

##### A3 - Žádost už existuje a není vrácená k doplnění (HDS 4)

Další podání končí.

1. Systém zobrazí existující žádost a její stav. – Novou žádost nevytvoří.

### Hlavní scénář - schválení

#### Happy day scénář

1. Administrátor otevře Žádosti chovatelů.
2. Systém zobrazí žádosti s verification_request.status = PENDING. – Uvede data žadatelů a čas podání.

3. Administrátor vybere žádost. – Systém načte podání a profil chovatele.
4. Systém zobrazí data chovatele a seznam příloh. – Zobrazí také data stanice a certifikát.

5. Administrátor stáhne přílohy. – Zkontroluje jejich čitelnost a platnost. U stanice psů ověří název v seznamu Chovatelské stanice na cmku.cz a shodu s certifikátem. U
   chovatele koní zkontroluje potvrzení o registraci na ČMSCH. Porovná doklady s daty chovatele. Systém před stažením ověří jeho oprávnění.

6. Administrátor zvolí Schválit ověření. – Systém ověří oprávnění. Také zkontroluje, že žádost stále má PENDING. (A1, A4, A5)
7. Systém společně uloží verification_request.status = APPROVED a breeder.is_verified = True. – Do verification_request.reviewed_by uloží identitu administrátora. Do
   verification_request.reviewed_at uloží čas rozhodnutí. Nastaví verification_request.rejection_reason = NULL.
8. Systém pošle chovateli e-mail o schválení účtu. – Použije uloženou e-mailovou adresu.

9. Systém zobrazí zavíratelné potvrzení. – Vrátí administrátora na seznam čekajících žádostí. Schválenou žádost ze seznamu vyřadí.

#### Alternativní toky

##### A1 - Zamítnutí žádosti (HDS 6)

Větev nahrazuje schválení. Po posledním kroku UC končí.

1. Administrátor zjistí nedostatky. – Místo schválení zvolí Zamítnout.
2. Systém otevře okno pro důvod zamítnutí.

3. Administrátor vyplní důvod a potvrdí zamítnutí. – Důvod je povinný. Rozhodnutí se ukládá až po potvrzení.
4. Systém ověří oprávnění a stav PENDING. – Uloží verification_request.status = REJECTED. Do verification_request.rejection_reason uloží zadaný důvod. Do
   verification_request.reviewed_by uloží identitu administrátora. Do verification_request.reviewed_at uloží čas rozhodnutí.
5. Systém ponechá breeder.is_verified = False. – Správa zvířat zůstane nedostupná. Tento příznak uloží společně s výsledkem žádosti.

6. Systém pošle chovateli e-mail s výsledkem a důvodem zamítnutí. – Uvede, že zamítnutí je konečné a žádost už nelze opravit ani znovu podat.
7. Systém zobrazí zavíratelné potvrzení. – Vrátí administrátora na seznam čekajících žádostí. Zamítnutou žádost ze seznamu vyřadí. Tato větev končí.

##### A2 - Administrátor zvolí Zrušit (HDS A1.3)

Okno se zavře. Administrátor může pokračovat v posouzení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře detail žádosti. Uložená data zůstanou stejná.

##### A3 - U zamítnutí chybí důvod (HDS A1.3)

Administrátor doplní důvod ve větvi A1, nebo okno zruší.

1. Systém označí důvod jako povinný. – Rozhodnutí zatím neuloží.

##### A4 - Jiný administrátor už rozhodl (HDS 6)

Aktuální průchod končí bez dalšího rozhodnutí.

1. Systém zobrazí uložený výsledek. – Druhé rozhodnutí odmítne. Původní výsledek zůstane stejný.

##### A5 - Vrácení žádosti k doplnění (HDS 6)

Větev nahrazuje schválení a umožňuje chovateli opravit tutéž žádost.

1. Administrátor zvolí Vrátit k doplnění. – Vyplní povinný důvod a potvrdí vrácení.

2. Systém ověří oprávnění, stav PENDING a posuzovanou revizi. – Uloží RETURNED, důvod, administrátora a čas. Rozhodnutí přidá do historie. Chovatel zůstává
   neověřený.

3. Chovatel zobrazí důvod a může žádost opravit. – Vrácení není konečné zamítnutí. Počet vrácení není omezený.

Oprava vrácené žádosti

#### Happy day scénář

1. Chovatel otevře vrácenou žádost. – Systém zobrazí důvod a předvyplní uložené údaje.

2. Chovatel opraví údaje a odešle doplněnou žádost. – Může přiložit nový certifikát. Bez nového souboru zůstává původní. U schválené nebo konečně zamítnuté žádosti
   oprava není dostupná.

3. Systém zkontroluje údaje a stav RETURNED. – Ve stejné žádosti zachová identifikátor, čas prvního podání a historii. Zvýší revizi o 1, uloží čas posledního podání a
   nastaví PENDING. Posuzujícího, čas posledního rozhodnutí a aktuální důvody nastaví na NULL. Žádost znovu zařadí k posouzení.

Zobrazení výsledku

#### Happy day scénář

1. Chovatel otevře Můj účet. – Systém načte jeho profil a případnou žádost. Zobrazí výsledek, datum podání a datum rozhodnutí.
2. U PENDING systém zobrazí K posouzení. – Správa zvířat zůstane nedostupná. U APPROVED a breeder.is_verified = True zobrazí Účet ověřený a zpřístupní Moje
   zvířata. U REJECTED a breeder.is_verified = False zobrazí Zamítnuto, důvod a omezení dalšího podání. U RETURNED zobrazí důvod vrácení a nabídne opravu stejné
   žádosti. Zobrazení výsledku data nemění.

3. Po zrušení formuláře zůstanou uložená data stejná. – Existující žádost mimo stav RETURNED brání dalšímu podání. U již rozhodnuté žádosti systém zobrazí aktuální
   výsledek. Druhé rozhodnutí odmítne.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přístup. Při chybějícím oprávnění operaci odmítne. Po odhlášení vyžádá nové přihlášení a znovu zkontroluje práva. Při chybě ukládání
nebo nahrávání zůstanou původní data zachovaná. Uživatel uvidí krátkou zprávu. Může operaci zopakovat. Kontrola stavu a uložení rozhodnutí proběhnou společně. Dva
administrátoři tak nemohou uložit dva výsledky stejného posouzení. Tyto situace mají zprávu v běžném UI. Chybové situace se zobrazují na stávajících obrazovkách a
používají definované stavy.

 Chovatel má jednu žádost o ověření účtu. Po vrácení ji může opravit a znovu odeslat. Schválení a zamítnutí jsou konečná. Stav podané žádosti a výsledek
posouzení jsou dostupné na stránce Můj účet.

 Schválení a zamítnutí jsou konečná. Vrácení umožňuje opravu téže žádosti. Všechna rozhodnutí zůstávají v historii žádosti.

#### Mockups & Wireframes

##### WF 01 - Chovatel · účet po registraci

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Text Povinná data chovatele.

E-mail breeder.email_address Text Adresa pro výsledek ověření účtu.

Ověření účtu breeder.is_verified; Stavový štítek Bez žádosti Zatím neověřený. PENDING =
verification_request.status K posouzení. RETURNED = Vráceno k
doplnění. APPROVED = Účet ověřený.
REJECTED = Zamítnuto.

Zpráva nahoře Výsledek operace Zavíratelná zpráva Výzva k doložení údajů. Zavření data
nemění.

Doložit údaje k ověření Bez datové vazby Tlačítko Otevře formulář prvního podání.

##### WF 02 - Chovatel · doložení se stanicí

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Textová pole Povinná pole předvyplněná z registrace.

E-mail breeder.email_address Pole pro e-mail Povinné. Předvyplněné z registrace.

Název a registrační číslo stanice breeder.breeding_station_name; Textová pole Povinné.
breeder.breeding_station_number

Certifikát stanice verification_request.breeding_station_cert Výběr souboru Povinný. PDF, JPEG nebo PNG.
ificate; file.file_name; file.file_reference

Zrušit Bez datové vazby Tlačítko Zavře formulář bez uložení.

Odeslat k ověření Bez datové vazby Tlačítko Po kontrole společně uloží profil a žádost
PENDING.

##### WF 03 - Chovatel · čeká na rozhodnutí

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Text Povinná data chovatele.

E-mail breeder.email_address Text Adresa pro výsledek ověření účtu.

Chovatelská stanice breeder.breeding_station_name; Text Zobrazí název a registrační číslo stanice.
breeder.breeding_station_number

Ověření účtu breeder.is_verified; Stavový štítek Bez žádosti Zatím neověřený. PENDING =
verification_request.status K posouzení. RETURNED = Vráceno k
doplnění. APPROVED = Účet ověřený.
REJECTED = Zamítnuto.

Odesláno verification_request.submitted_at Datum a čas Čas podání žádosti.

Rozhodnutí verification_request.reviewed_by; Text a datum Administrátor a čas posouzení. Před
verification_request.reviewed_at rozhodnutím jsou prázdné.

Zpráva nahoře Výsledek operace Zavíratelná zpráva Podklady byly odeslány k ověření. Zavření
data nemění.

##### WF 04 - Administrátor · přehled

Name Data binding Component Description

Čekající žádosti verification_request.status Počet záznamů Počet žádostí PENDING.

Čekající doklady animal_document.assessment_status Počet záznamů Počet aktuálních dokladů PENDING.

Zobrazit žádosti Bez datové vazby Tlačítko Otevře frontu žádostí chovatelů.

Zobrazit doklady Bez datové vazby Tlačítko Otevře frontu dokladů zvířat.

##### WF 05 - Administrátor · seznam žádostí

Name Data binding Component Description

Chovatel verification_request.breeder_id; Sloupec tabulky Žadatel přiřazený k žádosti.
breeder.first_name; breeder.last_name

Odesláno verification_request.submitted_at Datum a čas Čas podání.

Stav a filtr verification_request.status Štítek a přepínač Čekající, Vrácené, Schválené nebo
Zamítnuté.

Posoudit Bez datové vazby Tlačítko Otevře detail vybrané žádosti.

##### WF 06 - Administrátor · žádost se stanicí

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Text Povinná data chovatele.

E-mail breeder.email_address Text Adresa pro výsledek ověření účtu.

Chovatelská stanice breeder.breeding_station_name; Text Zobrazí název a registrační číslo stanice.
breeder.breeding_station_number

Odesláno verification_request.submitted_at Datum a čas Čas podání žádosti.

Rozhodnutí verification_request.reviewed_by; Text a datum Administrátor a čas posouzení. Před
verification_request.reviewed_at rozhodnutím jsou prázdné.

Ověření účtu breeder.is_verified; Stavový štítek Bez žádosti Zatím neověřený. PENDING =
verification_request.status K posouzení. RETURNED = Vráceno k
doplnění. APPROVED = Účet ověřený.
REJECTED = Zamítnuto.

Certifikát stanice verification_request.breeding_station_cert Karta souboru Otevření nebo stažení souboru.
ificate; file.file_name; file.file_reference

Zpět na žádosti Bez datové vazby Tlačítko Vrátí se na seznam bez rozhodnutí.

Zamítnout Bez datové vazby Tlačítko Otevře okno pro důvod zamítnutí.

Schválit ověření Bez datové vazby Tlačítko Uloží APPROVED a is_verified = True.
Doplní administrátora a čas.

##### WF 07 - Administrátor · zamítnutí žádosti

Name Data binding Component Description

Důvod zamítnutí verification_request.rejection_reason Víceřádkové pole Povinný text.

Zrušit Bez datové vazby Tlačítko Zavře okno bez rozhodnutí.

Potvrdit zamítnutí Bez datové vazby Tlačítko Uloží REJECTED, důvod, administrátora a
čas. is_verified zůstane False.

##### WF 08 - Administrátor · výsledek rozhodnutí

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Žádost byla posouzena. Výsledek je
uložený. Zavření data nemění.

Chovatel verification_request.breeder_id; Sloupec tabulky Žadatel přiřazený k žádosti.
breeder.first_name; breeder.last_name

Odesláno verification_request.submitted_at Datum a čas Čas podání.

Stav a filtr verification_request.status Štítek a přepínač Čekající, Vrácené, Schválené nebo
Zamítnuté.

Posoudit Bez datové vazby Tlačítko Otevře detail vybrané žádosti.

##### WF 09 - Chovatel · schválený účet

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Text Povinná data chovatele.

E-mail breeder.email_address Text Adresa pro výsledek ověření účtu.

Chovatelská stanice breeder.breeding_station_name; Text Zobrazí název a registrační číslo stanice.
breeder.breeding_station_number

Ověření účtu breeder.is_verified; Stavový štítek Bez žádosti Zatím neověřený. PENDING =
verification_request.status K posouzení. RETURNED = Vráceno k
doplnění. APPROVED = Účet ověřený.
REJECTED = Zamítnuto.

Odesláno verification_request.submitted_at Datum a čas Čas podání žádosti.

Rozhodnutí verification_request.reviewed_by; Text a datum Administrátor a čas posouzení. Před
verification_request.reviewed_at rozhodnutím jsou prázdné.

Zpráva nahoře Výsledek operace Zavíratelná zpráva Účet byl ověřen. Zavření data nemění.

Přejít na moje zvířata Bez datové vazby Tlačítko Otevře přehled vlastních zvířat.

##### WF 10 - Chovatel · zamítnutý účet

Name Data binding Component Description

Jméno a příjmení breeder.first_name; breeder.last_name Text Povinná data chovatele.

E-mail breeder.email_address Text Adresa pro výsledek ověření účtu.

Chovatelská stanice breeder.breeding_station_name; Text Zobrazí název a registrační číslo stanice.
breeder.breeding_station_number

Ověření účtu breeder.is_verified; Stavový štítek Bez žádosti Zatím neověřený. PENDING =
verification_request.status K posouzení. RETURNED = Vráceno k
doplnění. APPROVED = Účet ověřený.
REJECTED = Zamítnuto.

Odesláno verification_request.submitted_at Datum a čas Čas podání žádosti.

Rozhodnutí verification_request.reviewed_by; Text a datum Administrátor a čas posouzení. Před
verification_request.reviewed_at rozhodnutím jsou prázdné.

Důvod zamítnutí verification_request.rejection_reason Text Trvale dostupný důvod rozhodnutí.

Zpráva nahoře Výsledek operace Zavíratelná zpráva Ověření bylo zamítnuto. Důvod zůstává v
obsahu účtu. Zavření data nemění.

## UC-02 - Přidat zvíře

Chovatel uloží profil vlastního zvířete. Může přidat fotografie. Profil může zobrazit, upravit nebo odstranit.

#### Trigger List

Triggered by Trigger Description

Chovatel Na Moje zvířata zvolí Přidat zvíře.

Chovatel Otevře vlastní profil a zvolí úpravu nebo odstranění.

#### Pre-conditions

Chovatel je přihlášený a má is_verified = True. Úprava a odstranění vyžadují vlastní uložené zvíře. Odstranění je možné jen tehdy, pokud k němu neexistuje žádná nabídka, ani
ukončená.

#### Post-conditions

Nové zvíře má identifikátor, vlastníka a uložená data. Při úpravě se změní data a fotografie. Identifikátor a vlastník se zachovají. Při odstranění zmizí profil, fotografie, doklady i
jejich historie. Doklady se přidávají v UC-03.

### Hlavní scénář - přidání

#### Happy day scénář

1. Chovatel otevře Moje zvířata. – Systém ověří přihlášení a breeder.is_verified = True. Načte jeho zvířata. Zobrazí jejich data a hlavní fotografie.
2. Chovatel zvolí Přidat zvíře. – Systém zobrazí formulář. Označí povinná data. Druh (pes nebo kůň) a plemeno se vybírají z rozevíracích nabídek naplněných z číselníku
   (soubor JSON).
3. Chovatel vyplní data zvířete. – Jméno, druh, plemeno a pohlaví jsou povinné. Jméno má po odstranění okolních mezer 1 až 120 znaků. Ostatní data jsou volitelná.
   Číslo čipu je pouze informační a jeho absence nebrání posouzení dokladu.
4. Chovatel může přidat fotografie a vybrat hlavní. – Bez výběru bude hlavní první fotografie. Před uložením může fotografie odebrat.

5. Chovatel zvolí Přidat zvíře. – Fotografie může přeskočit. Profil vznikne až po potvrzení. (A1)
6. Systém znovu ověří přihlášení a schválení účtu. – Zkontroluje povinná data, jejich hodnoty a soubory. (A2)

7. Systém vytvoří identifikátor zvířete. – Vlastníka převezme z přihlášení. Uloží data zvířete. Prázdná volitelná data uloží jako NULL. Doklady se přidávají samostatně v
   UC-03.

8. Systém uloží seznam fotografií a jejich soubory. – Každé nové fotografii přidělí identifikátor. U hlavní fotografie nastaví animal_photo.is_primary = True. U ostatních
   nastaví animal_photo.is_primary = False. Bez fotografií uloží prázdný seznam. Profil a fotografie uloží společně.

9. Systém zobrazí detail zvířete s daty a fotografiemi. – Nahoře uvede zavíratelné potvrzení. Nabídne doložení údajů, úpravu a odstranění.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 5)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře Moje zvířata. Uložená data zůstanou stejná.

##### A2 - Chybí povinná data nebo soubor nevyhovuje (HDS 6)

Po opravě se opakuje kontrola v uvedeném kroku.

1. Systém označí problém ve formuláři. – Uložená data zůstanou stejná. Uživatel může data opravit nebo zvolit Zrušit.

Zobrazení a úprava

#### Happy day scénář

1. Chovatel otevře vlastní zvíře. – Systém ověří vlastníka. Zobrazí data a fotografie. V záložce Fotografie ukáže všechny uložené fotografie.

2. Chovatel zvolí Upravit profil. – Systém předvyplní data a fotografie. Chovatel může data změnit. Může také přidat a odebrat fotografie nebo vybrat jinou hlavní
   fotografii.

3. Chovatel zvolí Uložit změny. – Systém ověří oprávnění, vlastnictví, data a soubory. (A1, A2)
4. Systém uloží data zvířete. – Vyprázdněná volitelná data nastaví na NULL. U zachovaných fotografií ponechá identifikátory a soubory. Novým fotografiím přidělí
   identifikátory a uloží soubory. Odebrané fotografie a jejich nepotřebné soubory odstraní. Identifikátor zvířete a vlastník zůstanou stejné.
5. U hlavní fotografie systém nastaví animal_photo.is_primary = True. – U ostatních nastaví animal_photo.is_primary = False. Po odebrání hlavní fotografie vybere první
   zbývající. Bez fotografií bude seznam prázdný. Doklady a jejich rozhodnutí zůstanou stejné. Celou úpravu uloží společně.
6. Systém zobrazí upravený profil. – Nahoře uvede zavíratelné potvrzení o uložení.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 3)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře detail zvířete. Uložená data zůstanou stejná.

##### A2 - Chybí povinná data nebo soubor nevyhovuje (HDS 3)

Po opravě se opakuje kontrola v uvedeném kroku.

1. Systém označí problém ve formuláři. – Uložená data zůstanou stejná. Uživatel může data opravit nebo zvolit Zrušit.

Odstranění

#### Happy day scénář

1. Chovatel otevře vlastní zvíře. – Systém nejprve ověří, že ke zvířeti neexistuje žádná nabídka. Pokud existuje, zobrazí zprávu Zvíře s existující nabídkou nelze odstranit
   a zůstane na profilu. Jinak zobrazí potvrzení, že odstraní profil, fotografie i doklady.

2. Chovatel potvrdí odstranění. – Systém ověří přihlášení, schválení účtu, vlastnictví a znovu nepřítomnost jakékoliv nabídky. Při existující nabídce odstranění odmítne a
   data zachová. (A1)

3. Systém odstraní profil, fotografie a všechny verze dokladů zvířete. – Odstraní i jejich nepotřebné soubory. Účet a žádost o jeho ověření zůstanou stejné. Odstranění
   je nevratné. Celé odstranění proběhne společně.

4. Systém otevře přehled zbývajících zvířat. – Nahoře zobrazí zavíratelné potvrzení. Odstraněný profil už není dostupný.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 2)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře detail zvířete. Uložená data zůstanou stejná.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přístup. Při chybějícím oprávnění operaci odmítne. Po odhlášení vyžádá nové přihlášení a znovu zkontroluje práva. Při chybě ukládání
nebo nahrávání zůstanou původní data zachovaná. Uživatel uvidí krátkou zprávu. Může operaci zopakovat. Kontrola stavu a uložení rozhodnutí proběhnou společně. Dva
administrátoři tak nemohou uložit dva výsledky stejného posouzení. Tyto situace mají zprávu v běžném UI. Chybové situace se zobrazují na stávajících obrazovkách a
používají definované stavy.

 Posouzení patří ke konkrétní verzi předloženého dokladu. Úprava profilu zvířete zachovává dřívější rozhodnutí.

 Potvrzené odstranění smaže profil zvířete, fotografie, všechny verze dokladů a jejich historii. Dohledatelnost rozhodnutí je zajištěna po dobu existence záznamů.

#### Mockups & Wireframes

##### WF 01 - Chovatel · přehled zvířat a dokladů

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Fotografie animal.photos; animal_photo.photo_id; Obrázek nebo galerie Karta používá hlavní fotografii. Galerie
animal_photo.file; zobrazuje všechny. Bez fotografie se
animal_photo.is_primary; file.file_name; zobrazí zástupný obrázek.
file.file_reference

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Filtr dokladů Odvozeno z Přepínač Všechna, Ověřená, K posouzení,
animal_document.assessment_status Zamítnutá, Nedoložená. Použije stejný
údaj jako štítek.

Zobrazit profil Bez datové vazby Tlačítko Otevře vlastní zvíře.

Přidat zvíře Bez datové vazby Tlačítko Otevře formulář nového zvířete.

##### WF 02 - Chovatel · přidání zvířete

Name Data binding Component Description

Jméno zvířete animal.animal_name Textové pole Povinné. Po odstranění okolních mezer 1
až 120 znaků.

Druh animal.species Rozevírací nabídka Povinné. Pes nebo Kůň.

Plemeno animal.breed Rozevírací nabídka Povinné. Nabídka odpovídá vybranému
druhu.

Pohlaví animal.sex Rozevírací nabídka Povinné. MALE = Samec; FEMALE =
Samice.

Datum narození animal.birth_date Datumové pole Volitelné. Nejvýše dnešní datum.

Barva animal.coat_color Textové pole Volitelná.

Hmotnost v kg animal.weight_kg Číselné pole Volitelná. Vyplněná hodnota musí být
větší než 0.

Lokalita animal.city Textové pole Volitelné město nebo obec.

Číslo průkazu původu animal.pedigree_number Textové pole Volitelné.

Číslo čipu animal.microchip_number Textové pole Volitelné. Zachová celý zápis.

Popis animal.description Víceřádkové pole Volitelný.

Zrušit Bez datové vazby Tlačítko Zavře formulář bez uložení.

Pokračovat na fotografie Bez datové vazby Tlačítko Otevře volitelný krok fotografií.

Přidat zvíře Bez datové vazby Tlačítko Zkontroluje formulář a uloží profil.

##### WF 03 - Chovatel · nahrání fotografií

Name Data binding Component Description

Nahrání fotografií animal.photos; animal_photo.file; Výběr více souborů Volitelné. JPEG nebo PNG.
file.file_name; file.file_reference

Hlavní fotografie animal_photo.is_primary Výběr jedné fotografie Jedna má True. Ostatní mají False. Bez
výběru se použije první fotografie.

Odebrat fotografii animal_photo.photo_id; animal.photos Akce u fotografie Před potvrzením změní jen formulář. Při
uložení úpravy odstraní fotografii a
nepotřebný soubor.

Zpět na údaje Bez datové vazby Tlačítko Vrátí se k datům formuláře.

Přidat zvíře Bez datové vazby Tlačítko Uloží profil a fotografie společně.

##### WF 04 - Chovatel · detail po přidání

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Zvíře bylo přidáno. Zavření data nemění.

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Fotografie animal.photos; animal_photo.photo_id; Obrázek nebo galerie Karta používá hlavní fotografii. Galerie
animal_photo.file; zobrazuje všechny. Bez fotografie se
animal_photo.is_primary; file.file_name; zobrazí zástupný obrázek.
file.file_reference

Data zvířete animal.sex; animal.birth_date; Přehled údajů Zobrazí uložená data. Prázdné volitelné
animal.coat_color; animal.weight_kg; hodnoty ponechá bez obsahu.
animal.city; animal.pedigree_number;
animal.microchip_number;
animal.description

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Doložit údaje Bez datové vazby Tlačítko Otevře podání dokladů v UC-03.

Upravit profil Bez datové vazby Tlačítko Otevře data a fotografie pro úpravu.

Odstranit zvíře Bez datové vazby Tlačítko Otevře potvrzení odstranění.

##### WF 05 - Chovatel · úprava profilu

Name Data binding Component Description

Jméno zvířete animal.animal_name Textové pole Povinné. Po odstranění okolních mezer 1
až 120 znaků.

Druh animal.species Rozevírací nabídka Povinné. Pes nebo Kůň.

Plemeno animal.breed Rozevírací nabídka Povinné. Nabídka odpovídá vybranému
druhu.

Pohlaví animal.sex Rozevírací nabídka Povinné. MALE = Samec; FEMALE =
Samice.

Datum narození animal.birth_date Datumové pole Volitelné. Nejvýše dnešní datum.

Barva animal.coat_color Textové pole Volitelná.

Hmotnost v kg animal.weight_kg Číselné pole Volitelná. Vyplněná hodnota musí být
větší než 0.

Lokalita animal.city Textové pole Volitelné město nebo obec.

Číslo průkazu původu animal.pedigree_number Textové pole Volitelné.

Číslo čipu animal.microchip_number Textové pole Volitelné. Zachová celý zápis.

Popis animal.description Víceřádkové pole Volitelný.

Nahrání fotografií animal.photos; animal_photo.file; Výběr více souborů Volitelné. JPEG nebo PNG.
file.file_name; file.file_reference

Hlavní fotografie animal_photo.is_primary Výběr jedné fotografie Jedna má True. Ostatní mají False. Bez
výběru se použije první fotografie.

Odebrat fotografii animal_photo.photo_id; animal.photos Akce u fotografie Před potvrzením změní jen formulář. Při
uložení úpravy odstraní fotografii a
nepotřebný soubor.

Zrušit Bez datové vazby Tlačítko Zavře formulář a zachová původní profil.

Uložit změny Bez datové vazby Tlačítko Po kontrole společně uloží data a
fotografie.

##### WF 06 - Chovatel · profil po úpravě

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Změny byly uloženy. Zavření data nemění.

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Fotografie animal.photos; animal_photo.photo_id; Obrázek nebo galerie Karta používá hlavní fotografii. Galerie
animal_photo.file; zobrazuje všechny. Bez fotografie se
animal_photo.is_primary; file.file_name; zobrazí zástupný obrázek.
file.file_reference

Data zvířete animal.sex; animal.birth_date; Přehled údajů Zobrazí uložená data. Prázdné volitelné
animal.coat_color; animal.weight_kg; hodnoty ponechá bez obsahu.
animal.city; animal.pedigree_number;
animal.microchip_number;
animal.description

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Doložit údaje Bez datové vazby Tlačítko Otevře podání dokladů v UC-03.

Upravit profil Bez datové vazby Tlačítko Otevře data a fotografie pro úpravu.

Odstranit zvíře Bez datové vazby Tlačítko Otevře potvrzení odstranění.

##### WF 07 - Chovatel · potvrzení odstranění

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Rozsah odstranění animal.animal_id; animal.photos; Text potvrzení Odstraní profil, fotografie, všechny verze
animal_document.animal_id dokladů a jejich nepotřebné soubory.

Zrušit Bez datové vazby Tlačítko Zavře potvrzení. Data zůstanou stejná.

Odstranit zvíře Bez datové vazby Tlačítko Po kontrole vlastnictví a nepřítomnosti
jakékoliv nabídky provede odstranění.
Jinak zobrazí zprávu a data zachová.

##### WF 08 - Chovatel · přehled po odstranění

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Zvíře bylo odstraněno. Zavření data
nemění.

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Fotografie animal.photos; animal_photo.photo_id; Obrázek nebo galerie Karta používá hlavní fotografii. Galerie
animal_photo.file; zobrazuje všechny. Bez fotografie se
animal_photo.is_primary; file.file_name; zobrazí zástupný obrázek.
file.file_reference

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Filtr dokladů Odvozeno z Přepínač Všechna, Ověřená, K posouzení,
animal_document.assessment_status Zamítnutá, Nedoložená. Použije stejný
údaj jako štítek.

Zobrazit profil Bez datové vazby Tlačítko Otevře vlastní zvíře.

Přidat zvíře Bez datové vazby Tlačítko Otevře formulář nového zvířete.

## UC-03 - Doložit údaje o zvířeti

Chovatel odešle doklady zvířete. Administrátor posoudí každý doklad. Zamítnutý doklad může chovatel doplnit novou verzí.

#### Trigger List

Triggered by Trigger Description

Chovatel U vlastního zvířete zvolí Doložit údaje nebo Nahrát doklady.

Administrátor V Doklady zvířat vybere čekající doklad.

Chovatel U zamítnutého dokladu zvolí Doplnit doklad.

#### Pre-conditions

Chovatel má is_verified = True a vlastní uložené zvíře. Při podání má připravený alespoň jeden soubor. Administrátor má právo posuzovat doklady. Nová verze nahrazuje
aktuální doklad se stavem REJECTED.

#### Post-conditions

Po odeslání má každá nová verze PENDING. Po rozhodnutí má posouzená verze APPROVED nebo REJECTED. Rozhodnutí obsahuje administrátora a čas. Zamítnutí obsahuje
důvod. Nová verze zachová původní přílohu a výsledek v historii. Ověření účtu chovatele se nemění.

### Hlavní scénář - odeslání dokladů

#### Happy day scénář

1. Chovatel vybere vlastní zvíře. – Systém ověří přihlášení, breeder.is_verified = True a vlastnictví zvířete.

2. Systém zobrazí data, fotografie a aktuální doklady zvířete. – U každého dokladu uvede typ, název souboru a výsledek posouzení.
3. Chovatel zvolí Doložit údaje nebo Nahrát doklady. – Systém otevře formulář pro vybrané zvíře.

4. Chovatel připojí jeden nebo více souborů. – U každého vybere typ dokladu. Před odesláním může soubor změnit nebo odebrat. Každý doklad se posuzuje
   samostatně.

5. Chovatel zvolí Odeslat k posouzení. – Systém zkontroluje přílohy a jejich typy. Podání musí obsahovat alespoň jednu přílohu. (A1, A2)
6. Systém znovu ověří schválení účtu. – Zkontroluje existenci zvířete a jeho vlastníka.

7. Systém vytvoří doklad pro každou přílohu. – Přidělí identifikátor, přiřadí zvíře a typ a uloží soubor. Nastaví animal_document.version_number = 1 a
   animal_document.previous_document_id = NULL. Nastaví animal_document.assessment_status = PENDING. Do animal_document.submitted_at uloží čas odeslání.
   Nastaví animal_document.reviewed_by = NULL, animal_document.reviewed_at = NULL a animal_document.rejection_reason = NULL. Celé podání uloží společně.
8. Systém zařadí nové doklady do čekající fronty administrátora. – breeder.is_verified zůstává stejné.

9. Systém otevře přehled dokladů zvířete. – Uvede názvy souborů a stav K posouzení. Nahoře zobrazí zavíratelné potvrzení.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 5)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře doklady zvířete. Uložená data zůstanou stejná.

##### A2 - Chybí povinná data nebo soubor nevyhovuje (HDS 5)

Po opravě se opakuje kontrola v uvedeném kroku.

1. Systém označí problém ve formuláři. – Uložená data zůstanou stejná. Uživatel může data opravit nebo zvolit Zrušit.

Posouzení - schválení dokladu

#### Happy day scénář

1. Administrátor otevře Doklady zvířat. – Systém zobrazí aktuální doklady s animal_document.assessment_status = PENDING. Uvede zvíře, chovatele, typ a čas
   odeslání. Historické verze do čekající fronty nepatří.
2. Administrátor vybere doklad. – Systém zobrazí zvíře, chovatele a detail vybrané verze. Uvede typ, čas odeslání a přiložený soubor. Volbou Fotografie si administrátor
   může prohlédnout aktuální fotografie tohoto zvířete.
3. Administrátor stáhne přílohu. – Zkontroluje její platnost a shodu s daty zvířete. Je-li číslo čipu uvedené, ověří zvíře v registru. U psa vyhledá číslo čipu na cmku.cz. U
   koně vyhledá číslo čipu v Centrálním přístupovém místě pro evidenci koní. Bez čísla čipu může doklad také posoudit. Systém ověří oprávnění a načte uložený soubor.
4. Administrátor může otevřít historii verzí. – Uvidí původní soubory a dřívější rozhodnutí.

5. Administrátor zvolí Ověřit doklad. – Rozhoduje o vybrané verzi přílohy. (A1)
6. Systém ověří oprávnění, aktuální verzi a stav PENDING. – Rozhodnutí druhého administrátora zůstane zachované. (A4)

7. Systém uloží animal_document.assessment_status = APPROVED. – Do animal_document.reviewed_by uloží identitu administrátora. Do
   animal_document.reviewed_at uloží čas rozhodnutí. Nastaví animal_document.rejection_reason = NULL. Rozhodnutí uloží společně.

8. Systém vyřadí posouzený doklad z čekající fronty. – breeder.is_verified zůstává stejné.
9. Systém zobrazí zavíratelné potvrzení. – Otevře aktualizovanou frontu čekajících dokladů.

#### Alternativní toky

##### A1 - Zamítnutí dokladu (HDS 5)

Větev nahrazuje schválení. Po posledním kroku posouzení končí.

1. Administrátor po kontrole zvolí Zamítnout doklad.

2. Systém otevře okno pro důvod zamítnutí.
3. Administrátor vyplní důvod. – Potvrdí zamítnutí. Důvod je povinný.

4. Systém ověří oprávnění, aktuální verzi a stav PENDING. – Uloží animal_document.assessment_status = REJECTED. Do animal_document.rejection_reason uloží
   důvod. Do animal_document.reviewed_by uloží identitu administrátora. Do animal_document.reviewed_at uloží čas rozhodnutí. Celé rozhodnutí uloží společně.

5. Systém vyřadí zamítnutý doklad z čekající fronty. – breeder.is_verified zůstává stejné.
6. Chovatel uvidí výsledek a důvod v přehledu dokladů zvířete.

7. Systém zobrazí zavíratelné potvrzení. – Otevře aktualizovanou čekající frontu. Tato větev končí.

##### A2 - Administrátor zvolí Zrušit (HDS A1.3)

Okno se zavře. Uživatel může pokračovat v posouzení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře detail dokladu. Uložená data zůstanou stejná.

##### A3 - U zamítnutí chybí důvod (HDS A1.3)

Administrátor doplní důvod ve větvi A1, nebo okno zruší.

1. Systém označí důvod jako povinný. – Rozhodnutí zatím neuloží.

##### A4 - Jiný administrátor už rozhodl (HDS 6)

Aktuální průchod končí bez dalšího rozhodnutí.

1. Systém zobrazí uložený výsledek. – Druhé rozhodnutí odmítne. Původní výsledek zůstane stejný.

Nová verze zamítnutého dokladu

#### Happy day scénář

1. Chovatel otevře doklady vlastního zvířete. – U aktuální zamítnuté verze zvolí Doplnit doklad. Systém zobrazí typ a důvod zamítnutí. Konečné zamítnutí účtu z UC-01
   neumožňuje nové podání. Vrácenou žádost však lze opravit. Doklady zvířete lze doplnit.
2. Chovatel nahraje nový soubor. – Zvolí Odeslat novou verzi. Zvíře a typ se převezmou z původního dokladu. (A1)

3. Systém ověří schválení účtu, vlastnictví a přílohu. – Také ověří, že nahrazovaná verze je aktuální a má REJECTED. Jednu verzi lze nahradit jen jednou. (A2, A3)
4. Systém vytvoří nový identifikátor a uloží nový soubor. – Zachová zvíře a typ. Do animal_document.previous_document_id uloží identifikátor původní verze. Hodnotu
   animal_document.version_number zvýší proti původní verzi o 1. Původní soubor a rozhodnutí zachová.
5. U nové verze systém nastaví animal_document.assessment_status = PENDING. – Do animal_document.submitted_at uloží nový čas odeslání. Nastaví
   animal_document.reviewed_by = NULL, animal_document.reviewed_at = NULL a animal_document.rejection_reason = NULL. Celou novou verzi uloží společně.
6. Nová verze se stane aktuální. – Vazba na předchozí verzi zachová návaznost. Původní zamítnutá verze zůstane v historii.

7. Systém zobrazí novou přílohu a stav K posouzení. – Umožní otevřít historii souborů, verzí a rozhodnutí.
8. Systém zobrazí zavíratelné potvrzení o odeslání. – Novou verzi zařadí do čekající fronty administrátora.

#### Alternativní toky

##### A1 - Uživatel zvolí Zrušit (HDS 2)

Tento průchod končí bez uložení.

1. Systém zavře formulář nebo potvrzovací okno. – Otevře doklady zvířete. Uložená data zůstanou stejná.

##### A2 - Chybí povinná data nebo soubor nevyhovuje (HDS 3)

Po opravě se opakuje kontrola v uvedeném kroku.

1. Systém označí problém ve formuláři. – Uložená data zůstanou stejná. Uživatel může data opravit nebo zvolit Zrušit.

##### A3 - Doklad už má novější verzi (HDS 3)

Toto doplnění končí.

1. Systém zobrazí aktuální verzi. – Druhou náhradu stejné verze odmítne.

Zobrazení výsledků a souborů

#### Happy day scénář

1. Chovatel otevře doklady vlastního zvířete. – U každého aktuálního dokladu uvidí typ, název souboru a stav. U zamítnutého dokladu uvidí také důvod.
2. Chovatel nebo administrátor zvolí Otevřít či Stáhnout soubor. – Systém ověří přístup. Načte soubor podle reference a nabídne ho pod uloženým názvem. Zobrazení
   souboru a zavření zprávy data nemění.
3. Oprávněný uživatel může zobrazit historii verzí. – Uvidí typ, soubor, čas odeslání, administrátora, čas rozhodnutí a důvod zamítnutí. Při chybějícím oprávnění systém
   přístup odmítne.

Zobrazení fotografií při posouzení dokladu

#### Happy day scénář

1. Administrátor v detailu dokladu zvolí Fotografie. – Systém ověří jeho oprávnění posuzovat doklady tohoto zvířete. Použije fotografie z aktuálního profilu, nevytváří
   kopie u dokladu.
2. Systém zobrazí fotografie zvířete. – Zobrazí hlavní fotografii a nabídne ostatní uložené fotografie. Administrátor může vybrat fotografii a prohlédnout si ji ve větším
   náhledu. Fotografie pouze prohlíží, neupravuje je. (A1)
3. Administrátor zavře náhled. – Vrátí se k rozpracovanému posouzení stejného dokladu. Zobrazení fotografií nemění údaje zvířete, stav dokladu ani rozhodnutí. Systém
   kontroluje přístup také při načtení jednotlivé fotografie.

#### Alternativní toky

##### A1 - Fotografie chybějí nebo je nelze načíst. (HDS 2)

Uvede Nebyly nahrány žádné fotografie. Jejich absence nebrání posouzení dokladu. Při chybě načtení zobrazí zprávu a umožní náhled zopakovat nebo zavřít.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přístup. Při chybějícím oprávnění operaci odmítne. Po odhlášení vyžádá nové přihlášení a znovu zkontroluje práva. Při chybě ukládání
nebo nahrávání zůstanou původní data zachovaná. Uživatel uvidí krátkou zprávu. Může operaci zopakovat. Kontrola stavu a uložení rozhodnutí proběhnou společně. Dva
administrátoři tak nemohou uložit dva výsledky stejného posouzení. Tyto situace mají zprávu v běžném UI. Chybové situace se zobrazují na stávajících obrazovkách a
používají definované stavy.

 Výsledek ověření účtu je dostupný na stránce Můj účet. Rozhodnutí zůstává uložené i při chybě doručení e-mailu. Výsledky posouzení dokladů zvířete a důvody
zamítnutí jsou dostupné v přehledu dokladů.

#### Mockups & Wireframes

##### WF 01 - Chovatel · profil a přehled dokladů

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Fotografie animal.photos; animal_photo.photo_id; Obrázek nebo galerie Karta používá hlavní fotografii. Galerie
animal_photo.file; zobrazuje všechny. Bez fotografie se
animal_photo.is_primary; file.file_name; zobrazí zástupný obrázek.
file.file_reference

Data zvířete animal.sex; animal.birth_date; Přehled údajů Zobrazí uložená data. Prázdné volitelné
animal.coat_color; animal.weight_kg; hodnoty ponechá bez obsahu.
animal.city; animal.pedigree_number;
animal.microchip_number;
animal.description

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Otevřít nebo stáhnout animal_document.file; file.file_reference; Akce u souboru Po kontrole přístupu nabídne soubor ke
file.file_name stažení.

Nahrát doklady Bez datové vazby Tlačítko Otevře podání dokladů pro toto zvíře.

##### WF 02 - Chovatel · nahrání a odeslání dokladů

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Typ dokladu animal_document.document_type Rozevírací nabídka Povinné. PEDIGREE = Průkaz původu;
HEALTH_RESULTS = Zdravotní výsledky;
BREEDING_APPROVAL = Potvrzení o
uchovnění.

Soubor animal_document.file; file.file_name; Výběr souboru Povinný u každého dokladu. PDF, JPEG
file.file_reference nebo PNG.

Přidat další doklad Bez datové vazby Tlačítko Přidá další řádek formuláře.

Odebrat Bez datové vazby Tlačítko Odstraní řádek z formuláře.

Zrušit Bez datové vazby Tlačítko Zavře formulář bez podání.

Odeslat k posouzení Bez datové vazby Tlačítko Vytvoří samostatný doklad pro každou
přílohu. Nastaví PENDING.

##### WF 03 - Chovatel · doklady čekají na posouzení

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Doklady byly odeslány k posouzení.
Zavření data nemění.

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Otevřít nebo stáhnout animal_document.file; file.file_reference; Akce u souboru Po kontrole přístupu nabídne soubor ke
file.file_name stažení.

##### WF 04 - Administrátor · fronta dokladů

Name Data binding Component Description

Zvíře a chovatel animal_document.animal_id; Text Zvíře a jeho vlastník.
animal.breeder_id; breeder.first_name;
breeder.last_name

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Odesláno animal_document.submitted_at Datum a čas Čas podání aktuální verze.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Posoudit Bez datové vazby Tlačítko Otevře konkrétní aktuální doklad
PENDING.

##### WF 05 - Administrátor · detail a posouzení dokladu

Name Data binding Component Description

Zvíře a chovatel animal_document.animal_id; Text Zvíře a jeho vlastník.
animal.breeder_id; breeder.first_name;
breeder.last_name

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Data zvířete animal.sex; animal.birth_date; Přehled údajů Zobrazí uložená data. Prázdné volitelné
animal.coat_color; animal.weight_kg; hodnoty ponechá bez obsahu.
animal.city; animal.pedigree_number;
animal.microchip_number;
animal.description

Fotografie animal.photos, animal_photo.photo_id, Tlačítko s počtem fotografií Otevře náhled aktuálních fotografií
animal_photo.file, zvířete. Přístup má administrátor
animal_photo.is_primary, oprávněný posuzovat jeho doklady. Bez
file.file_reference fotografií zobrazí zprávu, posouzení
zůstává dostupné.

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Otevřít nebo stáhnout animal_document.file; file.file_reference; Akce u souboru Po kontrole přístupu nabídne soubor ke
file.file_name stažení.

Posouzení a historie animal_document.version_number; Detail a historie Zobrazí číslo verze, návaznost, odeslání a
animal_document.previous_document_id; dostupné údaje rozhodnutí. Historie je
animal_document.submitted_at; dostupná v detailu.
animal_document.reviewed_by;
animal_document.reviewed_at;
animal_document.rejection_reason

Zpět na doklady Bez datové vazby Tlačítko Vrátí se do fronty bez rozhodnutí.

Zamítnout doklad Bez datové vazby Tlačítko Otevře povinný důvod zamítnutí.

Ověřit doklad Bez datové vazby Tlačítko Uloží APPROVED, administrátora a čas.
Důvod bude NULL.

##### WF 06 - Administrátor · důvod zamítnutí dokladu

Name Data binding Component Description

Důvod zamítnutí animal_document.rejection_reason Víceřádkové pole Povinný text.

Zrušit Bez datové vazby Tlačítko Zavře okno bez rozhodnutí.

Zamítnout doklad Bez datové vazby Tlačítko Uloží REJECTED, důvod, administrátora a
čas.

##### WF 07 - Administrátor · návrat do fronty

Návrat do fronty po posouzení.

Name Data binding Component Description

Zpráva nahoře Výsledek operace Zavíratelná zpráva Doklad byl posouzen. Zavření data
nemění.

Zvíře a chovatel animal_document.animal_id; Text Zvíře a jeho vlastník.
animal.breeder_id; breeder.first_name;
breeder.last_name

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Odesláno animal_document.submitted_at Datum a čas Čas podání aktuální verze.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Posoudit Bez datové vazby Tlačítko Otevře konkrétní aktuální doklad
PENDING.

##### WF 08 - Chovatel · výsledky u jednotlivých dokladů

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Stav dokladů Odvozeno z Stavový štítek Přednost má čekající doklad, pak
animal_document.assessment_status schválený, pak zamítnutý. Bez dokladů
Nedoložené. Jde jen o údaj UI.

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Stav dokladu animal_document.assessment_status Stavový štítek PENDING = K posouzení; APPROVED =
Ověřený; REJECTED = Zamítnutý.

Otevřít nebo stáhnout animal_document.file; file.file_reference; Akce u souboru Po kontrole přístupu nabídne soubor ke
file.file_name stažení.

Důvod zamítnutí animal_document.rejection_reason Text U zamítnutého dokladu zobrazí konkrétní
nedostatek.

Posouzení a historie animal_document.version_number; Detail a historie Zobrazí číslo verze, návaznost, odeslání a
animal_document.previous_document_id; dostupné údaje rozhodnutí. Historie je
animal_document.submitted_at; dostupná v detailu.
animal_document.reviewed_by;
animal_document.reviewed_at;
animal_document.rejection_reason

Doplnit doklad Bez datové vazby Tlačítko Otevře novou verzi aktuálního
zamítnutého dokladu.

##### WF 09 - Chovatel · doplnění zamítnutého dokladu

Name Data binding Component Description

Zvíře animal.animal_id; animal.animal_name; Název nebo karta Jméno zvířete.
animal.species; animal.breed

Doklad animal_document.document_id; Karta nebo řádek Typ a název aktuální přílohy. Typy:
animal_document.document_type; PEDIGREE, HEALTH_RESULTS,
animal_document.file; file.file_name BREEDING_APPROVAL.

Důvod zamítnutí animal_document.rejection_reason Text Důvod původního rozhodnutí.

Nový soubor animal_document.file; file.file_name; Výběr souboru Povinný. Zvíře a typ se převezmou z
file.file_reference předchozí verze.

Verze animal_document.version_number; Text Nová verze zvýší číslo o 1 a odkáže na
animal_document.previous_document_id předchozí. Starší soubor a výsledek
zůstanou v historii.

Zrušit Bez datové vazby Tlačítko Zavře formulář bez nové verze.

Odeslat novou verzi Bez datové vazby Tlačítko Uloží nový doklad PENDING. Údaje jeho
posouzení nastaví na NULL.

##### WF 10 - Administrátor · fotografie při posouzení dokladu

Name Data binding Component Description

Zvíře a doklad animal_document.animal_id, Kontext náhledu Zůstává zřejmé, ke kterému zvířeti a
animal.animal_name, dokladu se náhled vztahuje.
animal_document.document_type

Fotografie animal.photos, animal_photo.photo_id, Galerie s velkým náhledem Zobrazí aktuální fotografie daného
animal_photo.file, file.file_reference zvířete. Vybranou fotografii lze
prohlédnout ve větším náhledu. Fotografie
jsou pouze pro čtení.

Hlavní fotografie animal_photo.is_primary Výchozí výběr Jako první se zobrazí hlavní fotografie.

Bez fotografií Prázdný animal.photos Zpráva Nebyly nahrány žádné fotografie.
Posouzení dokladu je nadále dostupné.

Zavřít náhled Bez datové vazby Tlačítko Vrátí se k témuž dokladu bez uložení
rozhodnutí.

## UC-04 - Vytvořit nabídku

Chovatel vytvoří nabídku vlastního zvířete. V tomto UC také sleduje své nabídky a může je stáhnout. Ukončení platnosti probíhá automaticky.

#### Trigger List

Triggered by Trigger Description

Chovatel A Na dashboardu nebo v Moje nabídky zvolí Vytvořit nabídku.

Chovatel A V Moje nabídky zvolí Stáhnout nabídku.

Čas Nastane začátek nebo konec platnosti nabídky.

#### Pre-conditions

Chovatel je přihlášený a ověřený. Má vlastní uložené zvíře bez jiné nabídky ve stavu SCHEDULED nebo ACTIVE. Doklady zvířete ani jeho ověření nejsou povinné.

#### Post-conditions

Nová nabídka má identifikátor, vlastníka, odkaz na zvíře, kraj a platnost. Podle začátku je SCHEDULED nebo ACTIVE. Stažení nastaví WITHDRAWN. Konec platnosti nastaví
EXPIRED. Příslušné nevyřízené poptávky po ukončení dostanou EXPIRED a důvod.

### Hlavní scénář - vytvoření

#### Happy day scénář

1. Chovatel zvolí Vytvořit nabídku. – Systém otevře formulář. Nabídne vlastní zvířata bez jiné neukončené nabídky.
2. Chovatel vybere zvíře a kraj. – Kraj vybírá z rozbalovací nabídky krajů ČR. Volitelně napíše zprávu nabídky.

3. Chovatel nastaví platnost. – Výchozí volby jsou Ihned a Bez omezení. Po jejich vypnutí zadá odpovídající datum a čas.
4. Chovatel potvrdí vytvoření nabídky. – Systém znovu ověří vlastnictví, schválení účtu, kraj, platnost a nepřítomnost jiné neukončené nabídky. (A1, A2, A3)

5. Systém uloží nabídku. – Přidělí offer_id a uloží animal_id, region, zprávu, platnost a created_at. Vlastníka zjistí přes zvíře. Při volbě Ihned nastaví valid_from na čas
   vytvoření. Bez konce uloží valid_to = NULL. Začátek v budoucnu znamená SCHEDULED, jinak ACTIVE.

6. Systém otevře Moje nabídky a potvrdí vytvoření. – Uvede stav a platnost. Aktivní nabídka se zobrazí ve vyhledávání. Naplánovanou zatím vidí jen vlastník.

#### Alternativní toky

##### A1 - Chovatel zvolí Zrušit. (HDS 4)

1. Systém zobrazí výsledek kontroly. – Systém otevře Moje nabídky. Rozpracovaný formulář neuloží.

##### A2 - Chybí povinný údaj nebo je neplatný interval. (HDS 4)

1. Systém zobrazí výsledek kontroly. – Systém označí problém. Konec musí být později než začátek a nesmí být minulý. Chovatel opraví formulář a znovu potvrdí.

##### A3 - Zvíře již má naplánovanou nebo aktivní nabídku. (HDS 4)

1. Systém zobrazí výsledek kontroly. – Systém novou nabídku nevytvoří. Uvede, že existující nabídku je nutné nejprve ukončit. Kontrola a vytvoření proběhnou společně,
   aby nevznikly dva záznamy současně.

Stažení nabídky

#### Happy day scénář

1. Chovatel otevře Moje nabídky. – Systém zobrazí jeho nabídky včetně ukončených. U každé uvede zvíře, kraj, platnost a aktuální stav.

2. Chovatel u naplánované nebo aktivní nabídky zvolí Stáhnout nabídku. – Systém otevře potvrzení. Uvede ukončení nabídky i jejích nevyřízených poptávek. (A1)
3. Chovatel potvrdí stažení. – Systém ověří vlastníka a stav SCHEDULED nebo ACTIVE. Uloží WITHDRAWN. Její PENDING poptávky přejdou do EXPIRED. Poznámka
   Nabídka byla stažena se odvodí ze stavu nabídky. Záznamy se zachovají. (A2)
4. Systém potvrdí stažení v Moje nabídky. – Nabídka zmizí z vyhledávání. Pro stejné zvíře lze vytvořit nový záznam. Staženou nabídku nelze obnovit ani upravit.

#### Alternativní toky

##### A1 - Chovatel zvolí Zrušit. (HDS 2)

1. Systém zobrazí výsledek kontroly. – Systém otevře Moje nabídky. Rozpracovaný formulář neuloží.

##### A2 - Nabídka již skončila. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém zobrazí aktuální stav. Druhé ukončení výsledek nezmění.

Začátek a konec platnosti

#### Happy day scénář

1. Nastane začátek naplánované nabídky. – Pokud nebyla stažena a konec ještě nenastal, systém ji označí jako ACTIVE a zpřístupní ve vyhledávání.
2. Nastane konec platnosti nabídky. – Nabídka přejde do EXPIRED. Konec platnosti určuje valid_to. Již ji nelze vyhledat ani na ni odeslat poptávku. Pokud od poslední
   kontroly minul začátek i konec, nepoužije se jako aktivní.
3. Systém ukončí nevyřízené poptávky nabídky. – Její PENDING poptávky dostanou EXPIRED. Poznámka Platnost nabídky skončila se odvodí ze stavu nabídky. Oběma
   účastníkům zůstanou zachované. Nabídka bez valid_to automaticky nevyprší.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přihlášení, schválení účtu a oprávnění k danému záznamu. Po odhlášení vyžádá nové přihlášení. Při chybě nic částečně neuloží.
Zobrazí krátkou zprávu a umožní operaci zopakovat. Chybové a prázdné stavy používají stejné obrazovky.
Bez vlastního zvířete formulář nabídne přechod do Moje zvířata. Pokud už všechna vlastní zvířata mají neukončenou nabídku, systém vysvětlí, proč nelze vybrat další zvíře.
Nabídka se neuloží. Nabídku nelze upravovat ani znovu aktivovat. Při potřebě změny chovatel stáhne neukončenou nabídku a vytvoří novou. Zvíře s existující nabídkou nelze
odstranit.

#### Mockups & Wireframes

##### WF 01 - Chovatel · vytvoření nabídky

Name Data binding Component Description

Zvíře offer.animal_id Rozbalovací nabídka Povinný výběr vlastního zvířete bez
neukončené nabídky.

Kraj offer.region Rozbalovací nabídka Povinný výběr jednoho kraje ČR.

Platí od offer.valid_from Volba Ihned a datum s časem Ihned je výchozí. Po vypnutí se zpřístupní
datum a čas.

Platí do offer.valid_to Volba Bez omezení a datum s časem Bez omezení je výchozí. Znamená NULL.
Jinak konec následuje po začátku.

Zpráva nabídky offer.message Víceřádkové pole Volitelná.

Zrušit Bez datové vazby Tlačítko Návrat bez vytvoření nabídky.

Vytvořit nabídku Bez datové vazby Tlačítko Uloží naplánovanou nebo aktivní nabídku
a otevře Moje nabídky.

##### WF 02 - Chovatel · moje nabídky

Name Data binding Component Description

Zvíře offer.animal_id a aktuální Název zvířete Údaje z aktuálního profilu.
animal.animal_name

Kraj a platnost offer.region, offer.valid_from, Text Bez konce uvede Bez omezení.
offer.valid_to

Stav offer.status Stavový štítek Naplánovaná, Aktivní, Platnost skončila
nebo Stažená.

Stáhnout nabídku offer.offer_id Tlačítko Dostupné jen u SCHEDULED a ACTIVE.
Otevře potvrzení.

Vytvořit nabídku Bez datové vazby Tlačítko Otevře nový formulář. Existující nabídka
se neupravuje.

Potvrzení nahoře Výsledek operace Zavíratelná zpráva Potvrdí vytvoření nebo stažení. Zavření
data nemění.

##### WF 03 - Chovatel · potvrzení stažení nabídky

Name Data binding Component Description

Nabídka offer.offer_id a animal.animal_name Text Určí stahovanou nabídku.

Důsledek offer.status a inquiry.status Text potvrzení Ukončí nabídku. Nevyřízené poptávky
dostanou Vypršela a důvod Nabídka byla
stažena.

Zrušit Bez datové vazby Tlačítko Zavře potvrzení beze změny.

Stáhnout nabídku Bez datové vazby Tlačítko Po kontrole uloží WITHDRAWN. Zpětná
aktivace není dostupná.

## UC-05 - Vyhledat nabídku

Ověřený chovatel vyhledá aktivní nabídky pomocí jednoduchých filtrů.

#### Trigger List

Triggered by Trigger Description

Chovatel B Otevře dashboard Nabídky nebo potvrdí Vyhledat.

#### Pre-conditions

Chovatel je přihlášený a ověřený. Má dostupný dashboard Nabídky. Existence odpovídající nabídky není podmínkou.

#### Post-conditions

Systém zobrazí odpovídající aktivní nabídky nebo prázdný výsledek. Data nabídek ani zvířat se nemění.

### Hlavní scénář - vyhledání

#### Happy day scénář

1. Chovatel otevře Nabídky. – Systém zobrazí aktivní nabídky od nejnověji vytvořených a volitelné filtry Druh, Plemeno, Kraj a Pohlaví.

2. Chovatel zvolí požadovaná kritéria. – Plemena odpovídají druhu. Bez vybraného druhu je filtr plemene nedostupný. Změna druhu zruší dřívější výběr plemene.
   Všechny filtry lze ponechat prázdné.

3. Chovatel potvrdí Vyhledat. – Systém zkombinuje zadané filtry. Druh, plemeno a pohlaví čte z aktuálního zvířete, kraj z nabídky. Zahrne jen nabídky platné v okamžiku
   vyhledání. (A1)

4. Systém zobrazí výsledky. – Každá karta uvede hlavní fotografii, jméno, druh, plemeno, pohlaví a kraj. Při alespoň jednom aktuálním APPROVED dokladu zobrazí
   zelené Ověřeno. Výběr karty pokračuje do UC-06.

#### Alternativní toky

##### A1 - Žádná nabídka neodpovídá. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém zobrazí Nenašli jsme žádnou nabídku a ponechá filtry. Chovatel je může změnit nebo vymazat.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přihlášení, schválení účtu a oprávnění k danému záznamu. Po odhlášení vyžádá nové přihlášení. Při chybě nic částečně neuloží.
Zobrazí krátkou zprávu a umožní operaci zopakovat. Chybové a prázdné stavy používají stejné obrazovky.
Vymazat filtry vrátí výchozí seznam aktivních nabídek. Bez fotografie se použije zástupný obrázek. Naplánované, stažené a prošlé nabídky se nezobrazují. Vlastní aktivní
nabídka se může ve výsledcích objevit, odeslat poptávku na ni nelze.

#### Mockups & Wireframes

##### WF 01 - Chovatel · vyhledání nabídek

Name Data binding Component Description

Druh a plemeno animal.species a animal.breed Rozbalovací nabídky Volitelné. Plemeno závisí na druhu.

Kraj offer.region Rozbalovací nabídka Volitelné. Výchozí Všechny kraje.

Pohlaví animal.sex Rozbalovací nabídka Volitelné. Všechna, Samec, Samice.

Vyhledat a Vymazat filtry Bez datové vazby Tlačítka Použijí kritéria nebo obnoví výchozí
přehled.

Karta nabídky offer.offer_id, offer.region a aktuální data Karta s hlavní fotografií Jméno, druh, plemeno, pohlaví a kraj.
animal Otevře UC-06.

Ověřeno Odvozeno z aktuálních APPROVED Zelený odznak Alespoň jeden ověřený doklad.
dokladů

Prázdný výsledek Výsledek vyhledání Text Nenašli jsme žádnou nabídku. Filtry
zůstávají dostupné.

## UC-06 - Zobrazit detail nabídky

Ověřený chovatel si přečte nabídku a aktuální profil nabízeného zvířete. Doklady nejsou ke stažení.

#### Trigger List

Triggered by Trigger Description

Chovatel B Vybere aktivní nabídku z výsledků vyhledání.

#### Pre-conditions

Chovatel je přihlášený a ověřený. Vybraná nabídka je stále aktivní. Vlastník může své nabídky včetně ukončených zobrazit v Moje nabídky.

#### Post-conditions

Chovatel vidí údaje nabídky, údaje a fotografie zvířete a typy ověřených dokladů. Žádná data se nemění a kontakty zůstávají skryté.

### Hlavní scénář - zobrazení detailu

#### Happy day scénář

1. Chovatel otevře vybranou nabídku. – Systém ověří přístup a aktuální platnost.

2. Systém zobrazí kraj, platnost a zprávu nabídky. – Při valid_to = NULL uvede Bez omezení. Ze souvisejícího profilu načte všechny uložené údaje zvířete a jeho
   fotografie. Prázdné volitelné údaje zůstanou bez hodnoty.

3. Systém zobrazí ověření zvířete. – Při alespoň jedné aktuální verzi dokladu s APPROVED ukáže zelené Ověřeno u fotografie a seznam typů ověřených dokladů. Bez
   takového dokladu uvede Bez ověřených dokladů. Přílohy, čekající a zamítnuté doklady ani historie se nezpřístupní.

4. Chovatel se rozhodne, zda odešle poptávku. – U aktivní cizí nabídky může zvolit Odeslat poptávku a pokračovat do UC-07. U vlastní nabídky tato akce není dostupná.
   Zpět na nabídky vrátí výsledky se zachovanými filtry.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přihlášení, schválení účtu a oprávnění k danému záznamu. Po odhlášení vyžádá nové přihlášení. Při chybě nic částečně neuloží.
Zobrazí krátkou zprávu a umožní operaci zopakovat. Chybové a prázdné stavy používají stejné obrazovky.
Pokud nabídka mezi vyhledáním a otevřením skončila, systém zobrazí Nabídka již není aktivní a neumožní odeslání. Neexistující nebo nepřístupný záznam nezobrazí.
Zachování nabídky a poptávky pro účastníky se promítne do obrazovek US-08 až US-10. Zelený odznak vyjadřuje schválení alespoň jednoho dokladu, nikoliv ověření každého
údaje zvířete.

#### Mockups & Wireframes

##### WF 01 - Chovatel · detail nabídky

Name Data binding Component Description

Nabídka offer.region, offer.valid_from, Přehled Kraj, platnost a volitelná zpráva.
offer.valid_to, offer.message

Zvíře a fotografie offer.animal_id a aktuální animal Profil a galerie Všechny uložené údaje zvířete včetně
města, čipu, průkazu původu a popisu.
Fotografie se čtou z profilu.

Ověřeno Alespoň jeden aktuální doklad APPROVED Zelený odznak u fotografie Ověření je odvozené z aktuálních dokladů.

Ověřené doklady animal_document.document_type a Seznam typů Pouze aktuální APPROVED typy. Bez
assessment_status příloh, historie a údajů posuzovatele.

Zpět na nabídky Původní kritéria vyhledání Tlačítko Vrátí výsledky a zachová filtry.

Odeslat poptávku offer.offer_id Tlačítko Pouze aktivní cizí nabídka. Otevře UC-07.

Kontakty Bez datové vazby Informace Kontaktní údaje nejsou v detailu
dostupné.

## UC-07 - Odeslat poptávku

Ověřený chovatel odešle povinnou zprávu k cizí aktivní nabídce. Tato část končí potvrzením o odeslání.

#### Trigger List

Triggered by Trigger Description

Chovatel B V detailu aktivní cizí nabídky zvolí Odeslat poptávku.

#### Pre-conditions

Odesílatel je přihlášený a ověřený. Nabídka je aktivní a patří jinému ověřenému chovateli. Odesílatel k ní dosud nemá PENDING poptávku.

#### Post-conditions

Systém uloží poptávku s nabídkou, oběma účastníky, zprávou, časem a souhlasem odesílatele. Stav je PENDING. Kontakty se nezpřístupní.

### Hlavní scénář - odeslání

#### Happy day scénář

1. Chovatel otevře formulář poptávky. – Systém uvede jméno nabízeného zvířete a kraj, aby bylo zřejmé, na kterou nabídku reaguje.
2. Chovatel napíše zprávu. – Zpráva je povinná. Vlastní zvíře nevybírá. Pod formulářem je uvedeno, že odesláním souhlasí se zpřístupněním svých kontaktů pouze po
   budoucím schválení této poptávky.
3. Chovatel potvrdí Odeslat poptávku. – Systém znovu ověří oba ověřené účty, cizí aktivní nabídku, neprázdnou zprávu a nepřítomnost jiné PENDING poptávky stejného
   odesílatele k této nabídce. (A1, A2, A3, A4)
4. Systém uloží poptávku. – Přidělí inquiry_id. Uloží offer_id, sender_breeder_id a zprávu. Příjemce zjistí přes nabídku a její zvíře. Nastaví status = PENDING a
   submitted_at na čas odeslání, který současně vyjadřuje čas souhlasu s budoucím zpřístupněním kontaktů po schválení. Kontrola platnosti a uložení musí vyloučit
   odeslání po ukončení nabídky.

5. Systém potvrdí odeslání. – Zobrazí nabídku, odeslanou zprávu, čas a Čeká na vyřízení. Nezobrazí kontaktní údaje. Chovatel se může vrátit na nabídky.

#### Alternativní toky

##### A1 - Chovatel zvolí Zrušit. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém otevře detail nabídky. Rozpracovaný formulář neuloží.

##### A2 - Zpráva je prázdná. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém označí zprávu jako povinnou. Po doplnění lze odeslání zopakovat.

##### A3 - Stejný chovatel již má nevyřízenou poptávku. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém druhý záznam nevytvoří a uvede, že poptávka čeká na vyřízení. Kontrola a uložení proběhnou společně i při opakovaném
   kliknutí.

##### A4 - Nabídka již není aktivní. (HDS 3)

1. Systém zobrazí výsledek kontroly. – Systém poptávku neuloží a zobrazí Nabídka již není aktivní. Nabídne návrat na nabídky.

#### Common Alternative Flows

Systém při každém čtení a zápisu ověří přihlášení, schválení účtu a oprávnění k danému záznamu. Po odhlášení vyžádá nové přihlášení. Při chybě nic částečně neuloží.
Zobrazí krátkou zprávu a umožní operaci zopakovat. Chybové a prázdné stavy používají stejné obrazovky.
Na vlastní nabídku nelze reagovat. Další reakce stejného zájemce je možná až po vyřízení předchozí poptávky a jen u stále aktivní nabídky. Způsob vyřízení se doplní v US-08
až US-10. Při stažení nebo konci platnosti nabídky její PENDING poptávky vyprší s odpovídajícím důvodem podle UC-04. Záznamy se nesmažou.

#### Mockups & Wireframes

##### WF 01 - Chovatel · odeslání poptávky

Name Data binding Component Description

Vybraná nabídka inquiry.offer_id, animal.animal_name a Souhrn Pouze čtení. Vlastní zvíře zájemce se
offer.region nevybírá.

Zpráva inquiry.message Víceřádkové pole Povinný neprázdný text.

Souhlas inquiry.submitted_at Text u odeslání Odesláním souhlasí s budoucím
zpřístupněním kontaktů až po schválení.

Zrušit Bez datové vazby Tlačítko Vrátí detail bez odeslání.

Odeslat poptávku Bez datové vazby Tlačítko Zkontroluje aktivní cizí nabídku a
duplicitu. Uloží PENDING.

Chyba Výsledek kontroly Zpráva nebo označení pole Prázdná zpráva, již existující poptávka
nebo nabídka po skončení.

##### WF 02 - Chovatel · potvrzení odeslání

Name Data binding Component Description
Potvrzení nahoře Výsledek operace Zavíratelná zpráva Poptávka byla odeslána. Zavření data nemění.
Nabídka a zpráva inquiry.offer_id a inquiry.message Souhrn Zobrazí odeslanou zprávu a nabídku.
Stav a čas inquiry.status a inquiry.submitted_at Stavový štítek a text Čeká na vyřízení a čas odeslání.
Kontakty Bez datové vazby Informace Odeslání kontakty nezpřístupnilo.
Zpět na nabídky Bez datové vazby Tlačítko Otevře seznam aktivních nabídek.
