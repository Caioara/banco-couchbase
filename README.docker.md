# Docker

## Subir o stack

- Build e up: docker compose up --build

## Testar

- Benchmark: docker compose exec api node scripts/benchmark.js

## Parar

- docker compose down

## Restaurar backup 7.2 para 7.6

Com o stack em execucao, copie o diretorio do backup para o container e restaure os
dados para as collections ja criadas. Em migracoes 7.2 -> 7.6, o `--map-data` por
collection e obrigatorio porque os IDs internos sao diferentes:

```powershell
docker cp C:\caminho\para\couchbase-7.2.4-backup agendamento-em-couchbase-main-couchbase-1:/tmp/backup
docker exec agendamento-em-couchbase-main-couchbase-1 /opt/couchbase/bin/cbbackupmgr restore --archive /tmp/backup --repo repo --cluster http://127.0.0.1:8091 --username Administrator --password troque-esta-senha --map-data agendamentos._default.users=agendamentos._default.users,agendamentos._default.events=agendamentos._default.events,agendamentos._default.enrollments=agendamentos._default.enrollments,agendamentos._default.sessions=agendamentos._default.sessions --disable-gsi-indexes --disable-ft-indexes --disable-ft-alias --disable-views --disable-bucket-query --disable-cluster-query --disable-analytics --disable-cluster-analytics --disable-eventing --exclude-expired
docker compose exec api npm run migration:verify
```

Se houver eventos sem `embedding`, inicie o Ollama com `nomic-embed-text` e execute
`docker compose exec api npm run embeddings:backfill` antes de testar a busca semantica.
