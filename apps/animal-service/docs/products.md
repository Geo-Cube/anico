---
title: Produkty a doménový model
source: products.pdf
language: cs
audience: AI agents
---

# Produkty a doménový model

> Strojově čitelný převod zdrojového PDF. Identifikátory atributů, enumy a kardinality jsou zachovány.

Product Overview
Hlavní produkty jsou Chovatel, Žádost o ověření účtu, Zvíře, Doklad zvířete, Nabídka a Poptávka. Fotografie a Soubor jsou vnořené struktury. Přihlášení a role patří do základní
správy uživatelů. Chovatel má nejvýše jednu žádost a libovolný počet zvířat. Každá žádost a každé zvíře patří jednomu chovateli. Zvíře může mít více dokladů včetně jejich
starších verzí. Každá verze patří jednomu zvířeti.

1 : 0..1 · má žádost 1 : 0..N · eviduje

Žádost o ověření Chovatel Zvíře

1 : 0..N · má doklady

Doklad zvířete

Chovatel
Profil chovatele zastupujícího chovatelskou stanici. Přihlášení a jeho identitu zajišťuje základní správa uživatelů.

Atributy
Název atributu Popis

breeder_id Datový typ: Identifikátor. Povinný a neměnný. Shoduje se s identifikátorem účtu.
Určuje vlastníka dat.

first_name Datový typ: Text. Povinné jméno z registrace. Chovatel ho může nastavit před prvním
podáním a při opravě vrácené žádosti.

last_name Datový typ: Text. Povinné příjmení z registrace. Chovatel ho může nastavit před
prvním podáním a při opravě vrácené žádosti.

email_address Datový typ: Text. Povinný e-mail z registrace. Systém na něj posílá výsledek ověření
účtu.

breeding_station_name Datový typ: Text / NULL. Povinný název stanice při podání žádosti. Před prvním
podáním NULL.

breeding_station_number Datový typ: Text / NULL. Povinné registrační číslo stanice při podání žádosti. Před
prvním podáním NULL.

is_verified Datový typ: Boolean. Hodnoty True a False. Po registraci False. Po schválení True.
Po zamítnutí False.

Žádost o ověření účtu
Jedna žádost chovatele. Obsahuje přílohy a výsledek jejich posouzení.

Atributy
Název atributu Popis

verification_request_id Datový typ: Identifikátor. Povinný a neměnný. Systém ho vytvoří při podání.

breeder_id Datový typ: Odkaz na Chovatele. Povinný odkaz na žadatele. Chovatel může podat
jen jednu žádost.

status Datový typ: ENUM: PENDING / RETURNED / APPROVED / REJECTED. PENDING = K
posouzení; RETURNED = Vráceno k doplnění; APPROVED = Schváleno; REJECTED =
Zamítnuto. Administrátor žádost schválí, konečně zamítne nebo vrátí chovateli k
doplnění.

submitted_at Datový typ: Datum a čas. Povinný čas podání. Později se nemění.

last_submitted_at Datový typ: Datum a čas. Čas posledního podání včetně opravy. submitted_at
uchovává první podání.

revision Datový typ: Celé číslo. První podání má 1. Každá oprava zvýší revizi o 1. Rozhodnutí
se vztahuje k posouzené revizi.

return_reason Datový typ: Text / NULL. Při RETURNED povinný důvod vrácení. Po novém podání
NULL.

review_history Datový typ: Seznam rozhodnutí. Uchovává výsledek, revizi, administrátora, čas a
případný důvod každého kola.

breeding_station_certificate Datový typ: Soubor. Povinný certifikát o chráněném názvu chovatelské stanice nebo
potvrzení o registraci na ČMSCH. Používá strukturu Soubor.

reviewed_by Datový typ: Identifikátor administrátora / NULL. Při podání NULL. Po rozhodnutí
identifikátor administrátora ze správy uživatelů.

reviewed_at Datový typ: Datum a čas / NULL. Při podání NULL. Po rozhodnutí čas jeho uložení.

rejection_reason Datový typ: Text / NULL. Při podání a schválení NULL. Při REJECTED povinný důvod
zamítnutí.

