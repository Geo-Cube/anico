# UC-07 - Integrace pro frontend

Tento dokument popisuje backendovou implementaci odeslání poptávky. Business scénář,
podmínky i wireframy jsou popsány v `business-use-cases.md`.

## API cesta

Poptávka se odesílá na:

```text
POST /api/animal/offers/{offerId}/inquiries
```

Slouží-li komponenta přímo lokální nebo testovací backend bez gateway prefixu,
pro backendový endpoint se používá cesta `/offers/{offerId}/inquiries`.

Požadavek musí mít:

- přihlášenou identitu z existující AniCo session;
- aktivní cizí nabídku;
- ověřeného odesílatele;
- ověřeného vlastníka nabídky.

Frontend identitu ani vlastníka poptávky nepředává. Identity se bere backendem z
ověřeného přihlášení. Nepoužívat klientské `breederId`, `ownerUserId`,
`senderBreederId` ani `x-user-*` hlavičky.

## Tělo požadavku

Použít sdílené schéma `CreateInquirySchema` a typ `CreateInquiryInput` z
`@anico/shared-schemas`.

```json
{
  "message": "Zajímá mě krytí"
}
```

Pravidla:

- tělo je striktní; neznámá pole vyvolají `400`;
- `message` je povinné;
- okolní bílé znaky se oříznou;
- prázdná nebo pouze mezerová zpráva je `400`;
- délka po ořezu je `1` až `1000` znaků.

Frontend může stejnou kontrolu provést před odesláním, ale server ji musí vyhodnotit
vždy znovu.

## Úspěšná odpověď

Status je `201`, tělo je ve tvaru `SubmitInquiryResponseSchema`:

```json
{
  "id": "64f000000000000000000001",
  "offerId": "64f000000000000000000002",
  "animalName": "Luna",
  "regionId": "jihomoravsky",
  "message": "Zajímá mě krytí",
  "status": "PENDING",
  "submittedAt": "2026-11-20T18:30:00.000Z"
}
```

Vlastnosti:

- `id` - identifikátor nové poptávky;
- `offerId` - nabídka, ke které poptávka patří;
- `animalName` - pouze pro potvrzení, na kterou nabídku uživatel reagoval;
- `regionId` - stabilní ID kraje z katalogu `regions.json`;
- `message` - uložená zpráva po ořezu;
- `status` - při odeslání vždy `PENDING`;
- `submittedAt` - čas odeslání ve formátu ISO 8601; vyjadřuje současně souhlas
  s budoucím zpřístupněním kontaktů.

Odpověď už neobsahuje identitu odesílatele ani kontaktní údaje. Tyto údaje frontend
nesmí očekávat ani zobrazovat po odeslání.

## Potvrzovací obrazovka

Po `201` zobrazit:

- zavíratelné potvrzení „Poptávka byla odeslána“;
- souhrn nabídky s `animalName` a českým názvem kraje;
- odeslanou `message`;
- stav `PENDING` a datum/čas `submittedAt`;
- informaci, že odeslání kontakty zatím nezpřístupnilo;
- akci „Zpět na nabídky“.

Český název kraje získat přes existující katalog z
`@anico/shared-schemas`/`regions()`, nikoli vložením samostatného číselníku do
komponenty.

Tlačítko odeslání po kliknutí vypnout nebo jinak ochránit před opakovaným kliknutím.
Backend opakování identifikuje jako konflikt, takže druhé kliknutí nesmí vytvářet
druhou PENDING poptávku.

## Umožnění vstupu do formuláře

Formulář otevřít pouze z aktivní cizí nabídky. UI musí nabídku označit jako
nedostupnou pro vlastní nabídku.

Před odesláním nelze vybrat vlastní zvíře; poptávka reaguje přímo na vybranou nabídku.
Tlačítko „Zrušit“ nemění serverová data a má vrátit detail nabídky.

Pod formulářem uvést souhlas z business use case:

> Odesláním souhlasíte se zpřístupněním svých kontaktů pouze po budoucím schválení této poptávky.

Frontend tuto informaci nebere jako okamžité přijetí nebo zveřejnění kontaktu.

## Chybové odpovědi

Backend používá konzistentní tvar `{ "error": "...", ... }`. Existující HTTP klient
má zachovat 401, 403, 404, 409 a 5xx odpovědi podle společného projektu.

### `400 Validation failed`

