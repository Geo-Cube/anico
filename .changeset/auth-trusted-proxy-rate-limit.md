---
'@anico/auth-service': patch
---

Opravuje sdílený auth IP bucket za Traefikem explicitním allowlistem konkrétních proxy a tunnel adres. Nedůvěryhodné sockety ignorují forwarded hlavičky; limit 120/min, standardní IPv6 /56 a dosavadní výjimky zůstávají zachované. Dev předpis načítá allowlist vytvořený Ansible ze souboru při startu; změna vyžaduje schválený rollout, sama nic nenasazuje.
