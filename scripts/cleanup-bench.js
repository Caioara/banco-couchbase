const dotenv = require("dotenv");
const couchbase = require("couchbase");

dotenv.config();

// Remove do banco os eventos sinteticos gerados pelo benchmark (type = "bench"),
// sem precisar rodar o benchmark completo de novo.
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
  const eventsPath = `\`${bucketName}\`.\`${scopeName}\`.\`${eventsCollectionName}\``;

  const countResult = await cluster.query(
    `SELECT COUNT(*) AS total FROM ${eventsPath} WHERE type = "bench"`
  );
  const total = countResult.rows[0]?.total || 0;

  if (total === 0) {
    console.log("Nenhum evento de benchmark encontrado. Nada para remover.");
  } else {
    await cluster.query(`DELETE FROM ${eventsPath} WHERE type = "bench"`);
    console.log(`Removidos ${total} eventos de benchmark ("Evento Benchmark ...").`);
  }

  await cluster.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
