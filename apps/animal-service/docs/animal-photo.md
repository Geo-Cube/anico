# Fotografie zvířete

Položka seznamu fotografií zvířete.

Jde o vnořenou strukturu používanou v atributu `animal.photos`.

## Atributy

### `photo_id`

- **Typ:** Identifikátor
- **Povinné:** Ano
- **Popis:** Systémem přidělený identifikátor fotografie.
- **Chování:** Při vytvoření nové fotografie vznikne nový identifikátor. Při úpravách se zachovává.

### `file`

- **Typ:** Soubor
- **Povinné:** Ano
- **Popis:** Obrázek fotografie.
- **Struktura:** `File`

### `is_primary`

- **Typ:** Boolean
- **Povinné:** Ano
- **Hodnoty:**
  - `true`
  - `false`
- **Pravidla:**
  - Neprázdný seznam obsahuje právě jednu hlavní fotografii.
  - Hlavní fotografie má hodnotu `true`.
  - Ostatní fotografie mají hodnotu `false`.
  - Pokud uživatel hlavní fotografii nevybere, použije se první fotografie v seznamu.
