const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const couchbase = require("couchbase");
const { monitorEventLoopDelay } = require("perf_hooks");

dotenv.config();

const CONFIG = {
  inserts: parseInt(process.env.BENCH_INSERTS || "1000", 10),
  reads: parseInt(process.env.BENCH_READS || "1000", 10),
  readsPaginated: parseInt(process.env.BENCH_READS_PAGINATED || "200", 10),
  pageSize: parseInt(process.env.BENCH_PAGE_SIZE || "20", 10),
  updates: parseInt(process.env.BENCH_UPDATES || "500", 10),
  aggregates: parseInt(process.env.BENCH_AGGREGATES || "200", 10),
  deletes: parseInt(process.env.BENCH_DELETES || "500", 10),
  concurrency: parseInt(process.env.BENCH_CONCURRENCY || "50", 10),
  sampleIntervalMs: parseInt(process.env.BENCH_SAMPLE_INTERVAL_MS || "200", 10)
};

// Constantes de custo (estimativas ilustrativas, nao sao precos oficiais de nenhum provedor)
const PRICING = {
  vCpuHourUsd: parseFloat(process.env.BENCH_PRICE_VCPU_HOUR || "0.034"),
  perMillionOpsUsd: parseFloat(process.env.BENCH_PRICE_PER_MILLION_OPS || "0.20"),
  gbMonthUsd: parseFloat(process.env.BENCH_PRICE_GB_MONTH || "0.023")
};

function nowMs() {
  const [sec, nanosec] = process.hrtime();
  return sec * 1000 + nanosec / 1e6;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function runWithConcurrency(items, worker, concurrency) {
  let index = 0;
  const results = [];

  async function runner() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: concurrency }, () => runner());
  await Promise.all(runners);
  return results;
}

// Executa um lote de operacoes contabilizando latencia e erros, sem interromper o benchmark
// quando uma operacao individual falha.
async function runTrackedBatch(items, worker, concurrency) {
  const latencies = [];
  let errors = 0;
  const start = nowMs();

  await runWithConcurrency(
    items,
    async (item, idx) => {
      const opStart = nowMs();
      try {
        await worker(item, idx);
        latencies.push(nowMs() - opStart);
      } catch (error) {
        errors += 1;
      }
    },
    concurrency
  );

  return { latencies, errors, attempts: items.length, totalMs: nowMs() - start };
}

function summarize({ latencies, errors, attempts, totalMs }) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const count = latencies.length;
  const sum = latencies.reduce((acc, value) => acc + value, 0);
  const avg = count > 0 ? sum / count : 0;

  return {
    count,
    attempts,
    errors,
    errorRatePercent: attempts > 0 ? (errors / attempts) * 100 : 0,
    totalMs,
    throughputOps: totalMs > 0 ? (count / totalMs) * 1000 : 0,
    avgMs: avg,
    p50Ms: percentile(sorted, 50),
    p75Ms: percentile(sorted, 75),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99)
  };
}

function buildEventPayload(index) {
  return {
    id: `bench-${String(index).padStart(5, "0")}`,
    code: `EVT-${String(index).padStart(5, "0")}`,
    title: `Evento Benchmark ${index}`,
    description: "Carga sintetica para benchmark.",
    location: "Sala 01",
    startAt: new Date(Date.now() + index * 60000).toISOString(),
    endAt: new Date(Date.now() + (index + 60) * 60000).toISOString(),
    durationMinutes: 60,
    capacity: 20,
    status: "open",
    createdBy: "benchmark",
    createdAt: new Date().toISOString(),
    type: "bench"
  };
}

// Amostra CPU/RSS/heap do processo Node do benchmark ao longo do tempo (nao do servidor Couchbase).
function createResourceMonitor(intervalMs) {
  const timeline = [];
  const startedAt = nowMs();
  let lastCpu = process.cpuUsage();
  let lastTime = startedAt;

  const timer = setInterval(() => {
    const currentCpu = process.cpuUsage();
    const currentTime = nowMs();
    const elapsedMs = currentTime - lastTime;
    const userDeltaMs = (currentCpu.user - lastCpu.user) / 1000;
    const sysDeltaMs = (currentCpu.system - lastCpu.system) / 1000;
    const cpuPercent = elapsedMs > 0 ? ((userDeltaMs + sysDeltaMs) / elapsedMs) * 100 : 0;
    const mem = process.memoryUsage();

    timeline.push({
      tSec: Number(((currentTime - startedAt) / 1000).toFixed(2)),
      cpuPercent: Number(cpuPercent.toFixed(2)),
      rssMB: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMB: Number((mem.heapUsed / (1024 * 1024)).toFixed(2))
    });

    lastCpu = currentCpu;
    lastTime = currentTime;
  }, intervalMs);

  const eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
  eventLoopHistogram.enable();

  return {
    stop() {
      clearInterval(timer);
      eventLoopHistogram.disable();

      const cpuValues = timeline.map((point) => point.cpuPercent);
      const rssValues = timeline.map((point) => point.rssMB);
      const heapValues = timeline.map((point) => point.heapUsedMB);
      const avg = (values) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);

      return {
        timeline,
        summary: {
          eventLoopP95Ms: eventLoopHistogram.percentile(95) / 1e6,
          heapPeakMB: heapValues.length > 0 ? Math.max(...heapValues) : 0,
          heapAvgMB: avg(heapValues),
          rssPeakMB: rssValues.length > 0 ? Math.max(...rssValues) : 0,
          rssAvgMB: avg(rssValues),
          cpuPeakPercent: cpuValues.length > 0 ? Math.max(...cpuValues) : 0,
          cpuAvgPercent: avg(cpuValues)
        }
      };
    }
  };
}