Zvíře
Profil vlastního zvířete. Obsahuje jeho data a fotografie. Plemena jsou uložená v konfiguračních souborech JSON. Aplikace je za běhu nemění.

Atributy
Název atributu Popis

animal_id Datový typ: Identifikátor. Povinný a neměnný. Systém ho vytvoří při přidání.

breeder_id Datový typ: Odkaz na Chovatele. Povinný a neměnný vlastník. Systém ho převezme z
přihlášení.

animal_name Datový typ: Text. Povinné jméno, po odstranění okolních mezer 1 až 120 znaků.

species Datový typ: Text. Povinný druh. Povolené hodnoty vychází ze souboru JSON: Pes,
Kůň.

breed Datový typ: Text. Povinné plemeno z číselníku, odpovídající vybranému druhu.

sex Datový typ: ENUM: MALE / FEMALE. Povinné. MALE = Samec; FEMALE = Samice.

birth_date Datový typ: Datum / NULL. Volitelné datum narození. Nejvýše dnešní datum.

coat_color Datový typ: Text / NULL. Volitelné zbarvení.

weight_kg Datový typ: Desetinné číslo / NULL. Volitelná hmotnost v kg. Vyplněná hodnota musí
být větší než 0.

city Datový typ: Text / NULL. Volitelné město nebo obec chovu. Přesná adresa se
neeviduje.

pedigree_number Datový typ: Text / NULL. Volitelné číslo průkazu původu. Samotné číslo neprokazuje
platnost dokladu.

microchip_number Datový typ: Text / NULL. Volitelné číslo čipu. Text zachová celý zápis.

description Datový typ: Text / NULL. Volitelný popis zvířete.

photos Datový typ: Seznam Fotografií zvířete. Volitelný seznam fotografií. Bez fotografií je
prázdný. Každá položka používá strukturu Fotografie zvířete.

Doklad zvířete
Jedna verze dokladu zvířete. Obsahuje přílohu a rozhodnutí administrátora.

Atributy
Název atributu Popis

document_id Datový typ: Identifikátor. Povinný a neměnný identifikátor konkrétní verze dokladu.

animal_id Datový typ: Odkaz na Zvíře. Povinný odkaz na zvíře. V celém řetězci verzí se nemění.

document_type Datový typ: ENUM: PEDIGREE / HEALTH_RESULTS / BREEDING_APPROVAL.
PEDIGREE = Průkaz původu; HEALTH_RESULTS = Zdravotní výsledky;
BREEDING_APPROVAL = Potvrzení o uchovnění. Povinný typ. V celém řetězci verzí
se nemění.

version_number Datový typ: Celé číslo. První verze má 1. Každá nová verze zvýší číslo předchozí
verze o 1.

previous_document_id Datový typ: Odkaz na Doklad zvířete / NULL. U první verze NULL. U doplnění
odkazuje na nahrazenou zamítnutou verzi.

file Datový typ: Soubor. Povinná příloha této verze. Používá strukturu Soubor.

assessment_status Datový typ: ENUM: PENDING / APPROVED / REJECTED. PENDING = K posouzení;
APPROVED = Ověřený; REJECTED = Zamítnutý. Po odeslání PENDING. Administrátor
doklad schválí nebo zamítne. Výsledek dané verze se pak nemění.

submitted_at Datový typ: Datum a čas. Povinný čas odeslání této verze.

reviewed_by Datový typ: Identifikátor administrátora / NULL. Před rozhodnutím NULL. Poté
identifikátor administrátora.

reviewed_at Datový typ: Datum a čas / NULL. Před rozhodnutím NULL. Poté čas uložení
rozhodnutí.

rejection_reason Datový typ: Text / NULL. Před rozhodnutím a při schválení NULL. Při REJECTED
povinný důvod zamítnutí.

Fotografie zvířete - vnořená struktura
Položka seznamu fotografií zvířete. Jde o vnořenou strukturu.

Atributy
Název atributu Popis

photo_id Datový typ: Identifikátor. Povinný identifikátor. Systém ho přidělí při uložení nové
fotografie. Při úpravě se zachová.

