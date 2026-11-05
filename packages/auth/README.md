# @anico/auth

Sdílený Express middleware pro ověřování krátkodobé identity AniCo a kontrolu rolí.
Příklady a bezpečnostní hranice: [kontrakt identity](../../docs/AUTENTIZACE.md).

`@anico/auth/testing` poskytuje čistou fixture pro unit testy; neobchází HTTP autentizaci.
Produkční služby nesmějí akceptovat libovolné x-user-* hlavičky ani klíče dodané klientem.