async function main() {
  const url = process.env.COUCHBASE_URL || "couchbase://localhost";
  const username = process.env.COUCHBASE_USERNAME || "Administrator";
  const password = process.env.COUCHBASE_PASSWORD;
  const bucketName = process.env.COUCHBASE_BUCKET || "agendamentos";
  const scopeName = process.env.COUCHBASE_SCOPE || "_default";
  const eventsCollectionName = process.env.COUCHBASE_COLLECTION_EVENTS || "events";

  if (!password) {
    throw new Error("COUCHBASE_PASSWORD nao configurado.");
  }

  const cluster = await couchbase.connect(url, { username, password });
  const bucket = cluster.bucket(bucketName);
  const scope = bucket.scope(scopeName);
  const events = scope.collection(eventsCollectionName);

  const eventsPath = `\`${bucketName}\`.\`${scopeName}\`.\`${eventsCollectionName}\``;
  await cluster.query(`DELETE FROM ${eventsPath} WHERE type = "bench"`);

  const resourceMonitor = createResourceMonitor(CONFIG.sampleIntervalMs);
  const benchmarkStart = nowMs();

  const insertIds = Array.from({ length: CONFIG.inserts }, (_, i) => i);

  const insertResult = await runTrackedBatch(
    insertIds,
    async (idx) => {
      const payload = buildEventPayload(idx);
      await events.upsert(payload.id, payload);
    },
    CONFIG.concurrency
  );

  const readIds = insertIds.slice(0, Math.min(CONFIG.reads, CONFIG.inserts));
  const readByCodeResult = await runTrackedBatch(
    readIds,
    async (idx) => {
      await events.get(`bench-${String(idx).padStart(5, "0")}`);
    },
    CONFIG.concurrency
  );

  const paginatedRounds = Array.from({ length: CONFIG.readsPaginated }, (_, i) => i);
  const maxOffset = Math.max(0, CONFIG.inserts - CONFIG.pageSize);
  const readPaginatedResult = await runTrackedBatch(
    paginatedRounds,
    async () => {
      const offset = maxOffset > 0 ? Math.floor(Math.random() * maxOffset) : 0;
      await cluster.query(
        `SELECT RAW META(e).id FROM ${eventsPath} AS e WHERE e.type = "bench" ORDER BY e.code LIMIT $limit OFFSET $offset`,
        { parameters: { limit: CONFIG.pageSize, offset } }
      );
    },
    CONFIG.concurrency
  );

  const updateIds = insertIds.slice(0, Math.min(CONFIG.updates, CONFIG.inserts));
  const updateResult = await runTrackedBatch(
    updateIds,
    async (idx) => {
      const key = `bench-${String(idx).padStart(5, "0")}`;
      const doc = await events.get(key);
      await events.replace(key, {
        ...doc.content,
        location: "Sala 02",
        updatedAt: new Date().toISOString()
      });
    },
    CONFIG.concurrency
  );

  const aggregateRounds = Array.from({ length: CONFIG.aggregates }, (_, i) => i);
  const aggregateResult = await runTrackedBatch(
    aggregateRounds,
    async () => {
      await cluster.query(
        `SELECT e.location, COUNT(*) AS total FROM ${eventsPath} AS e WHERE e.type = "bench" GROUP BY e.location`
      );
    },
    CONFIG.concurrency
  );

  const deleteIds = insertIds.slice(0, Math.min(CONFIG.deletes, CONFIG.inserts));
  const deleteResult = await runTrackedBatch(
    deleteIds,
    async (idx) => {
      await events.remove(`bench-${String(idx).padStart(5, "0")}`);
    },
    CONFIG.concurrency
  );

  const benchmarkTotalMs = nowMs() - benchmarkStart;
  const resources = resourceMonitor.stop();

  const payloadSize = Buffer.from(JSON.stringify(buildEventPayload(1))).length;
  const totalInsertedBytes = payloadSize * CONFIG.inserts;

  const performance = {
    insert: summarize(insertResult),
    readByCode: summarize(readByCodeResult),
    readPaginated: summarize(readPaginatedResult),
    update: summarize(updateResult),
    aggregate: summarize(aggregateResult),
    delete: summarize(deleteResult)
  };

  const totalOps = Object.values(performance).reduce((acc, item) => acc + item.count, 0);
  const totalDurationSeconds = benchmarkTotalMs / 1000;
  const weightedLatencyMs =
    totalOps > 0
      ? Object.values(performance).reduce((acc, item) => acc + item.avgMs * item.count, 0) / totalOps
      : 0;

  const efficiency = {
    bytesPerOperation: totalOps > 0 ? totalInsertedBytes / totalOps : 0,
    opsPerMBInserted: totalInsertedBytes > 0 ? totalOps / (totalInsertedBytes / 1e6) : 0,
    weightedLatencyMs,
    throughputGeralOpsPerSec: totalDurationSeconds > 0 ? totalOps / totalDurationSeconds : 0
  };

  const cost = {
    computeUsd:
      (resources.summary.cpuAvgPercent / 100) * (totalDurationSeconds / 3600) * PRICING.vCpuHourUsd,
    operationsUsd: (totalOps / 1e6) * PRICING.perMillionOpsUsd,
    storageMonthlyUsd: (totalInsertedBytes / 1e9) * PRICING.gbMonthUsd,
    pricing: PRICING
  };

  const results = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    storage: {
      averageDocumentBytes: payloadSize,
      totalInsertedBytes
    },
    performance,
    efficiency,
    cost,
    resourceTimeline: resources.timeline,
    resources: resources.summary
  };

  const outputPath = path.join(__dirname, "..", "data", "results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log("Benchmark concluido. Resultados em data/results.json");
  await cluster.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
