# Navazující práce po dohodě týmu na stacku

Dohoda z 22. 10. 2026: současný infrastrukturní základ ponecháme běžet.
Zbývající nasazení a provozní nastavení připravíme společně po odsouhlasení
celého aplikačního stacku. Níže uvedené položky jsou odložené, nikoli hotové.
Před prvním produkčním nasazením se k tomuto seznamu vrátíme.

## Současný ověřený stav

- Aplikační monorepo nově zahrnuje React + TypeScript frontend přes Vite
  v `apps/frontend`. Návod pro tým je v [manuálu](../docs/MANUAL-PRO-VYVOJARE.md).
  Frontend zatím nemá router, přihlášení ani napojení API; cloudové nasazení čeká.

- Docker, rotace logů, live restore a oddělené sítě/volumes dev a produkce.
- Coolify a interní Traefik přes Cloudflare Tunnel.
- `admin.anico.online` za Cloudflare Access s konkrétním správcem; běžný
  přístup bez SSH tunelu potvrzený v prohlížeči.
- Hetzner firewall: SSH jen z administrátorské IP, ICMP, ostatní příchozí porty zavřené.
- Obnovovací postup a místní recovery kopie, ověřený import Pulumi state
  a dešifrování secrets. Úplná obnova na náhradním VPS zatím neproběhla.
- Aplikace a databázové služby pro dev/prod ještě nejsou nasazené.

## Rozhodnutí a realizace v navazující fázi

- [x] Přesunout e-mailové allowlisty mimo verzované soubory do šifrovaného Pulumi
      nastavení `accessMembers` (29. 10. 2026). Členy evidujeme GitHub loginem;
      jejich adresy se spravují podle [soukromého postupu](ACCESS-MEMBERS.md).

- [x] Rozhodnutí 29. 10. 2026: GitHub SSO do Coolify; `Geo-Cube` Owner,
      ostatní schválení kolegové Admin. Všech sedm evidovaných členů týmu má vytvořené
      Admin účty a jejich adresy jsou jen v šifrované konfiguraci.
      Čistý Owner GitHub OAuth průchod potvrzený v prohlížeči.
- [x] Doplnit identity `tom-606`, `KatGall`, `thurukidor-ux` do soukromého
      `coolifyTeam` a admin allowlistu a vytvořit jim Admin účty přes IaC
      (29. 10. 2026). GitHub účet `thurukidor-ux` odpovídá označení „thudor“.
- [x] Přidat `matejjanasek` jako dalšího Admina přes šifrovanou konfiguraci,
      Cloudflare allowlist a Ansible (29. 10. 2026).
- [x] Přidat `MoncaBrancuska` jako Admina Coolify přes šifrovanou IaC
      konfiguraci a poslat GitHub pozvánku s Write oprávněním (29. 10. 2026).
      GitHub pozvánku musí přijmout a vlastní přihlášení do Coolify ještě ověřit.
- [ ] Ověřit vlastní první přihlášení všech sedmi členů týmu přes GitHub.
      Tyto role nedávají automaticky code owner ani GitHub Write oprávnění.

- [x] Doplnit `@Zlytata` jako druhého code ownera vedle `@Geo-Cube`
      do lokálního CODEOWNERS (29. 10. 2026).
- [x] Ověřit Write oprávnění účtu `Zlytata` a CODEOWNERS v obou větvích;
      aktivovat ochranu `main`/`dev` bez výjimek (29. 10. 2026).
      Ruleset ID `26148882`, živá pravidla ověřená přes GitHub API;
      viz [pravidla review](../docs/PRAVIDLA-REVIEW.md).

- [ ] Potvrdit stack v týmu, včetně databáze, případného brokeru, API kontraktů
      a struktury kódu. Přejmenování na `abl`/`dao`/`controller` dosud není schválené.
