# Správa infrastruktury

**Jen pro správce VPS. Vývojářům stačí [lokální návod](../docs/MANUAL-PRO-VYVOJARE.md).**
Příkazy jsou z kořene repozitáře, není-li výslovně uvedeno jinak.

## Současný stav

- Jeden Hetzner VPS: Ubuntu 26.04, ARM64, 2 CPU / 4 GB RAM / 40 GB.
- Docker, rotace logů, live restore, oddělené dev/prod sítě a volumes.
- Coolify + Traefik za Cloudflare Tunnel a GitHub Access.
- Dev frontend/backend a MongoDB běží; produkční aplikace ani DB zatím ne.
- IaC používá existující server. Náhradní VPS zatím vytváří správce v Hetzneru.
- Pulumi state a passphrase jsou na Macu. Automatické zálohy a úplná obnova VPS ještě nejsou hotové.

## Najdi konkrétní úlohu

| Úloha                              | Návod                                   |
| ---------------------------------- | --------------------------------------- |
| Zkontrolovat, co ukazuje Coolify   | [Coolify přehled](COOLIFY.md)           |
| Přidat nebo odebrat člena          | [Přístupy](ACCESS-MEMBERS.md)           |
| Osobní DB účty a serverová MongoDB | [Dev databáze](DEV-DATABASE.md)         |
| Nasazení, proměnné a rollback      | [Dev nasazení](../docs/DEV-NASAZENI.md) |
| DNS, Tunnel a strojový přístup CI  | [Cloudflare](CLOUDFLARE.md)             |
| GitHub login a Coolify role        | [SSO](COOLIFY-SSO.md)                   |
| Změna SSH IP                       | [Firewall](FIREWALL.md)                 |
| Ztráta serveru nebo Macu           | [Obnova](RECOVERY.md)                   |
| Co zbývá                           | [Checklist](NEXT-STEPS.md)              |

## Než použiješ IaC

Potřebuješ Node/npm, Pulumi CLI, Ansible, správný SSH alias a původní soukromé soubory:
`infrastructure/.env.local`, `infrastructure/Pulumi.shared.yaml`,
`infrastructure/ansible/inventory.local.yml`, `.pulumi/state`, `.pulumi/passphrase`
a `.pulumi/coolify.env`. Instalace nástrojů na macOS:

```bash
brew install ansible pulumi/tap/pulumi
npm ci
```

Existující stack je `shared`. **Nevytvářej nad živými prostředky nový prázdný stack.**
Chybí-li state nebo heslo, nejprve použij [obnovovací postup](RECOVERY.md).

## Změna cloudu: vždy build → plán → apply

Uprav zdrojový předpis nebo šifrovaný config. Potom:

```bash
npm run build -w @anico/infrastructure
env -u HCLOUD_TOKEN npm run pulumi -w @anico/infrastructure -- preview --stack shared --save-plan ../.pulumi/change.plan
```

Zkontroluj, že plán mění pouze zamýšlené prostředky. Teprve pak:

```bash
env -u HCLOUD_TOKEN npm run pulumi -w @anico/infrastructure -- up --stack shared --plan ../.pulumi/change.plan --yes
```

`../.pulumi` je relativní k npm workspace `infrastructure`. Plán i state jsou mimo Git.
`env -u HCLOUD_TOKEN` použije token ze souboru místo případného starého exportu v shellu.
Pulumi běží z `dist`, proto po změně TypeScriptu nevynechávej build.

## Konfigurace hostitele a kontroly

```bash
npm run bootstrap -w @anico/infrastructure
```

Tento příkaz mění VPS: Docker, sítě, Tunnel, Coolify a zapnuté dev komponenty.
**Nemění cloudové DNS ani firewall, neimportuje DB data a sám nespustí aplikační release.**
Kernelová údržba a reboot jsou samostatné explicitní kroky.

```bash
npm run verify:firewall -w @anico/infrastructure -- --require-attached
npm run verify:admin -w @anico/infrastructure
bash infrastructure/ansible/check-local.sh
```

Jen při potřebě Ansible kontroly přejdi do `infrastructure/ansible`:

```bash
cd infrastructure/ansible
ansible-playbook verify-coolify.yml
ansible-playbook verify-environments.yml
```

Před dalšími kořenovými příkazy se vrať přes `cd ../..`.
Neprováděj změny současně dvěma Pulumi procesy. Secrets nevypisuj přes `--show-secrets`.

## Výjimečná údržba Dockeru

Také z `infrastructure/ansible`; běžný vývojář tyto příkazy nepotřebuje:

| Příkaz                                         | Účel a dopad                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `ansible-playbook audit.yml`                   | Čtecí audit hostitele                                                  |
| `ansible-playbook docker.yml`                  | Instalace/nastavení Dockeru; může restartovat daemon                   |
| `ansible-playbook docker-logging.yml`          | Rotace logů; vyžaduje žádné běžící kontejnery, může restartovat Docker |
| `ansible-playbook docker-lifecycle.yml`        | Zapnutí live restore a reload konfigurace                              |
| `ansible-playbook verify-docker-lifecycle.yml` | Test restartu daemonu, jen na jinak prázdném hostiteli                 |

Současný VPS je provozovaný, lifecycle test na něm běžně nespouštěj.
Live restore nechrání před rebootem celého serveru; o start po rebootu se starají restart policies.
