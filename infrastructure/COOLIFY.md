# Co máš vidět v Coolify

Otevři **https://admin.anico.online** a přihlas se přes GitHub.
V projektu **AniCo** je toto očekávané rozložení:

| Kde                   | Co má být                          | Stav                           |
| --------------------- | ---------------------------------- | ------------------------------ |
| `dev`                 | Služba `anico-dev-applications`    | `running:healthy`              |
| Uvnitř služby         | Komponenty `frontend` a `backend`  | Obě `running:healthy`          |
| `prod`                | Zatím žádné aplikace               | Prázdné prostředí je v pořádku |
| Servers → `localhost` | Stejný VPS, na kterém běží Coolify | Není potřeba druhý server      |

**`Service` zde znamená Compose sestavu se dvěma kontejnery.** Nula samostatných
`Applications` u prostředí není chyba: komponenty jsou uvnitř této služby.
MongoDB je spravovaná přímo Ansiblem, proto se v seznamu databází této služby
neukazuje. `coolify-db` a `coolify-redis` slouží samotné administraci, nikoli AniCo.

## Co v UI používat

Prohlížej stav komponent, deployment logy a chyby. Dev web otevři přes
`https://dev.anico.online`; backend je pod `/api`.
Dlouhá image reference `@sha256:…` je správně: určuje konkrétní sestavenou verzi.

Domény, image reference, sdílené proměnné, členství a hlavní proxy konfiguraci
upravuj přes IaC. Ruční změna pouze v UI nemusí přežít další apply nebo obnovu.
Neprováděj UI upgrade/reset proxy mimo kontrolovanou změnu IaC.

## Pouze správce: instalace a kontrola

Z kořene projektu, s původními soukromými soubory:

```bash
npm run deploy:coolify -w @anico/infrastructure
npm run verify:admin -w @anico/infrastructure
```

Podrobná čtecí kontrola z adresáře `infrastructure/ansible`:

```bash
ansible-playbook verify-coolify.yml
```

Verze a digesty jsou v [coolify.json](coolify.json). Ansible vlastní instalaci,
Docker logging a hlavní Traefik; Coolify spouští dev aplikační sestavu.
Veřejné porty aplikací ani DB neotevíráme. Traefik má přístup k Docker socketu
záměrně; správa Coolify proto znamená vysoké oprávnění k serveru.

Přihlášení, role a nouzový SSH přístup: [SSO](COOLIFY-SSO.md).
Nasazení a proměnné: [dev postup](../docs/DEV-NASAZENI.md).