- [x] Přidat GitHub login metodu do existujících admin/dev Access aplikací přes
      Pulumi, vedle OTP a se zachováním allowlistů (28. 10. 2026). API a veřejné testy prošly.
- [x] Ověřit GitHub přihlášení správce v prohlížeči: průchod až na login stránku
      Coolify potvrzený po doplnění jeho GitHub primary e-mailu.
- [ ] Doplnit členy týmu, požadavky na zabezpečení jejich GitHub účtů a rozhodnout
      o případné OTP záloze. Přihlášení Coolify nyní používá přímé GitHub OAuth.
      Samostatné skupiny
      vývojářů a správců; přístup k devu sám nedává správu Coolify ani produkce.
- [ ] Domluvit databáze pro lokálně běžící aplikace: možnost osobních logických
      DB v neprodukční instanci se samostatnými omezenými účty, jednotným seedem
      a přístupem přes šifrovaný tunel bez VPN. Nasazený dev musí mít vlastní DB.
      Alternativou je již připravená lokální MongoDB přes Compose. Rozhodnutí
      o umístění DB a způsobu tunelování ještě nepadlo; připravit jeden vstupní
      příkaz pro vývojáře podle finálního stacku.
- [x] Zavést vlastní účty Coolify a role Owner/Admin; všech sedm členů týmu má
      připravený Admin účet. Viz [SSO postup](COOLIFY-SSO.md).
- [ ] Připravit produkční Dockerfiles, health/readiness kontroly, konfiguraci
      a graceful shutdown podle finálního stacku.
- [ ] Zavést CI pro sestavení a registry images, kontroly změn, dev deployment,
      schvalované produkční nasazení a rollback na předchozí image.
- [ ] Nastavit projekty a obě prostředí v Coolify; oddělené DB účty, secrets,
      sítě a data. Dev nesmí používat produkční data nebo přístupy.
- [ ] Připravit přístup CI/testů/webhooků přes Access bez interaktivního OTP
      podle skutečných potřeb; žádné sdílené heslo pro celý tým.
- [ ] Publikovat dev až po nastavení jeho přístupů. Produkce na
      `anico.online` bude veřejná, s vlastní aplikační autentizací/autorizací.
      Root/dev DNS dosud zůstaly původní A záznamy; přechod na Tunnel musí být řízený IaC.
- [ ] Změřit spotřebu na 2 vCPU / 4 GB RAM / 40 GB disku; nastavit CPU/RAM/PID
      limity, vhodnou souběžnost buildů a bezpečné čištění starých images.
- [ ] Doplnit sledování dostupnosti, volného disku, paměti, zdraví služeb
      a upozornění na chyby.
- [ ] Připravit zálohy aplikačních DB a uploadů i Coolify DB, APP_KEY
      a potřebných serverových souborů; stanovit frekvenci, retenci a cíl mimo VPS.
- [ ] Uložit šifrovanou kopii Pulumi state, passphrase a lokálních secrets mimo Mac.
      Současná `.pulumi/recovery/` je pouze místní kopie, ne off-device záloha.
- [ ] Ověřit úplnou obnovu na čistém náhradním VPS a obnovu databázových záloh;
      zapsat výsledky, potřebné ruční kroky a dobu obnovy do `RECOVERY.md`.
- [ ] Dohodnout aktualizace OS/Dockeru/Coolify, připnutí balíčkových verzí
      a postup údržby/rebootu. Úvodní instalační secrets z dřívějšího technického
      výpisu před nasazením vyřešit podle poznámky v `COOLIFY.md`.

Zdrojový předpis musí být uložený v Gitu a vzdáleném repozitáři; secrets,
state a databázové zálohy do Gitu nepatří. Gitignore nenahrazuje kontrolu
obsahu změn ani případné budoucí skenování secrets v CI.

Související postupy: [obnova](RECOVERY.md), [firewall](FIREWALL.md),
[Coolify](COOLIFY.md), [Cloudflare](CLOUDFLARE.md).