```json
{
  "error": "Validation failed",
  "issues": [
    {
      "code": "too_small",
      "path": ["message"],
      "message": "Message is required"
    }
  ]
}
```

Použití:

- označit pole zprávy;
- zobrazit krátkou lokalizovanou chybu pro prázdnou nebo příliš dlouhou zprávu;
- neuzavírat formulář ani neměnit jiná klientská data.

Z `400` může také přijít `Invalid JSON` nebo obecná validační chyba, ale pro UC-07
je primární problém na poli `message`.

### `401`

Chybí platná session. Využít stávající globální přesměrování na přihlášení.

### `403`

Ověřený účet je podmínkou. Příklady backendových zpráv:

- `Breeder is not verified` - odesílatel není ověřený;
- `Offer owner is not verified` - vlastník nabídky není ověřený;
- `Breeder verification unavailable` se vrací jako `503`, nikoli `403`.

Frontend má 403 zobrazit na formulářové obrazovce a nepokračovat do potvrzení.

### `404`

Není dostupná nabídka. Cizí i neexistující nabídka může být zobrazena stejně:

- `Offer not found`

Pro vlastní nabídku se také vrátí `404`; frontend ji má přesto již z UI skrývat.

### `409`

Možné zprávy:

```json
{ "error": "Offer is no longer active" }
```

Nebo:

```json
{
  "error": "Offer is no longer active",
  "current": {
    "id": "64f000000000000000000002",
    "status": "WITHDRAWN"
  }
}
```

`current.status` může být `SCHEDULED`, `EXPIRED` nebo `WITHDRAWN`.

Další možný konflikt:

```json
{
  "error": "Inquiry is already pending"
}
```

UX při neaktivní nabídce:

- zobrazit „Nabídka již není aktivní“;
- nabídnout návrat na seznam nabídek;
- nezobrazovat potvrzení odeslání.

UX při duplicitě:

- zobrazit, že poptávka již čeká na vyřízení;
- formulář neodesílat opakovaně;
- nabídnout návrat na detail či seznam nabídek.

Backend kontroluje platnost a zápis atomicky; frontend nesmí konflikt jen
předpokládat nebo znovu posílat požadavek automaticky.

### `413`

Tělo požadavku přesahuje serverový limit:

```json
{ "error": "Payload too large" }
```

Pro UC-07 je příliš velký vstup zprávou už omezen na 1000 znaků, ale infrastruktura
pro velikost těla může být zachycena globálně.

### `500`, `503`

- `500` - krátká obecná chyba, nabídnout opakování;
- `503` - projekci ověřených chovatelů nelze přečíst;
- po opakování musí operace zopakovat serverovou kontrolu.

## Ověřování nabídky před formulářem

Detail nabídky je `GET /offers/{offerId}` (v gateway `/api/animal/offers/{offerId}`) a nese
`canSendInquiry` s `inquiryUnavailableReason`. Frontend zobrazí formulář jen při
`canSendInquiry === true`. Server ho počítá z podmínek UC-07: nabídka je `ACTIVE`, je cizí
a čtenář k ní nemá `PENDING` poptávku (detail navíc čte jen ověřený chovatel). Jinak frontend
podle `inquiryUnavailableReason` vysvětlí proč (`OWN_OFFER`, `NOT_ACTIVE`, `INQUIRY_PENDING`).

I při `canSendInquiry === true` může server vrátit `409`, protože nabídka může v době
odeslání skončit nebo být stažena.

## Exportované kontrakty

Frontend má používat exporty z `@anico/shared-schemas`:

- `CreateInquirySchema`;
- `CreateInquiryInput`;
- `SubmitInquiryResponseSchema`;
- `SubmitInquiryResponse`;
- `InquiryStatusSchema`;
- `InquiryStatus`;
- `RegionIdSchema`;
- `regions()`.

Zdrojový OpenAPI artefakt je
`apps/animal-service/openapi.json`, cesta `submitInquiry` a komponenty
`CreateInquiry`/`SubmitInquiryResponse`.

## Zásah mimo tento use case

UC-07 neimplementuje:

- seznam odeslaných poptávkou;
- vyřízení přijaté poptávky;
- schválení nebo zamítnutí poptávky;
- zpřístupnění nebo zobrazení kontaktů;
- změnu a expirační poznámku poptávky.

Tyto části budou v US-08 až US-10. Po odeslání kontakty frontend neukazuje.
