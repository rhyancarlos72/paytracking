# PayTracking no VPS (Hostinger KVM 1)

Produção roda no VPS com Docker + Traefik (HTTPS automático via Let's Encrypt).

- `docker-compose.yml` — projeto `paytracking` no VPS:
  - `app`: Node 22 executando `/opt/paytracking/app/server.js` (cópia de `apps/server/dist`).
    As variáveis ficam em `/opt/paytracking/pt.env` no VPS (permissão 600, fora do git).
  - `updater`: a cada 2 min confere a `main` deste repositório. Se `apps/server/dist` mudou
    (o workflow "Build versionado" commita o build), copia para `/opt/paytracking/app`, reinicia o app
    e confere `/healthz`. Se a versão nova não subir, volta a anterior sozinho e marca o commit em
    `/opt/paytracking/bad.rev` (não tenta de novo esse commit).

Fluxo de atualização: push na `main` → CI compila e commita o dist → em até ~2 min o VPS publica.

Aplicar mudanças neste arquivo: recriar o projeto no painel da Hostinger (Docker Manager) ou via API
`vps_docker_create` apontando para a URL raw deste arquivo.
