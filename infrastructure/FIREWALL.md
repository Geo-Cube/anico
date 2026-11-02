# Hetzner firewall

Firewall `11862789` (`anico-shared`) je připojený k serveru `171254722`.
Autoritou jsou `src/index.ts` a lokální `Pulumi.shared.yaml` se zapnutým
`attachFirewall: true`. Jde o firewall v síti Hetzneru před serverem, nikoli UFW.

| Směr     | Provoz                   | Povolený zdroj / cíl |
| -------- | ------------------------ | -------------------- |
| Příchozí | TCP 22 (SSH)             | `89.203.190.9/32`    |
| Příchozí | ICMP (diagnostika, PMTU) | IPv4 a IPv6          |
| Příchozí | Ostatní                  | Zakázáno             |
| Odchozí  | Vše                      | Povoleno             |

Porty 80, 443, 8000, 6001, 6002 ani databázové porty nejsou veřejně povolené.
SSH přes IPv6 není povolené, dokud nepřidáme konkrétní administrátorskou IPv6 `/128`.
Veřejné HTTPS obsluhuje Cloudflare; konektor vytváří odchozí Tunnel. Ani budoucí
veřejná produkce proto nepotřebuje otevřít příchozí 80/443 na VPS.
Coolify komunikuje s hostitelem po interní Docker síti.

## Ověření

Z kořene repozitáře:

```bash
npm run verify:firewall -w @anico/infrastructure -- --require-attached
npm run verify:admin -w @anico/infrastructure
```

První kontrola přes Hetzner API ověřuje skutečné připojení a přesná pravidla,
odmítne další firewall a přes nové SSH spojení bez multiplexingu ověří zdrojovou
IP, cílový server, port, veřejné TCP listenery a zdraví konektoru. Potřebuje
`HCLOUD_TOKEN`, lokální Pulumi state a SSH klíč. Pro jiný alias přidej
`--ssh-host TVUJ_ALIAS`. Před prvním připojením firewallu vynech `--require-attached`;
tato kontrola očekává již běžící Docker a Tunnel, není určena pro čisté VPS.

Druhá kontrola ověřuje veřejné HTTPS a Access. Po nasazení prošla také kontrola
`ansible-playbook verify-coolify.yml`, včetně interního SSH Coolify → hostitel.
Z jiné nepovolené veřejné IP jsme SSH nezkoušeli; omezení zdroje ověřujeme
proti skutečným pravidlům API.

## Změna administrátorské IP

Do `sshCidrs` nejdřív přidej novou skutečnou IP vedle původní. Nepovoluj `/0`.
Pokud už se IP změnila, Pulumi můžeš spustit i bez SSH, protože používá API:

```bash
npm run preview -w @anico/infrastructure -- --stack shared --diff
npm run up -w @anico/infrastructure -- --stack shared
```

Ověř nové spojení z nové IP, pak odeber starou IP a změnu znovu aplikuj.
Nespouštěj současně dva zápisy do stejného state. Proměnné v shellu mají přednost
před `.env.local`; pokud používáš token ze souboru, starý export odstraň přes
`unset HCLOUD_TOKEN`.

## Nouzový přístup

Použij Hetzner Cloud konzoli nebo obnov pravidla přes API/Pulumi. Síťový firewall
se neopravuje příkazem UFW uvnitř serveru. V konzoli lze dočasně přidat konkrétní
novou IP; stejnou změnu přenes do IaC, jinak ji příští `up` vrátí. Úplné odpojení
firewallu použij pouze jako poslední dočasnou možnost.

Připojení je chráněné Pulumi `protect`; přepnutí `attachFirewall` na `false`
po aktivaci proto samo nestačí k jeho odstranění. Ochranu nevypínej při běžné
obnově, při výměně serveru měníme `serverId` a zachováváme firewall.

Pravidla jsou stavová a změna nemusí ukončit existující spojení. Další připojené
firewally mohou povolit další provoz. Podrobnosti:
[oficiální Hetzner FAQ](https://docs.hetzner.com/cloud/firewalls/faq/).
