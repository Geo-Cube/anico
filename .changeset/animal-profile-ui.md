---
'@anico/frontend': minor
---

Napojení správy zvířat UC-02 na animal-service: stránkovaný seznam, detail,
vytvoření a úprava profilu s fotografiemi jedním požadavkem, hlavní fotografie
a potvrzené smazání. HTTP klient podporuje multipart při zachování CSRF,
validace odpovědí a rozlišení chyb přihlášení, oprávnění a dostupnosti.
Úprava odesílá pouze změněné údaje, aby nepřepisovala nezměněná pole souběžných
úprav. Potvrzení smazání používá přístupný dialog s ovládáním klávesnicí
a návratem focusu na spouštěč.
