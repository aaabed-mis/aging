"""Take a dated snapshot of the dashboard data for MoM (month-over-month) comparison.

Copies data/material_aging.json (records + gdrn) into ../snapshots/ with a
YYYY-MM-DD name, and writes a small summary JSON with the key KPIs so you can
diff months without parsing the 28MB file.

Usage:
    python data/take_snapshot.py
"""
import json, os, shutil, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
DATA_JSON = os.path.join(DASH, "data", "material_aging.json")
SNAP_DIR = os.path.join(DASH, "snapshots")
os.makedirs(SNAP_DIR, exist_ok=True)

today = datetime.date.today().isoformat()  # e.g. 2026-09-02

with open(DATA_JSON, "r", encoding="utf-8") as f:
    payload = json.load(f)

# 1) full data snapshot (copy of the current export)
target = os.path.join(SNAP_DIR, f"material_aging_{today}.json")
shutil.copyfile(DATA_JSON, target)

# 2) summary for quick MoM comparison
records = payload.get("records", [])
gdrn = payload.get("gdrn", {})
buckets = {}
for r in records:
    b = r.get("aging_bucket")
    if b:
        buckets.setdefault(b, {"qty": 0, "val": 0, "batches": 0})
        buckets[b]["qty"] += r.get("clabs") or 0
        buckets[b]["val"] += r.get("value") or 0
        buckets[b]["batches"] += 1

summary = {
    "snapshot_date": today,
    "generated_at": payload.get("meta", {}).get("generated_at"),
    "row_count": len(records),
    "total_stock_value": round(sum(r.get("value") or 0 for r in records), 2),
    "buckets": buckets,
    "gdrn_total_ytd": gdrn.get("total_ytd"),
    "gdrn_item_count": len(gdrn.get("records", [])),
}
summary_path = os.path.join(SNAP_DIR, f"summary_{today}.json")
with open(summary_path, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

print("Snapshot:", target)
print("Summary :", summary_path)
print("KPIs:")
print("  total_stock_value:", summary["total_stock_value"])
print("  gdrn_total_ytd   :", summary["gdrn_total_ytd"])
print("  gdrn_item_count  :", summary["gdrn_item_count"])
