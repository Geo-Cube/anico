# ADR-0003: E-mail o výsledku až po uložení rozhodnutí

- Stav: přijato pro MVP (D8 průvodce, K12 briefu); produkční doručování je blokující závislost (návrh O3)
- Datum: 2026-11-04
- Souvisí: [návrh UC-01](../design/uc-01-overeni-chovatele.md) §4, §9
- Doplněno: [ADR-0004](0004-vraceni-zadosti-k-doplneni.md) – e-mail i pro vrácení k doplnění (`RETURNED`);
  věta o jediném podání u zamítnutí nyní zní „zamítnutí je konečné, žádost nelze podat znovu“

## Kontext

Po rozhodnutí „systém pošle chovateli e-mail“ na uloženou adresu (UC-01 HDS 8); u zamítnutí s důvodem a informací,
že žádost lze podat pouze jednou (A1.6). Rozhodnutí musí zůstat uložené i při chybě doručení a výsledek je vždy
vidět v „Můj účet“ (`anico-domain.md` 5.8, R11). Tým zatím nevybral e-mailového providera a v repozitáři není
žádná e-mailová infrastruktura ani fronta zpráv.

## Rozhodnutí

1. Port `DecisionNotifier.notifyDecision(breeder: Breeder): Promise<void>` v `domain/ports.ts`.
2. Obsah e-mailu je čistá, testovaná funkce `domain/decision-email.ts` (předmět + text): schválení; zamítnutí
   s důvodem a větou o jediném podání. Adresát = `breeder.emailAddress`.
3. Use-case `decideVerificationRequest` volá notifier **až po** úspěšném atomickém zápisu a jen ve vítězném
   požadavku (ne při 409/404). Chyba notifieru se zachytí, zaloguje `logger.warn` (bez těla e-mailu) a výsledek
   rozhodnutí se vrátí beze změny.
4. Adaptér `infrastructure/logging-decision-notifier.ts` je **vývojový**: zaloguje `breederId`, výsledek a to, že
   e-mail nebyl doručen; adresu, jméno, důvod ani tělo nezapisuje. `server.ts` při startu zaloguje varování, že
   doručování e-mailů není nakonfigurované. Není to náhrada produkčního doručení.

## Alternativy

- **Outbox ve stejném dokumentu** – rozhodnutí v témže `$set` zapíše i `decisionNotification: { status: 'PENDING' }`,
  samostatný worker e-mail odešle a označí jako odeslaný (s retry). Atomické bez transakcí (ADR-0001) a odolné
  proti pádu procesu. Odloženo: bez providera není co spolehlivě doručovat; doplnění nemění port ani use-case
  kromě jednoho pole v zápisu.
- **Samostatná notifikační servisa / message queue.** Nová infrastruktura bez potvrzené potřeby. Zamítnuto pro MVP.

## Důsledky

- Rozhodnutí nikdy neselže kvůli e-mailu; chovatel vidí výsledek v „Můj účet“.
- Při pádu procesu mezi zápisem a odesláním nebo při chybě provideru se e-mail ztratí a nezopakuje (vědomé riziko
  D8). V MVP se v praxi neodesílá nic – před produkcí je nutné vybrat providera a nahradit adaptér.
- Skutečný adaptér by měl mít časový limit, aby pomalý provider neblokoval odpověď adminovi; při požadavku na
  spolehlivé doručení přejít na outbox.
- Testy ověřují: notifier volán po uložení právě jednou, nevolán při 409, jeho výjimka nemění 200 ani uložený stav.
