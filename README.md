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
- GET /api/events/semantic-search?q=texto-livre
- GET /api/events/:id
- GET /api/events/mine
- POST /api/events
- PUT /api/events/:id
- DELETE /api/events/:id
- POST /api/events/:id/enroll
- GET /api/enrollments/me
- POST /api/enrollments/:id/cancel
- GET /api/reminders/upcoming?hours=24

## Busca semantica com embeddings
A busca semantica usa um modelo de embeddings e o Couchbase Vector Search. Ao criar ou atualizar um evento, os campos `title`,
`description` e `location` sao convertidos em um vetor e salvos no documento como
`embedding`. Consulte `GET /api/events/semantic-search?q=termo` para buscar por
significado, e nao apenas por correspondencia literal.

Podes usar um provedor gratuito e local (recomendado para desenvolvimento) ou um
provedor pago na nube:

### Opcion A (recomendada, gratuita): Ollama local
Ollama expón um endpoint compatible co protocolo de OpenAI, mais funciona 100% no
teu PC, sen custo, sen conta e sen enviar datos a ninguén. Para usalo:

```bash
ollama pull nomic-embed-text
```

Configura no `.env` (opcion Ollama):

```env
EMBEDDINGS_URL=http://localhost:11434/v1/embeddings
EMBEDDINGS_API_KEY=ollama
EMBEDDINGS_MODEL=nomic-embed-text
EMBEDDINGS_DIMENSIONS=768
COUCHBASE_VECTOR_INDEX=events-vector-index
```

### Opcion B (paga): API de OpenAI
```env
EMBEDDINGS_URL=https://api.openai.com/v1/embeddings
EMBEDDINGS_API_KEY=sua-chave
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_DIMENSIONS=1536
COUCHBASE_VECTOR_INDEX=events-vector-index
```

No Couchbase 7.6+, o script de inicializacion de Docker Compose crea automaticamente
um Search index chamado `events-vector-index` para a collection de eventos, co campo
`embedding` mapeado como:

- tipo `vector`
- dimension igual a `EMBEDDINGS_DIMENSIONS` (768 con Ollama `nomic-embed-text`, 1536 con OpenAI)
- similaridade `dot_product`

O servizo `fts` habilítase automaticamente no mesmo script. Se prefires crear o index
manualmente, faino pola interface (http://localhost:8091), en **Search > Add Index**,
seleccionando bucket, scope, collection de eventos e mapeando o campo `embedding` cos
valores indicados arriba. Se a API de embeddings corre en Docker Compose, usa:
```env
EMBEDDINGS_URL=http://host.docker.internal:11434/v1/embeddings
```

Para preencher embeddings de eventos antigos que foram criados antes da vetorizacao:

```bash
npm run embeddings:backfill
```

Esse comando exige `EMBEDDINGS_API_KEY` e atualiza somente documentos sem `embedding`.
Mantenha o mesmo `EMBEDDINGS_MODEL` e `EMBEDDINGS_DIMENSIONS` usados na configuracao
do Search index. Sem `EMBEDDINGS_API_KEY`, a API continua funcionando com a busca
textual existente, mas a busca semantica retorna `503` e novos eventos nao recebem
embedding.

Exemplo de consulta depois de configurar o index:

```bash
curl "http://localhost:3000/api/events/semantic-search?q=programacao%20web"
```

### Avaliacao da busca vetorial

Para medir a qualidade da busca aproximada (ANN), execute o avaliador. Ele compara
os resultados do indice vetorial com o top-K exato calculado contra todos os
embeddings e gera Recall@K, nDCG@K e QPS para K=1, 5 e 10:

```bash
docker compose exec api npm run vector:eval
python scripts/plot-vector-evaluation.py
```

O relatorio fica em `data/vector-evaluation.json` e o grafico em
`reports/vector_evaluation.png` e `.svg`. `VECTOR_EVAL_QUERIES` define a quantidade
de consultas de amostra (padrao: 25).

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
