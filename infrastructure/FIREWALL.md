# SSH a firewall

**Povolujeme SSH jen z administrátorských IP. Web i DB jdou přes Tunnel.**
Firewall `anico-shared` má příchozí TCP 22 z `sshCidrs`, ICMP pro diagnostiku
IPv4/IPv6 a jinak příchozí provoz blokuje. Odchozí spojení jsou povolená.
Konkrétní IP a server ID jsou v soukromém Pulumi configu.

## Ověření z kořene projektu

```bash
npm run verify:firewall -w @anico/infrastructure -- --require-attached
npm run verify:admin -w @anico/infrastructure
```

První příkaz ověří Hetzner pravidla, připojení firewallu, nové SSH spojení,
veřejné listenery a Tunnel. Potřebuje správní token, state a SSH klíč.

## Mění se tvoje veřejná IP

1. Do `sshCidrs` přidej konkrétní novou `/32` nebo IPv6 `/128` vedle původní IP.
2. Projdi [uložený cloudový plán a apply](README.md). Pulumi používá API a nemusí mít SSH.
3. Ověř nové SSH spojení z nové sítě.
4. Teprve potom odeber starou IP a znovu aplikuj změnu.

Nepovoluj `/0`. Další připojené Hetzner firewally mohou povolit další provoz;
kontrola je proto ověřuje také. Změna stavového firewallu nemusí ukončit starou session.

## Když se odřízneš

Použij Hetzner konzoli nebo API/Pulumi, ne UFW uvnitř serveru.
Nouzovou změnu v konzoli přenes zpět do IaC. Běžně nevypínej `protect` ani
neodpojuj firewall; při výměně serveru měníme `serverId` a zachováváme pravidla.
