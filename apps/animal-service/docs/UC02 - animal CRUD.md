# UC-02 - Přidat zvíře

## Cíl

Chovatel vytvoří profil vlastního zvířete. Může přidat fotografie a následně profil zobrazit, upravit nebo odstranit.

## Trigger

### Přidání nového zvířete

- Chovatel otevře **Moje zvířata**.
- Zvolí **Přidat zvíře**.

### Úprava nebo odstranění

- Chovatel otevře detail vlastního zvířete.
- Zvolí **Upravit profil** nebo **Odstranit zvíře**.

## Pre-conditions

- Chovatel je přihlášen.
- `breeder.is_verified = true`.
- Pro úpravu nebo odstranění existuje uložené zvíře.

## Post-conditions

### Přidání

- Vznikne nové zvíře.
- Je přidělen identifikátor.
- Je nastaven vlastník.
- Jsou uložena data a fotografie.

### Úprava

- Data a fotografie jsou aktualizovány.
- Identifikátor zvířete zůstává zachován.
- Vlastník zůstává zachován.

### Odstranění

- Je odstraněn profil zvířete.
- Jsou odstraněny fotografie.
- Jsou odstraněny všechny verze dokladů.
- Je odstraněna historie dokladů.

---

## Main Flow - Přidání zvířete

1. Chovatel otevře **Moje zvířata**.
2. Systém ověří přihlášení a ověřený účet.
3. Systém zobrazí seznam zvířat.
4. Chovatel zvolí **Přidat zvíře**.
5. Systém zobrazí formulář.
6. Chovatel vyplní údaje o zvířeti.
7. Chovatel volitelně přidá fotografie.
8. Chovatel zvolí **Přidat zvíře**.
9. Systém provede validaci dat.
10. Systém vytvoří záznam zvířete.
11. Systém uloží fotografie.
12. Systém zobrazí detail nově vytvořeného zvířete.

## Alternative Flows

### AF-01 Zrušení vytvoření

- Uživatel zvolí **Zrušit**.
- Formulář se uzavře.
- Nedojde k uložení dat.

### AF-02 Neplatná data

- Chybí povinné údaje.
- Nebo nevyhovuje nahraný soubor.
- Systém označí chybná pole.
- Uživatel může data opravit a pokračovat.

---

## Main Flow - Úprava zvířete

1. Chovatel otevře detail vlastního zvířete.
2. Zvolí **Upravit profil**.
3. Systém načte existující data.
4. Chovatel upraví údaje nebo fotografie.
5. Zvolí **Uložit změny**.
6. Systém provede validaci.
7. Systém uloží změny.
8. Systém zobrazí aktualizovaný profil.

## Main Flow - Odstranění zvířete

1. Chovatel otevře detail zvířete.
2. Zvolí **Odstranit zvíře**.
3. Systém zobrazí potvrzení.
4. Chovatel odstranění potvrdí.
5. Systém ověří oprávnění.
6. Systém odstraní profil, fotografie i doklady.
7. Systém zobrazí přehled zvířat.

## Business Rules

- Druh zvířete je povinný.
- Plemeno je povinné.
- Pohlaví je povinné.
- Datum narození nesmí být v budoucnosti.
- Hmotnost musí být větší než 0.
- Podporované formáty fotografií jsou JPEG a PNG.
- První fotografie se automaticky nastaví jako hlavní, pokud uživatel nevybere jinou.
- Bez čísla čipu nelze zvíře ověřit.
- Doklady se spravují v UC-03.

## Related Screens

- WF-01 Přehled zvířat
- WF-02 Přidání zvířete
- WF-03 Nahrání fotografií
- WF-04 Detail zvířete
- WF-05 Úprava profilu
- WF-07 Potvrzení odstranění
