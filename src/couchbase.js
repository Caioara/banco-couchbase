const couchbase = require("couchbase");

let cluster;
let bucket;
let scope;
let collections;
let configCache;

function loadConfig() {
  const url = process.env.COUCHBASE_URL || "couchbase://localhost";
  const username = process.env.COUCHBASE_USERNAME || "Administrator";
  const password = process.env.COUCHBASE_PASSWORD;
  const bucketName = process.env.COUCHBASE_BUCKET || "agendamentos";
  const scopeName = process.env.COUCHBASE_SCOPE || "_default";

  if (!password) {
    throw new Error("COUCHBASE_PASSWORD nao configurado.");
  }

  return {
    url,
    username,
    password,
    bucket: bucketName,
    scope: scopeName,
    collections: {
      users: process.env.COUCHBASE_COLLECTION_USERS || "users",
      events: process.env.COUCHBASE_COLLECTION_EVENTS || "events",
      enrollments: process.env.COUCHBASE_COLLECTION_ENROLLMENTS || "enrollments",
      sessions: process.env.COUCHBASE_COLLECTION_SESSIONS || "sessions"
    }
  };
}

function collectionPath(config, collectionName) {
  return `\`${config.bucket}\`.\`${config.scope}\`.\`${collectionName}\``;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureIndexes(clusterInstance, config) {
  const queries = [];
  const usersPath = collectionPath(config, config.collections.users);
  const eventsPath = collectionPath(config, config.collections.events);
  const enrollmentsPath = collectionPath(config, config.collections.enrollments);

  queries.push(`CREATE PRIMARY INDEX idx_users_primary ON ${usersPath}`);
  queries.push(`CREATE PRIMARY INDEX idx_events_primary ON ${eventsPath}`);
  queries.push(`CREATE PRIMARY INDEX idx_enrollments_primary ON ${enrollmentsPath}`);

  queries.push(`CREATE INDEX idx_users_email ON ${usersPath} (email)`);
  queries.push(`CREATE INDEX idx_events_status_start ON ${eventsPath} (status, startAt)`);
  queries.push(`CREATE INDEX idx_events_creator ON ${eventsPath} (createdBy, startAt)`);
  queries.push(`CREATE INDEX idx_events_status ON ${eventsPath} (status)`);

  queries.push(`CREATE INDEX idx_enrollments_event_user ON ${enrollmentsPath} (eventId, userId)`);
  queries.push(`CREATE INDEX idx_enrollments_user_created ON ${enrollmentsPath} (userId, createdAt)`);
  queries.push(`CREATE INDEX idx_enrollments_event_status ON ${enrollmentsPath} (eventId, status)`);

  for (const statement of queries) {
    try {
      await clusterInstance.query(statement);
    } catch (error) {
      if (
        error?.cause?.code === 4300 ||
        /already exists/i.test(error.message) ||
        /index exists/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function waitForQueryService(clusterInstance, config) {
  const healthPath = `http://${new URL(config.url.replace("couchbase://", "http://")).host.replace(/\/$/, "")}`;
  const queryUrl = `${healthPath.replace(/:8091$/, "")}:8093/admin/ping`;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(queryUrl);
      if (response.ok) {
        try {
          await ensureIndexes(clusterInstance, config);
          return;
        } catch (error) {
          if (attempt === 30) {
            throw error;
          }
        }
      }
    } catch (error) {
      if (attempt === 30) {
        throw error;
      }
    }

    await sleep(2000);
  }

  throw new Error("Servico de query do Couchbase nao ficou pronto a tempo.");
}

async function initCouchbase() {
  if (cluster && collections) {
    return { cluster, bucket, scope, collections, config: configCache };
  }

  const config = loadConfig();
  const clusterInstance = await couchbase.connect(config.url, {
    username: config.username,
    password: config.password
  });

  const bucketInstance = clusterInstance.bucket(config.bucket);
  const scopeInstance = bucketInstance.scope(config.scope);

  const createdCollections = {
    users: scopeInstance.collection(config.collections.users),
    events: scopeInstance.collection(config.collections.events),
    enrollments: scopeInstance.collection(config.collections.enrollments),
    sessions: scopeInstance.collection(config.collections.sessions)
  };

  await waitForQueryService(clusterInstance, config);

  collections = createdCollections;
  cluster = clusterInstance;
  bucket = bucketInstance;
  scope = scopeInstance;
  configCache = config;

  return { cluster, bucket, scope, collections, config };
}

module.exports = {
  initCouchbase,
  collectionPath
};
