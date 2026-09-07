import json
from pathlib import Path

import matplotlib.pyplot as plt
try:
    import os
    import base64
    import urllib.request
    import urllib.error
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_FILE = BASE_DIR / "data" / "results.json"
VULN_FILE = BASE_DIR / "data" / "vulnerability.json"
REPORTS_DIR = BASE_DIR / "reports"

REPORTS_DIR.mkdir(parents=True, exist_ok=True)

with DATA_FILE.open("r", encoding="utf-8") as file:
    results = json.load(file)

with VULN_FILE.open("r", encoding="utf-8") as file:
    vuln = json.load(file)

perf = results["performance"]
OP_KEYS = ["insert", "readByCode", "readPaginated", "update", "aggregate", "delete"]
OP_LABELS = ["Insert", "Read por codigo", "Read paginado", "Update", "Aggregate", "Delete"]

throughput = [perf[key]["throughputOps"] for key in OP_KEYS]
latency_p95 = [perf[key]["p95Ms"] for key in OP_KEYS]
error_rate = [perf[key]["errorRatePercent"] for key in OP_KEYS]


def save_fig(fig, name):
    """Salva a figura em PNG (raster, para visualizacao rapida) e SVG (vetorial)."""
    fig.savefig(REPORTS_DIR / f"{name}.png", dpi=160)
    fig.savefig(REPORTS_DIR / f"{name}.svg")
    plt.close(fig)


def fetch_couchbase_storage_metrics():
    """Busca no Couchbase as metricas reais de storage do bucket:
    Collection (dataUsed), Storage (diskUsed) e Indices (diskUsed - dataUsed).

        Se a API nao responder, retorna None e o grafico usa fallback dos dados do results.json.
    """
    try:
        url = os.environ.get("COUCHBASE_URL", "couchbase://localhost")
        host = url.replace("couchbase://", "").replace("couchbase+ssl://", "").rstrip("/")
        username = os.environ.get("COUCHBASE_USERNAME", "Administrator")
        password = os.environ.get("COUCHBASE_PASSWORD", "") or "troque-esta-senha"
        bucket = os.environ.get("COUCHBASE_BUCKET", "agendamentos")

        api_url = f"http://{host}:8091/pools/default/buckets/{bucket}"
        req = urllib.request.Request(api_url)
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {token}")

        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.load(resp)

        basic = data.get("basicStats", {}) or {}
        data_used = int(basic.get("dataUsed", 0) or 0)
        disk_used = int(basic.get("diskUsed", 0) or 0)

        return {
            "collectionBytes": data_used,
            "storageBytes": disk_used,
            "indexesBytes": max(disk_used - data_used, 0)
        }
    except Exception:
        return None


def add_value_labels(ax, values, fmt="{:.1f}"):
    for bar, value in zip(ax.patches, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            fmt.format(value),
            ha="center",
            va="bottom",
            fontsize=9,
            color="#333333"
        )


def add_value_labels_h(ax, values, fmt="{:.2f}"):
    for bar, value in zip(ax.patches, values):
        ax.text(
            bar.get_width(),
            bar.get_y() + bar.get_height() / 2,
            fmt.format(value),
            ha="left",
            va="center",
            fontsize=9,
            color="#333333"
        )


# 1) Throughput por operacao
fig, ax = plt.subplots(figsize=(9, 4.5))
ax.bar(OP_LABELS, throughput, color="#1b1b1b", alpha=0.85)
add_value_labels(ax, throughput, fmt="{:,.1f}")
ax.set_ylabel("Throughput (ops/s)")
ax.set_title("Couchbase - Throughput por operacao")
plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
fig.tight_layout()
save_fig(fig, "throughput")

# 2) Latencia p95 por operacao
fig, ax = plt.subplots(figsize=(9, 4.5))
ax.bar(OP_LABELS, latency_p95, color="#c47f33", alpha=0.85)
add_value_labels(ax, latency_p95, fmt="{:.1f}")
ax.set_ylabel("Latencia p95 (ms)")
ax.set_title("Couchbase - Latencia p95 por operacao")
plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
fig.tight_layout()
save_fig(fig, "latency")

# 3) Armazenamento: estimativas do benchmark + metricas reais do bucket
storage_live = fetch_couchbase_storage_metrics()
storage_labels = ["Doc medio", "Total inserido"]
storage_values = [
    results["storage"]["averageDocumentBytes"],
    results["storage"]["totalInsertedBytes"],
]
if storage_live:
    storage_labels += ["Collection", "Storage", "Indices"]
    storage_values += [
        storage_live["collectionBytes"],
        storage_live["storageBytes"],
        storage_live["indexesBytes"],
    ]

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.bar(storage_labels, storage_values, color="#3a7d44", alpha=0.85)
add_value_labels(ax, storage_values, fmt="{:,.0f}")
ax.set_ylabel("Bytes")
ax.set_title("Couchbase - Armazenamento (Doc medio, Total inserido, Collection, Storage, Indices)")
fig.tight_layout()
save_fig(fig, "storage")

# 4) Checklist de vulnerabilidade
security_items = vuln["items"]
security_labels = [item["label"] for item in security_items]
security_scores = [item["score"] for item in security_items]

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.barh(security_labels, security_scores, color="#284b63", alpha=0.9)
add_value_labels_h(ax, security_scores, fmt="{:.2f}")
ax.set_xlim(0, 1.1)
ax.set_xlabel("Score (0 = nao, 0.5 = desconhecido, 1 = sim)")
ax.set_title("Couchbase - Checklist de vulnerabilidade")
fig.tight_layout()
save_fig(fig, "security")

