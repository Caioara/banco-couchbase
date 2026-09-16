require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const couchbase = require("couchbase");
const { initCouchbase, collectionPath } = require("../src/couchbase");
const { searchVector } = require("../src/embeddings");

const KS = [1, 5, 10];
const SAMPLE_SIZE = Math.max(1, Number(process.env.VECTOR_EVAL_QUERIES || 25));

function dotProduct(left, right) {
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result += left[i] * right[i];
  return result;
}

function dcg(ids, relevanceById) {
  return ids.reduce((sum, id, index) => {
    const relevance = Math.max(0, relevanceById.get(id) || 0);
    return sum + ((2 ** relevance - 1) / Math.log2(index + 2));
  }, 0);
}

function evenlySpaced(items, count) {
  if (count >= items.length) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * step)]);
}

async function main() {
  const { cluster, config } = await initCouchbase();
  const eventsPath = collectionPath(config, config.collections.events);
  const { rows } = await cluster.query(
    `SELECT META(e).id AS id, e.embedding FROM ${eventsPath} e WHERE e.embedding IS NOT MISSING AND e.embedding IS NOT NULL`,
    { scanConsistency: couchbase.QueryScanConsistency.RequestPlus }
  );

  const dimensionCounts = new Map();
  for (const row of rows) {
    if (Array.isArray(row.embedding) && row.embedding.every((value) => Number.isFinite(value))) {
      dimensionCounts.set(row.embedding.length, (dimensionCounts.get(row.embedding.length) || 0) + 1);
    }
  }
  const dimensions = [...dimensionCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  const corpus = rows.filter((row) =>
    Array.isArray(row.embedding) &&
    row.embedding.length === dimensions &&
    row.embedding.every((value) => Number.isFinite(value))
  );
  if (corpus.length < Math.max(...KS)) {
    throw new Error(`Sao necessarios ao menos ${Math.max(...KS)} eventos vetorizados; encontrados ${corpus.length}.`);
  }

  const queries = evenlySpaced([...corpus].sort((a, b) => a.id.localeCompare(b.id)), SAMPLE_SIZE);
  const metrics = Object.fromEntries(KS.map((k) => [k, { recall: [], ndcg: [], durationsMs: [] }]));

  for (const query of queries) {
    const exact = corpus
      .map((candidate) => ({ id: candidate.id, score: dotProduct(query.embedding, candidate.embedding) }))
      .sort((left, right) => right.score - left.score);
    const relevanceById = new Map(exact.map((candidate) => [candidate.id, candidate.score]));

    for (const k of KS) {
      const startedAt = performance.now();
      const result = await searchVector(config, query.embedding, k);
      const elapsedMs = performance.now() - startedAt;
      // Um mesmo documento nao pode contribuir mais de uma vez para Recall/nDCG.
      // Isso tambem protege a metrica caso o servico retorne hits duplicados.
      const actualIds = [...new Set((result.hits || []).map((hit) => hit.id))].slice(0, k);
      const expectedIds = exact.slice(0, k).map((candidate) => candidate.id);
      const expectedSet = new Set(expectedIds);
      const recall = actualIds.filter((id) => expectedSet.has(id)).length / k;
      const idealDcg = dcg(expectedIds, relevanceById);
      const ndcg = idealDcg === 0 ? 0 : dcg(actualIds, relevanceById) / idealDcg;
      if (ndcg > 1.000001) {
        throw new Error(`nDCG invalido (${ndcg}) para a consulta ${query.id}; verifique os IDs retornados pelo indice.`);
      }

      metrics[k].recall.push(recall);
      metrics[k].ndcg.push(Math.min(1, ndcg));
      metrics[k].durationsMs.push(elapsedMs);
    }
  }

  const summary = KS.map((k) => {
    const values = metrics[k];
    const totalMs = values.durationsMs.reduce((sum, duration) => sum + duration, 0);
    return {
      k,
      recallAtK: values.recall.reduce((sum, value) => sum + value, 0) / values.recall.length,
      ndcgAtK: values.ndcg.reduce((sum, value) => sum + value, 0) / values.ndcg.length,
      qps: (values.durationsMs.length / totalMs) * 1000,
      avgLatencyMs: totalMs / values.durationsMs.length
    };
  });

  const report = {
    timestamp: new Date().toISOString(),
    methodology: "O ground truth e o top-K exato por dot product contra todos os embeddings. Recall@K compara a intersecao ANN/exato; nDCG@K usa a similaridade exata como relevancia graduada. QPS mede apenas a chamada ao indice vetorial, sem a geracao do embedding da consulta.",
    corpusSize: corpus.length,
    excludedVectors: rows.length - corpus.length,
    queryCount: queries.length,
    dimensions,
    summary
  };

  await fs.writeFile(path.join(__dirname, "..", "data", "vector-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.table(summary.map((item) => ({
    k: item.k,
    recallAtK: item.recallAtK.toFixed(4),
    ndcgAtK: item.ndcgAtK.toFixed(4),
    qps: item.qps.toFixed(2),
    avgLatencyMs: item.avgLatencyMs.toFixed(2)
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
