require("dotenv").config();

const couchbase = require("couchbase");
const { initCouchbase, collectionPath } = require("../src/couchbase");
const { generateEventEmbedding } = require("../src/embeddings");

async function main() {
  if (!process.env.EMBEDDINGS_API_KEY) {
    throw new Error("Configure EMBEDDINGS_API_KEY antes de executar o backfill.");
  }

  const { cluster, collections, config } = await initCouchbase();
  const eventsPath = collectionPath(config, config.collections.events);
  const { rows } = await cluster.query(
    `SELECT e.* FROM ${eventsPath} e WHERE e.embedding IS MISSING OR e.embedding IS NULL`,
    { scanConsistency: couchbase.QueryScanConsistency.RequestPlus }
  );

  let updated = 0;
  for (const event of rows) {
    const embedding = await generateEventEmbedding(event);
    await collections.events.replace(event.id, { ...event, embedding });
    updated += 1;
    console.log(`Embedding atualizado: ${event.id}`);
  }

  console.log(`Backfill concluido. ${updated} evento(s) atualizado(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
