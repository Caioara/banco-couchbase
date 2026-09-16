require("dotenv").config();

const couchbase = require("couchbase");
const { initCouchbase, collectionPath } = require("../src/couchbase");

async function main() {
  const { cluster, config } = await initCouchbase();
  const names = ["users", "events", "enrollments", "sessions"];
  const totals = {};

  for (const name of names) {
    const path = collectionPath(config, config.collections[name]);
    const { rows } = await cluster.query(`SELECT RAW COUNT(*) FROM ${path}`, {
      scanConsistency: couchbase.QueryScanConsistency.RequestPlus
    });
    totals[name] = rows[0];
  }

  const eventsPath = collectionPath(config, config.collections.events);
  const { rows } = await cluster.query(
    `SELECT RAW COUNT(*) FROM ${eventsPath} WHERE embedding IS MISSING OR embedding IS NULL`,
    { scanConsistency: couchbase.QueryScanConsistency.RequestPlus }
  );

  const base = config.url.replace(/^couchbases?:\/\//, "http://").replace(/\/$/, "");
  const indexUrl = new URL(base);
  indexUrl.port = "8094";
  indexUrl.pathname = `/api/bucket/${encodeURIComponent(config.bucket)}/scope/${encodeURIComponent(config.scope)}/index/${encodeURIComponent(config.vectorIndex)}`;
  const response = await fetch(indexUrl, {
    headers: { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` }
  });

  if (!response.ok) throw new Error(`Indice vetorial indisponivel (HTTP ${response.status}).`);

  console.table(totals);
  console.log(`Eventos sem embedding: ${rows[0]}`);
  console.log(`Indice vetorial: ${config.vectorIndex} OK`);

  const expected = { users: 3, events: 506, enrollments: 8, sessions: 0 };
  if (Object.entries(expected).some(([name, total]) => totals[name] !== total)) {
    throw new Error(`Contagens divergentes. Esperado: ${JSON.stringify(expected)}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