# 5) Taxa de erro por operacao (metrica nova, equivalente ao error_rate.png do MongoDB)
fig, ax = plt.subplots(figsize=(9, 4.5))
ax.bar(OP_LABELS, error_rate, color="#a23b3b", alpha=0.85)
for i, value in enumerate(error_rate):
    ax.text(i, max(error_rate + [0.001]) * 0.02, f"{value:.3f}%", ha="center", va="bottom", fontsize=9)
ax.set_ylabel("Taxa de erro (%)")
ax.set_title("Couchbase - Taxa de erro por operacao")
plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
fig.tight_layout()
save_fig(fig, "error_rate")

# 6) Distribuicao de latencia por percentil (metrica nova, equivalente ao latency_percentiles.png)
percentile_keys = ["p50Ms", "p75Ms", "p90Ms", "p95Ms", "p99Ms"]
percentile_labels = ["p50", "p75", "p90", "p95", "p99"]

fig, ax = plt.subplots(figsize=(9, 4.5))
for pkey, plabel in zip(percentile_keys, percentile_labels):
    values = [perf[key][pkey] for key in OP_KEYS]
    ax.plot(OP_LABELS, values, marker="o", label=plabel)
ax.set_ylabel("Latencia (ms)")
ax.set_title("Couchbase - Distribuicao de latencia por percentil")
plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
ax.legend()
fig.tight_layout()
save_fig(fig, "latency_percentiles")

# 7) CPU e memoria ao longo do benchmark (metrica nova, equivalente ao resource_timeline.png)
timeline = results.get("resourceTimeline", [])
if timeline:
    t_values = [point["tSec"] for point in timeline]
    cpu_values = [point["cpuPercent"] for point in timeline]
    rss_values = [point["rssMB"] for point in timeline]

    fig, ax_cpu = plt.subplots(figsize=(9, 4.5))
    ax_rss = ax_cpu.twinx()

    ax_cpu.plot(t_values, cpu_values, color="#c47f33")
    ax_cpu.set_ylabel("CPU (%)", color="#c47f33")
    ax_cpu.set_xlabel("Tempo (s)")

    ax_rss.plot(t_values, rss_values, color="#284b63")
    ax_rss.set_ylabel("RSS (MB)", color="#284b63")

    ax_cpu.set_title("Couchbase - CPU e memoria ao longo do benchmark")
    fig.tight_layout()
    save_fig(fig, "resource_timeline")

# 8) Consumo de recursos do processo (metrica nova, equivalente ao resources.png)
resources = results.get("resources", {})
resource_labels = [
    "Event loop p95 (ms)",
    "Heap pico (MB)",
    "Heap medio (MB)",
    "RSS pico (MB)",
    "RSS medio (MB)",
    "CPU pico (%)",
    "CPU media (%)",
]
resource_values = [
    resources.get("eventLoopP95Ms", 0),
    resources.get("heapPeakMB", 0),
    resources.get("heapAvgMB", 0),
    resources.get("rssPeakMB", 0),
    resources.get("rssAvgMB", 0),
    resources.get("cpuPeakPercent", 0),
    resources.get("cpuAvgPercent", 0),
]

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.barh(resource_labels, resource_values, color="#365a6d", alpha=0.9)
add_value_labels_h(ax, resource_values, fmt="{:.2f}")
ax.set_title("Couchbase - Consumo de recursos do processo")
fig.tight_layout()
save_fig(fig, "resources")

# 9) Indicadores de eficiencia (metrica nova, equivalente ao efficiency.png)
efficiency = results.get("efficiency", {})
efficiency_labels = ["Bytes por operacao", "Ops por MB inserido", "Latencia ponderada (ms)", "Throughput geral (ops/s)"]
efficiency_values = [
    efficiency.get("bytesPerOperation", 0),
    efficiency.get("opsPerMBInserted", 0),
    efficiency.get("weightedLatencyMs", 0),
    efficiency.get("throughputGeralOpsPerSec", 0),
]

fig, ax = plt.subplots(figsize=(9, 4.5))
ax.barh(efficiency_labels, efficiency_values, color="#2f9e8f", alpha=0.9)
add_value_labels_h(ax, efficiency_values, fmt="{:,.2f}")
ax.set_title("Couchbase - Indicadores de eficiencia")
fig.tight_layout()
save_fig(fig, "efficiency")

# 10) Estimativa de custo por execucao (metrica nova, equivalente ao cost.png)
cost = results.get("cost", {})
cost_labels = ["Compute", "Operacoes", "Storage mensal"]
cost_values = [
    cost.get("computeUsd", 0),
    cost.get("operationsUsd", 0),
    cost.get("storageMonthlyUsd", 0),
]

fig, ax = plt.subplots(figsize=(7, 4.5))
ax.bar(cost_labels, cost_values, color="#6b5b7b", alpha=0.85)
add_value_labels(ax, cost_values, fmt="{:.6f} USD")
ax.set_ylabel("Custo estimado (USD)")
ax.set_title("Couchbase - Estimativa de custo por execucao")
fig.tight_layout()
save_fig(fig, "cost")

print("Graficos gerados em reports/ (PNG + SVG)")