file Datový typ: Soubor. Povinný obrázek. Používá strukturu Soubor.

is_primary Datový typ: Boolean. Hodnoty True a False. Neprázdný seznam má právě jednu
hlavní fotografii s True. Ostatní mají False. Bez výběru je hlavní první fotografie.

Soubor - sdílená vnořená struktura
Sdílená struktura pro doklady a fotografie.

Atributy
Název atributu Popis

file_name Datový typ: Text. Povinný název nahraného souboru. Zobrazuje se uživateli.

file_reference Datový typ: Reference na uložený soubor. Povinná reference na uložený soubor.
Slouží k načtení, stažení a odstranění. Systém před použitím ověří oprávnění.

Vazby a rozhodnutí
Ve stavu PENDING se data chovatele a přílohy žádosti nemění. Po RETURNED je chovatel může opravit a znovu odeslat v téže žádosti. Bez nového certifikátu zůstává
původní. Schválení a zamítnutí jsou konečná. Historie rozhodnutí zůstává zachovaná. U dokladu zvířete lze doplnit jen aktuální zamítnutou verzi. Každá verze má nejvýše
jednoho přímého nástupce. Zvíře a typ zůstávají v řetězci stejné.

Nabídka
Samostatný záznam nabídky ke krytí. Uchovává vlastní podmínky a odkaz na zvíře. Údaje zvířete, fotografie a ověření se čtou z aktuálního profilu a do nabídky se nekopírují.
Název nabídky tvoří jméno zvířete. Vlastníka určuje animal_id → animal.breeder_id. Samostatně se neukládá.

Atributy
Název atributu Popis

offer_id Datový typ: Identifikátor. Povinný a neměnný. Systém ho přidělí při vytvoření nabídky.

animal_id Datový typ: Odkaz na Zvíře. Povinný a neměnný. Vytvořit lze jen nabídku vlastního
zvířete.

region Datový typ: Výběr z číselníku krajů ČR. Povinný kraj nabídky. Neodvozuje se z
volitelného animal.city.

valid_from Datový typ: Datum a čas. Ve formuláři volitelné. Při volbě Ihned systém uloží čas
vytvoření. Jinak uloží zadaný začátek platnosti.

valid_to Datový typ: Datum a čas / NULL. Volitelný konec platnosti. NULL znamená bez
časového omezení. Vyplněný konec musí následovat po začátku a nesmí být již
minulý.

message Datový typ: Text / NULL. Volitelná zpráva nabídky. Prázdný text se uloží jako NULL.

status Datový typ: ENUM: SCHEDULED / ACTIVE / EXPIRED / WITHDRAWN. Naplánovaná,
Aktivní, Platnost skončila, Stažená. Pravidla přechodů jsou uvedená níže.

created_at Datový typ: Datum a čas. Povinný čas vytvoření. Později se nemění.

Poptávka
Zájem ověřeného chovatele o konkrétní cizí nabídku. V této části vzniká a případně vyprší. Prohlédnutí a vyřízení přijaté poptávky a zobrazení kontaktů se doplní v US-08 až
US-10. Příjemcem je vlastník nabídky zjištěný přes nabídku a její zvíře. Samostatně se neukládá.

Atributy
Název atributu Popis

inquiry_id Datový typ: Identifikátor. Povinný a neměnný. Systém ho přidělí při odeslání
poptávky.

offer_id Datový typ: Odkaz na Nabídku. Povinný a neměnný. Nabídka musí být v okamžiku
odeslání aktivní a cizí.

sender_breeder_id Datový typ: Odkaz na Chovatele. Povinný odesílatel převzatý z přihlášení.

message Datový typ: Text. Povinná zpráva zájemce. Po odstranění okolních mezer nesmí být
prázdná. Poptávka neodkazuje na zvíře odesílatele.

status Datový typ: ENUM: PENDING / EXPIRED. PENDING = Čeká na vyřízení. EXPIRED =
Vypršela. Stavy vyřízení budou doplněné v US-08 až US-10.

