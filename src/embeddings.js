const DEFAULT_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

function embeddingConfig() {
  return {
    url: process.env.EMBEDDINGS_URL || DEFAULT_EMBEDDINGS_URL,
    apiKey: process.env.EMBEDDINGS_API_KEY,
    model: process.env.EMBEDDINGS_MODEL || "text-embedding-3-small",
    dimensions: Number(process.env.EMBEDDINGS_DIMENSIONS || 1536)
  };
}

function eventText(event) {
  return [event.title, event.description, event.location]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

async function generateEmbedding(text) {
  const config = embeddingConfig();
  if (!config.apiKey) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      dimensions: config.dimensions
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao gerar embedding (${response.status}): ${details.slice(0, 300)}`);
  }

  const payload = await response.json();
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== config.dimensions) {
    throw new Error("O provedor retornou um embedding com dimensao inesperada.");
  }
  return embedding;
}

async function generateEventEmbedding(event) {
  return generateEmbedding(eventText(event));
}

function vectorSearchUrl(config) {
  const base = config.url.replace(/^couchbases?:\/\//, "http://").replace(/\/$/, "");
  const parsed = new URL(base);
  parsed.port = 8094;
  parsed.pathname = `/api/bucket/${encodeURIComponent(config.bucket)}/scope/${encodeURIComponent(config.scope)}/index/${encodeURIComponent(config.vectorIndex)}/query`;
  return parsed.href;
}

async function searchVector(clusterConfig, vector, k = 20) {
  if (!process.env.EMBEDDINGS_API_KEY) {
    throw new Error("Configure EMBEDDINGS_API_KEY para usar a busca semantica.");
  }
  if (!clusterConfig.vectorIndex) {
    throw new Error("COUCHBASE_VECTOR_INDEX nao configurado.");
  }

  const response = await fetch(vectorSearchUrl(clusterConfig), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${clusterConfig.username}:${clusterConfig.password}`).toString("base64")}`
    },
    body: JSON.stringify({
      knn: [{ field: "embedding", k, vector }],
      fields: ["id", "title", "description", "location", "startAt", "endAt", "capacity", "status", "createdBy", "createdAt", "updatedAt"],
      includeLocations: false
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha na busca vetorial (${response.status}): ${details.slice(0, 300)}`);
  }
  return response.json();
}

module.exports = { generateEventEmbedding, generateEmbedding, searchVector };
