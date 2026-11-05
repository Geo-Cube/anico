# ADR-0004: Vrácení žádosti o ověření k doplnění (RETURNED)

- Stav: přijato; schválil vlastník produktu 5. 11. 2026 jako vědomou odchylku od analýzy
- Datum: 2026-11-05
- Souvisí: [návrh UC-01](../design/uc-01-overeni-chovatele.md) §0, §2–§4,
  [ADR-0001](0001-zadost-o-overeni-vnorena-v-chovateli.md), [ADR-0003](0003-e-mail-po-ulozeni-rozhodnuti.md),
  [`anico-domain.md`](../anico-domain.md) §5 UC-01

## Kontext

Analýza (`anico-domain.md` §5 UC-01 body 1, 3, 5 a 8) říká, že chovatel podá nejvýše jednu žádost za život,
podaná data se nemění a rozhodnutí admina je konečné. Admin tak mohl jen schválit, nebo trvale zamítnout – i kvůli
drobné chybě (překlep v čísle stanice, nečitelný sken certifikátu). Vlastník produktu 5. 11. 2026 schválil třetí
výsledek posouzení: vrácení žádosti chovateli k doplnění. Původní analytické soubory v repozitáři nejsou
(`docs/business/` chybí), proto je odchylka zaznamenaná zde a poznámkou ve výtahu `anico-domain.md`.

## Rozhodnutí

1. Nový stav `RETURNED`. Admin (role `admin` nebo `owner`) rozhodne jen ze `PENDING` jedním ze tří výsledků:
   `APPROVED`, `REJECTED` (povinný `rejectionReason`), `RETURNED` (povinný `returnReason`, po trim 1–500 znaků).
2. `REJECTED` a `APPROVED` zůstávají konečné. Počet vrácení není omezený. Admin data žádosti neupravuje – opravu
   provádí výhradně chovatel.
3. `POST /breeders/me/verification-request` je povolen ve stavech `NOT_SUBMITTED` a `RETURNED`; jinak 409 +
   `current`. Oprava je jeden podmíněný `findOneAndUpdate` (filtr: `RETURNED`, totéž `requestId` a certifikát, ze
   kterého oprava vychází) – souběžné opravy ani souběh s jiným zápisem nevytvoří dvě kola.
4. Certifikát je při opravě nepovinný: bez souboru zůstává původní; nový soubor nahradí starý a starý se smaže až
   po úspěšném zápisu (best effort, selhání se jen zaloguje). Povinnost se určuje z uloženého stavu, ne z klienta.
5. Žádost zůstává jedním vnořeným subdokumentem (ADR-0001 platí). Přibyla pole `lastSubmittedAt` (poslední vstup
   do `PENDING`), `returnReason`, `revision` (bod 9) a `reviewHistory[]` (`decision`, `revision`, `reviewedBy`,
   `reviewedAt`, `reason`; nejstarší první). `submittedAt` je první podání a nemění se. `reviewedBy`/`reviewedAt`
   nesou poslední rozhodnutí; po opětovném podání jsou ve stavu `PENDING` `null` a předchozí kola zůstávají
   v historii.
6. Fronta admina bez `?status` vrací jen `PENDING`, řazení podle `lastSubmittedAt` vzestupně, limit 500; souhrn
   obsahuje i `returned`. Index fronty je `{ verificationRequest.status, verificationRequest.lastSubmittedAt }`.
7. Notifikace se posílá i pro `RETURNED` (důvod + možnost opravit a znovu odeslat). E-mail u `REJECTED` výslovně
   uvádí, že zamítnutí je konečné a žádost nelze podat znovu. Platí ADR-0003 (až po uložení, vývojový adaptér jen
   loguje).
8. Existující data doplní migrace `20261105110409-verification-return-history.mjs` (`lastSubmittedAt` ze
   `submittedAt`, `returnReason: null`, historie z dosavadního rozhodnutí, nový index fronty místo indexu nad
   `submittedAt`). Musí proběhnout před nasazením verze s tímto rozhodnutím.