submitted_at Datový typ: Datum a čas. Povinný čas odeslání a současného souhlasu s budoucím
zpřístupněním kontaktů po schválení. Později se nemění. Samotné odeslání
kontakty nezpřístupní.

Pravidla nabídek a poptávek
Pravidlo Popis

Naplánovaná nabídka SCHEDULED. Začátek platnosti je v budoucnu. Ve vyhledávání není vidět a nelze na
ni odeslat poptávku.

Aktivní nabídka ACTIVE. Začátek platnosti již nastal, konec je NULL nebo ještě nenastal a nabídka
nebyla stažena.

Vypršení nabídky Po dosažení valid_to přejde nabídka do EXPIRED. Již se nenabízí ve vyhledávání a
nepřijímá poptávky.

Stažení nabídky Vlastník může SCHEDULED nebo ACTIVE ukončit přechodem do WITHDRAWN.
Ukončené nabídky nelze upravit ani znovu aktivovat.

Jedna neukončená nabídka Pro jedno zvíře smí existovat nejvýše jedna nabídka ve stavu SCHEDULED nebo
ACTIVE. Po ukončení lze vytvořit nový záznam.

Jedna nevyřízená poptávka Stejný odesílatel smí mít ke stejné nabídce nejvýše jednu PENDING poptávku. Po
vyřízení může reagovat znovu, pokud je nabídka stále aktivní. Vyřízení se rozpracuje
později.

Ukončení nabídky a poptávky Každá její dosud PENDING poptávka přejde do EXPIRED. Důvod se zjistí ze stavu
nabídky: WITHDRAWN = Nabídka byla stažena, EXPIRED = Platnost nabídky
skončila. Důvod ani čas vypršení se v poptávce neukládají. Záznamy zůstanou
oběma účastníkům.

Změna a odstranění zvířete Změny profilu se ihned promítají do všech jeho nabídek. Zvíře s jakoukoliv existující
nabídkou nelze odstranit, ani když už nabídka skončila.

Ověřené zvíře Odvozený údaj. True právě tehdy, když má zvíře alespoň jednu aktuální verzi dokladu
s APPROVED. V nabídce se ukazují jen typy takto ověřených dokladů a zelený
odznak Ověřeno.

Přístup k dokladům a kontaktům Cizí přílohy, historie posouzení a kontakty zůstávají nedostupné. Odeslání poptávky
samo kontakty nezpřístupní.

Naplánovaná nabídka se při dosažení začátku stane aktivní. Kontrola platnosti se uplatní při vyhledání, otevření detailu i odeslání poptávky. Nabídka po konci platnosti
nepřijme poptávku ani před pozdějším uložením aktualizovaného stavu. Časy se uživateli zobrazují v českém místním čase. created_at určuje vytvoření a řazení od
nejnovějších, valid_from a valid_to platnost. Přesný čas ručního stažení se neeviduje.

Kraje ČR
Pevný číselník pro nabídku a filtr. Výběr nabídky je povinný, filtr umožňuje Všechny kraje. Obce, vzdálenost ani další země se v této části neřeší.
Hlavní město Praha, Středočeský kraj, Jihočeský kraj, Plzeňský kraj, Karlovarský kraj, Ústecký kraj, Liberecký kraj, Královéhradecký kraj, Pardubický kraj, Kraj Vysočina,
Jihomoravský kraj, Olomoucký kraj, Zlínský kraj, Moravskoslezský kraj.

Vazby nabídky a poptávky
Jedno zvíře může mít více postupně ukončených nabídek, ale nejvýše jednu neukončenou. Každá nabídka patří jednomu zvířeti. Jejím vlastníkem je vlastník tohoto zvířete.
Každá poptávka patří jedné nabídce a má jednoho uloženého odesílatele. Příjemce se zjistí přes nabídku a zvíře. Původní diagram výše zachycuje evidenci a doklady,
následující diagram doplňuje nabídky a poptávky.

1 : N · eviduje

Chovatel Zvíře

1 : N · odesílá 1 : N · nabídky v čase

N : 1 · reaguje na

Poptávka Nabídka
