# Agenda Flow com Couchbase

Sistema de agendamento com eventos e inscricoes usando Node.js, Express e Couchbase.

## Requisitos

- Docker + Docker Compose

## Configuracao (Docker)

1) Ajuste as variaveis no docker-compose.yml (COUCHBASE_* e SESSION_SECRET).

## Como rodar (Docker)

```
docker compose up --build
```

A aplicacao sobe em http://localhost:3000

## API (resumo)

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- GET /api/events?limit=10&offset=0&q=
- GET /api/events/:id
- GET /api/events/mine
- POST /api/events
- PUT /api/events/:id
- DELETE /api/events/:id
- POST /api/events/:id/enroll
- GET /api/enrollments/me
- POST /api/enrollments/:id/cancel
- GET /api/reminders/upcoming?hours=24

## Benchmark e graficos (Couchbase)

1) Garanta o Couchbase rodando e o arquivo .env configurado.
2) Rode o benchmark:

```
node scripts/benchmark.js
```

O benchmark executa 6 operacoes (Insert, Read por codigo, Read paginado, Update,
Aggregate, Delete), contabiliza erros e latencia (p50/p75/p90/p95/p99) por
operacao, e monitora o processo Node (CPU, RSS, heap e atraso do event loop)
ao longo da execucao. Os resultados vao para data/results.json.

3) Ajuste o checklist de vulnerabilidade (opcional):

- Arquivo: data/vulnerability.json
- Score: 0 = nao, 0.5 = desconhecido, 1 = sim

4) Gere os graficos (PNG + SVG):

```
python scripts/plot.py
```

Graficos gerados em reports/, cada um em duas versoes: `.png` (raster, para
visualizacao rapida) e `.svg` (vetorial, para reports/apresentacoes sem perda
de qualidade). Sao 10 graficos, no total:

- throughput.png / .svg - throughput por operacao
- latency.png / .svg - latencia p95 por operacao
- latency_percentiles.png / .svg - distribuicao de latencia (p50 a p99)
- error_rate.png / .svg - taxa de erro por operacao
- resource_timeline.png / .svg - CPU e memoria (RSS) ao longo do benchmark
- resources.png / .svg - consumo agregado do processo (CPU, RSS, heap, event loop)
- efficiency.png / .svg - indicadores de eficiencia (bytes/op, ops/MB, latencia ponderada)
- cost.png / .svg - estimativa de custo por execucao (compute, operacoes, storage mensal)
- storage.png / .svg - estimativa de armazenamento
- security.png / .svg - checklist de vulnerabilidade

As constantes de custo (BENCH_PRICE_VCPU_HOUR, BENCH_PRICE_PER_MILLION_OPS,
BENCH_PRICE_GB_MONTH no .env) sao estimativas ilustrativas para comparacao
relativa entre execucoes, nao precos oficiais de nenhum provedor de nuvem.

5) Se o benchmark for interrompido antes de terminar (ou o numero de deletes
configurado for menor que o de inserts), podem sobrar "Evento Benchmark N..."
visiveis no site. Para remove-los sem rodar o benchmark de novo:

```
node scripts/cleanup-bench.js
```

ou diretamente no Couchbase (Query Workbench / cbq):

```sql
DELETE FROM `agendamentos`.`_default`.`events` WHERE type = "bench";
```

## Checklist de vulnerabilidade (Couchbase)

- Use TLS no cluster e rotacione senhas.
- Evite usuario administrador na app; use permissoes minimas.
- Valide dados no servidor e normalize entradas.
- Proteja variaveis de ambiente (.env fora do repositorio).
- Desabilite portas/servicos nao usados no cluster.
- Audite logs e monitore tentativas de acesso.

## Checklist de desempenho

- Crie indices que suportem as consultas usadas.
- Use LIMIT/OFFSET para paginar listagens grandes.
- Considere TTL para dados temporarios.
- Monitore latencia e throughput do cluster.
- Agrupe operacoes com bulk quando houver cargas massivas.
