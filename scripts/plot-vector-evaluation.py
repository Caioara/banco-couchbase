import json
from pathlib import Path

import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
with (ROOT / "data" / "vector-evaluation.json").open(encoding="utf-8") as source:
    report = json.load(source)

rows = report["summary"]
ks = [f"@{row['k']}" for row in rows]
recall = [row["recallAtK"] * 100 for row in rows]
ndcg = [row["ndcgAtK"] * 100 for row in rows]
qps = [row["qps"] for row in rows]

fig, (quality_ax, qps_ax) = plt.subplots(1, 2, figsize=(12, 5), constrained_layout=True)
x = range(len(ks))
width = 0.36
quality_ax.bar([i - width / 2 for i in x], recall, width, label="Recall@K", color="#1976d2")
quality_ax.bar([i + width / 2 for i in x], ndcg, width, label="nDCG@K", color="#2e7d32")
quality_ax.set_title("Qualidade da busca vetorial")
quality_ax.set_ylabel("Percentual (%)")
quality_ax.set_ylim(0, 105)
quality_ax.set_xticks(list(x), ks)
quality_ax.legend()
quality_ax.grid(axis="y", alpha=0.25)
for bars in quality_ax.containers:
    quality_ax.bar_label(bars, fmt="%.1f%%", padding=3, fontsize=9)

qps_ax.bar(ks, qps, color="#ef6c00")
qps_ax.set_title("Throughput da busca vetorial")
qps_ax.set_ylabel("Consultas por segundo (QPS)")
qps_ax.grid(axis="y", alpha=0.25)
qps_ax.bar_label(qps_ax.containers[0], fmt="%.1f", padding=3, fontsize=9)

fig.suptitle(f"Avaliação ANN vs. busca exata — {report['queryCount']} consultas, {report['corpusSize']} vetores", fontsize=13)
reports_dir = ROOT / "reports"
reports_dir.mkdir(exist_ok=True)
fig.savefig(reports_dir / "vector_evaluation.png", dpi=160)
fig.savefig(reports_dir / "vector_evaluation.svg")
print("Graficos gerados: reports/vector_evaluation.png e .svg")
