# Dokončení profilu po prvním přihlášení

**Domluvený onboardingový tok, zatím neimplementovaný; frontend má jen připravené místo.**
Tento dokument uchovává rozhodnutí pro další práci; nevytváří nový registrační formulář s heslem.
Lokální `breeder-service` už obsahuje backend UC-01 pro ověření chovatele:
`GET /breeders/me` idempotentně převezme profil podle ověřeného `req.auth.userId`
a vrátí stav žádosti. To není dokončení onboardingu. Endpoint pro uložení
doplňujících údajů a označení profilu jako dokončeného zatím neexistuje.
Služba není nasazená a frontendové simulace na její API nejsou napojené.

## Cesta uživatele

1. Uživatel se přihlásí přes Google nebo Microsoft. Auth-service zajistí AniCo účet,
   jeho `userId` a role; nový účet má roli `breeder`.
2. Frontend zjistí stav profilu přihlášeného uživatele v breeder-service.
3. Pokud profil není dokončený, zobrazí formulář doplňujících údajů, například IČO.
4. Po validním uložení breeder-service označí profil jako dokončený.
5. Uživatel s dokončeným profilem se při dalších přihlášeních dostane rovnou na dashboard.

Rozhoduje uložené dokončení profilu, například `onboardingCompletedAt`, nikoli počet
přihlášení. Zavření formuláře, výpadek nebo odhlášení před uložením znamená, že se
formulář při dalším přihlášení nabídne znovu. Výpadek API nesmí být považovaný za hotový profil.

## Odpovědnosti

- **Auth-service:** přihlášení, automatické založení účtu, identita a role.
- **Breeder-service:** doplňující údaje, validace a stav dokončení profilu. Profil váže
  na ověřené AniCo `userId` a může ho založit při prvním přístupu; opakování nesmí vytvořit duplicitu.
- **Frontend:** podle skutečného stavu zobrazí formulář nebo dashboard. Místo zapojení je
  `apps/frontend/src/features/profile/ProfileGate.tsx`: leží v chráněném toku před
  dashboardem i před bezpečným `returnTo`, takže se uplatní na každý návrat po přihlášení.
  Dokud API neexistuje, propouští dál a nic nepředstírá; po zapojení přesměruje nedokončený
  profil na formulář se zachováním `returnTo` a při výpadku API nabídne opakování.
- **Doménové backendy:** u operací, které dokončený nebo schválený profil vyžadují,
  stav ověří také na serveru. Samotné přesměrování v UI není kontrola oprávnění.

Schválení chovatele administrátorem je samostatný stav. Vyplnění formuláře
neznamená schválení a nepřiděluje roli `admin`. Pravidla dostupnosti funkcí před
schválením musí určit konkrétní use case.

Profil je podle `userId`, nikoli podle e-mailu. Google/Microsoft účty zůstávají
oddělené, pokud je uživatel výslovně nepropojí.

Tento tok nepotřebuje čekat na `user.registered`, broker ani animal consumer.
Animal-service nyní tento profil nezakládá a žádnou komunikaci s breeder-service nepřidáváme.
Existující registrační publisher tímto dokumentem nevypínáme ani nemažeme.

## Před implementací dohodnout

- Přesný seznam údajů, pravidla jejich změn a povinnost IČO pro jednotlivé typy chovatelů.
- API pro uložení vlastního onboardingového profilu a dokončení; existující `GET /breeders/me` slouží UC-01. Cesta `/api/breeder/me` je pouze návrh budoucího gateway routingu, nikoli dostupný onboardingový endpoint.
- Stav rozepsaného, dokončeného a případně schvalovaného profilu.
- Chování dashboardu a dostupné operace při čekání na schválení.

## Akceptace budoucí implementace

- Nový účet vidí doplňující formulář; po uložení dashboard.
- Dokončený profil formulář znovu nevyžaduje.
- Nedokončený profil vyžádá doplnění i po opětovném přihlášení.
- Neplatné údaje neoznačí profil za dokončený; cizí profil nelze upravit.
- Opakované uložení či současné otevření nevytvoří duplicitní profil.

[Identita pro backendy](INTEGRACE-IDENTITY.md) · [aktuální stav](STAV-PROJEKTU.md)