9. **Optimistická kontrola revize.** Vrácení a oprava nemění `requestId`, takže samotná podmínka „stejné ID a
   `PENDING`“ by dovolila rozhodnutí načtenému před vrácením schválit novou, dosud neposouzenou opravu (admin A
   otevře detail, admin B vrátí, chovatel opraví s jiným certifikátem, admin A schválí ze starého detailu).
   Žádost proto nese `revision` (1 při prvním podání, +1 atomicky v zápisu opravy `RETURNED` → `PENDING`)
   a každé rozhodnutí musí uvést `revision`, kterou admin posoudil (bez ní 400). Zápis rozhodnutí filtruje
   `requestId` + `PENDING` + `revision`; když neuspěje, služba žádost znovu načte: neexistuje → 404, není
   `PENDING` → 409 `Verification already decided`, je `PENDING` v jiné revizi → 409
   `Verification revision mismatch`; obojí s `current`, bez e-mailu. Položka historie ukládá revizi, o které se
   rozhodlo. Existující data doplní migrace `20261105160000-verification-submission-revision.mjs` (bod 8 se nemění).

## Alternativy

- **Zamítnout a dovolit nové podání** (pole žádostí, ADR-0001 „Důsledky“). Mění význam `REJECTED` z konečného
  na opakovatelný, vyžaduje kolekci nebo pole žádostí a migraci struktury. Zamítnuto: vlastník chce `REJECTED`
  ponechat konečné.
- **Úprava dat adminem.** Admin by opravoval cizí údaje bez souhlasu chovatele a ztratila by se stopa, kdo co
  podal. Zamítnuto.
- **Jen přepsat poslední rozhodnutí** bez historie. Jednodušší, ale ztratí důvody dřívějších vrácení (audit O7).
  Zamítnuto ve prospěch `reviewHistory`.
- **Nové `requestId` při každé opravě** místo revize. Rozbilo by stabilní odkazy (URL detailu, certifikátu) i
  unikátní index a historii pod jedním ID. Zamítnuto.
- **ETag / `If-Match` hlavička** místo pole v těle. Stejná sémantika, ale revize v těle je viditelná ve schématu
  (Zod, OpenAPI) a v historii. Zamítnuto jako zbytečná druhá konvence.

## Důsledky

- Odchylka od analýzy: invarianty „max. 1 podání“ a „data po podání neměnná“ platí jen do vrácení; po `RETURNED`
  smí chovatel údaje i certifikát změnit. `APPROVED` a `REJECTED` dál konečné.
- Historie roste s každým kolem bez limitu (vrácení nejsou omezená); dokument zůstává malý (desítky položek), limit
  16 MB není reálné riziko.
- Pořadí chyb podání: 400 (chybějící soubor tam, kde je povinný, nebo nevalidní pole) < 409 (stav neumožňuje podání)
  < 415 (obsah souboru).
- Bez migrace nemají staré žádosti `lastSubmittedAt` a mapování odpovědi selže: `GET /breeders/me`, detail,
  rozhodnutí i fronta obsahující takovou žádost vrací 500. Migrace je proto podmínkou nasazení.
- Klient (administrace) musí posílat `revision` z detailu nebo fronty; při 409 `Verification revision mismatch`
  zobrazí `current` (novou verzi podání) k novému posouzení. Rozhodnutí bez `revision` je 400.
- Revize roste jen opravou; vrácení ji nemění. Migrace revizí: položka historie na indexu _i_ dostane
  1 + počet `RETURNED` před ní; žádost 1 + počet `RETURNED` v historii, ve stavu `RETURNED` jen počet `RETURNED`
  (poslední vrácení ještě nebylo opraveno), nejméně 1. Uložené hodnoty se nepřepisují (idempotentní).
