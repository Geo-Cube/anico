# Zvíře

Profil vlastního zvířete. Obsahuje jeho základní údaje a fotografie.

Druhy a plemena psů a koní (cca 250 položek, česky) jsou uloženy v konfiguračním souboru JSON. Aplikace tento soubor za běhu nemění.

## Atributy

### `animal_id`

- **Typ:** Identifikátor
- **Povinné:** Ano
- **Neměnné:** Ano
- **Popis:** Systémem generovaný identifikátor vytvořený při založení zvířete.

### `breeder_id`

- **Typ:** Odkaz na chovatele
- **Povinné:** Ano
- **Neměnné:** Ano
- **Popis:** Identifikátor vlastníka zvířete. Převzat z přihlášeného uživatele.

### `animal_name`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Volitelné jméno zvířete. Pokud není vyplněno, zobrazuje se druh, případně plemeno a krátký identifikátor.

### `species`

- **Typ:** Text
- **Povinné:** Ano
- **Hodnoty:**
  - `DOG`
  - `HORSE`
- **Popis:** Druh zvířete definovaný v konfiguračním JSON.

### `breed`

- **Typ:** Text
- **Povinné:** Ano
- **Popis:** Plemeno odpovídající vybranému druhu z číselníku.

### `sex`

- **Typ:** ENUM
- **Povinné:** Ano
- **Hodnoty:**
  - `MALE` – samec
  - `FEMALE` – samice

### `birth_date`

- **Typ:** Datum | `NULL`
- **Povinné:** Ne
- **Validace:** Nesmí být v budoucnosti.

### `coat_color`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Zbarvení srsti.

### `weight_kg`

- **Typ:** Desetinné číslo | `NULL`
- **Povinné:** Ne
- **Validace:** Pokud je vyplněno, musí být větší než `0`.

### `city`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Město nebo obec chovu.
- **Poznámka:** Přesná adresa se neeviduje.

### `pedigree_number`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Číslo průkazu původu.
- **Poznámka:** Samotné číslo neprokazuje platnost dokladu.

### `microchip_number`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Evidenční číslo mikročipu.
- **Poznámka:** Hodnota se ukládá beze změny formátu.

### `description`

- **Typ:** Text | `NULL`
- **Povinné:** Ne
- **Popis:** Volný textový popis zvířete.

### `photos`

- **Typ:** Seznam fotografií zvířete
- **Povinné:** Ne
- **Výchozí hodnota:** Prázdný seznam
- **Popis:** Kolekce fotografií přiřazených ke zvířeti.
- **Struktura položky:** `Fotografie zvířete`.

## Chování

Odstranění zvířete odstraní:

- záznam zvířete,
- fotografie,
- doklady,
- historii dokladů.
