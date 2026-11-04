# animal-documents

Frontend UC-03 _Doložit údaje o zvířeti_ na straně chovatele. Celé běží proti simulovanému
API, backend dokladů zatím není napojený.

| Wireframe          | Obsah                                                         | Soubor                 |
| ------------------ | ------------------------------------------------------------- | ---------------------- |
| WF 03-01           | Záložka Doklady, prázdný stav a stav bez čipu                 | `DocumentOverview.tsx` |
| WF 03-02           | Formulář nahrání: řádky typ + soubor, postupné odesílání      | `UploadForm.tsx`       |
| WF 03-03, WF 03-08 | Čekající doklady, výsledky a rozbalení historie verzí v kartě | `DocumentOverview.tsx` |
| WF 03-09           | Doplnění zamítnutého dokladu novou verzí                      | `ResupplyForm.tsx`     |

Administrátorská část (WF 03-04 až 03-07) sem nepatří.

## Vložení do stránky

```tsx
import { AnimalDocumentsFeature } from './features/animal-documents';

<AnimalDocumentsFeature
  animal={animal}
  onBack={() => zpetNaSeznam()}
  readOnly={animal.ownerUserId !== identity.userId}
/>;
```

- `animal`: zvíře ve tvaru `AnimalSchema` + `microchipNumber` (`string | null`).
- `onBack`: návrat z obrazovky dokladů. Dnes ji volá i „Můj účet“ a „Odhlásit“.
- `readOnly` (výchozí `false`): cizí zvíře. Skryje „Nahrát doklady“, „Doplnit doklad“ a formuláře,
  zůstane seznam, stavy, historie a otevření souboru. Hodnotu počítá rodič, protože jen on zná
  přihlášeného uživatele: `animal.ownerUserId !== identity.userId`. Je to jen úprava UI,
  skutečnou kontrolu vlastnictví dělá backend (403).

Stránku může otevřít jen rodič, který zvíře zná. V `App.tsx` je zatím dočasný vstup pro ukázku.

## Simulace

`documents-mock.ts` drží data v paměti (po obnovení stránky se vrátí na začátek) a každé volání
zpozdí o 250 ms. „Otevřít“ míří na budoucí cestu API, takže v ukázce soubor nevrátí.

Lišta „Testování DoD“ (`DevTestBar.tsx`) přepíná:

| Volba                             | Co ukáže                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Zvíře                             | Rex (ověřený, zamítnutý, čekající doklad a historie), pes bez čipu, kůň bez dokladů („Průkaz koně“) |
| Cizí zvíře                        | Stav `readOnly`                                                                                     |
| Chyba 500 při nahrání             | Každý doklad, nebo každý druhý (částečné selhání)                                                   |
| Simulovat CSRF 403 (a opakování)  | První pokus selže, nové načtení tokenu a jedno opakování projde                                     |
| Simulovat „doklad už byl doplněn“ | Souběh při doplnění: odmítnutí, načtení aktuální verze a varování                                   |
| Simulovat chybu načtení           | Chybový stav seznamu se „Zkusit znovu“                                                              |

## Napojení na API

Obrazovky volají jen `listDocuments`, `uploadDocument`, `uploadNewVersion` a `fileUrl`. Při napojení
stačí tyto funkce nahradit `fetch` voláními se stejným tvarem a odebrat `DevTestBar`, `MOCK_ANIMALS`
a dočasný vstup v `App.tsx`. Otevřené otázky jsou v zadání UC-03, kap. 9. Potřeba je hlavně:

- **Cesta:** veřejná cesta není určená, drží se jen v `DOCUMENTS_API_BASE` (dočasně
  `/api/breeding/documents`).
- **Backend:** chybí seznam dokladů zvířete, verze, výsledek posouzení, endpoint pro novou verzi
  a `microchipNumber` u zvířete. Router dokladů není zapojený v `app.ts`.
- **Upload:** `FormData` s poli `file`, `animalId`, `documentType`. `Content-Type` nenastavovat
  ručně, boundary doplní prohlížeč. Použít `credentials: 'same-origin'` a `redirect: 'error'`.
- **CSRF:** každý `POST` potřebuje `X-CSRF-Token` z `GET /api/auth/session` (pole `csrfToken`).
  Při `403` s `CSRF_REJECTED` token znovu načíst a požadavek jednou zopakovat, jako
  `withCsrfRetry` v mocku.
- **Převod dat:** backendový camelCase převést na snake_case typy UI na jednom místě a kódy typů
  přes `BACKEND_DOCUMENT_TYPES`. API bude posílat čas v ISO, proto `submitted_at` a `reviewed_at`
  převést přes `formatDateTime`.
- **Chyby:** `formatApiError` už mapuje odpovědi podle tabulky v zadání, stačí házet
  `DocumentsApiError`. Formát a velikost hlídá klient, backend je dnes vrací jako 500.
