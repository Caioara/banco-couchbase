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
Ollama expõe um endpoint compatível com o protocolo da OpenAI, mas funciona 100% no 
seu PC, sem custo, sem conta e sem enviar dados para ninguém.

```bash
ollama pull nomic-embed-text
```

Configura no `.env` (opção Ollama):

```env
EMBEDDINGS_URL=http://localhost:11434/v1/embeddings
EMBEDDINGS_API_KEY=ollama
EMBEDDINGS_MODEL=nomic-embed-text
EMBEDDINGS_DIMENSIONS=768
COUCHBASE_VECTOR_INDEX=events-vector-index
```

### Opção B (paga): API de OpenAI
```env
EMBEDDINGS_URL=https://api.openai.com/v1/embeddings
EMBEDDINGS_API_KEY=sua-chave
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_DIMENSIONS=1536
COUCHBASE_VECTOR_INDEX=events-vector-index
```

No Couchbase 7.6+, o script de inicialização do Docker Compose cria automaticamente um Search Index chamado `events-vector-index` para a collection de eventos, com o campo `embedding` mapeado como:

- tipo `vector`
- dimensão igual a `EMBEDDINGS_DIMENSIONS` (768 com Ollama `nomic-embed-text`, 1536 com OpenAI)
- similaridade `dot_product`

O serviço `fts` é habilitado automaticamente no mesmo script. Se preferir criar o índice manualmente, faça isso pela interface (http://localhost:8091), em **Search > Add Index**, selecionando bucket, scope, collection de eventos e mapeando o campo `embedding` com os valores indicados acima.

Se a API de embeddings estiver sendo executada no Docker Compose, use:

```env
EMBEDDINGS_URL=http://host.docker.internal:11434/v1/embeddings
```

Para preencher os embeddings de eventos antigos que foram criados antes da vetorização:

```bash
npm run embeddings:backfill
```

Esse comando exige `EMBEDDINGS_API_KEY` e atualiza somente documentos sem `embedding`.

Mantenha o mesmo `EMBEDDINGS_MODEL` e `EMBEDDINGS_DIMENSIONS` utilizados na configuração do Search Index.

Sem `EMBEDDINGS_API_KEY`, a API continua funcionando com a busca textual existente, mas a busca semântica retorna `503` e novos eventos não recebem embedding.

Exemplo de consulta depois de configurar o índice:

```bash
curl "http://localhost:3000/api/events/semantic-search?q=programacao%20web"
```

### Avaliação da busca vetorial

Para medir a qualidade da busca aproximada (ANN), execute o avaliador. Ele compara os resultados do índice vetorial com o top-K exato calculado contra todos os embeddings e gera Recall@K, nDCG@K e QPS para K=1, 5 e 10:

```bash
docker compose exec api npm run vector:eval
python scripts/plot-vector-evaluation.py
```

O relatório fica em `data/vector-evaluation.json` e o gráfico em `reports/vector_evaluation.png` e `.svg`.

`VECTOR_EVAL_QUERIES` define a quantidade de consultas de amostra (padrão: 25).

## Benchmark e gráficos (Couchbase)

1) Garanta que o Couchbase esteja rodando e que o arquivo `.env` esteja configurado.

2) Rode o benchmark:

```bash
node scripts/benchmark.js
```

O benchmark executa 6 operações (Insert, Read por código, Read paginado, Update, Aggregate, Delete), contabiliza erros e latência (p50/p75/p90/p95/p99) por operação e monitora o processo Node (CPU, RSS, heap e atraso do event loop) ao longo da execução.

Os resultados vão para `data/results.json`.

3) Ajuste o checklist de vulnerabilidade (opcional):

- Arquivo: `data/vulnerability.json`
- Score: 0 = não, 0.5 = desconhecido, 1 = sim

4) Gere os gráficos (PNG + SVG):

```bash
python scripts/plot.py
```

Os gráficos são gerados em `reports/`, cada um em duas versões: `.png` (raster, para visualização rápida) e `.svg` (vetorial, para relatórios/apresentações sem perda de qualidade).

São 10 gráficos, no total:

- `throughput.png` / `.svg` — throughput por operação
- `latency.png` / `.svg` — latência p95 por operação
- `latency_percentiles.png` / `.svg` — distribuição de latência (p50 a p99)
- `error_rate.png` / `.svg` — taxa de erro por operação
- `resource_timeline.png` / `.svg` — CPU e memória (RSS) ao longo do benchmark
- `resources.png` / `.svg` — consumo agregado do processo (CPU, RSS, heap, event loop)
- `efficiency.png` / `.svg` — indicadores de eficiência (bytes/op, ops/MB, latência ponderada)
- `cost.png` / `.svg` — estimativa de custo por execução (compute, operações, armazenamento mensal)
- `storage.png` / `.svg` — estimativa de armazenamento
- `security.png` / `.svg` — checklist de vulnerabilidade

As constantes de custo (`BENCH_PRICE_VCPU_HOUR`, `BENCH_PRICE_PER_MILLION_OPS`, `BENCH_PRICE_GB_MONTH`) no `.env` são estimativas ilustrativas para comparação relativa entre execuções, e não preços oficiais de nenhum provedor de nuvem.

5) Se o benchmark for interrompido antes de terminar (ou se o número de deletes configurado for menor que o de inserts), podem sobrar "Evento Benchmark N..." visíveis no site.

Para removê-los sem executar o benchmark novamente:

```bash
node scripts/cleanup-bench.js
```

Ou diretamente no Couchbase (Query Workbench / cbq):

```sql
DELETE FROM `agendamentos`.`_default`.`events` WHERE type = "bench";
```

## Checklist de vulnerabilidade (Couchbase)

- Use TLS no cluster e rotacione as senhas.
- Evite utilizar usuário administrador na aplicação; use permissões mínimas.
- Valide os dados no servidor e normalize as entradas.
- Proteja as variáveis de ambiente (`.env` fora do repositório).
- Desabilite portas/serviços não utilizados no cluster.
- Audite os logs e monitore as tentativas de acesso.

## Checklist de desempenho

- Crie índices que suportem as consultas utilizadas.
- Use `LIMIT/OFFSET` para paginar listagens grandes.
- Considere TTL para dados temporários.
- Monitore a latência e o throughput do cluster.
- Agrupe operações com bulk quando houver cargas massivas.
