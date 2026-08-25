import duckdb, json, datetime, os
SRC = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\material_aging.duckdb"
SALES = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\avg_sales_6mo.duckdb"
OUT = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\Dashboards\MaterialAgingDashboard\data\material_aging.json"

con = duckdb.connect(SRC, read_only=True)
T = "sap_prd.material_aging"

# Pull only the columns the dashboard needs. Coalesce blanks to null.
cols = ["werks","lgort","name1","regio","vkorg","matnr","maktx","extwg","ewbez","matkl","wgbez",
        "charg","clabs","ma_price","ntgew","gewei","aging_date","aging_bucket"]
sql = f"""
SELECT
  NULLIF(werks,'')   AS werks,
  NULLIF(lgort,'')   AS lgort,
  NULLIF(name1,'')   AS name1,
  NULLIF(regio,'')   AS regio,
  NULLIF(vkorg,'')   AS vkorg,
  NULLIF(matnr,'')   AS matnr,
  NULLIF(maktx,'')   AS maktx,
  NULLIF(extwg,'')   AS extwg,
  NULLIF(ewbez,'')   AS ewbez,
  NULLIF(matkl,'')   AS matkl,
  NULLIF(wgbez,'')   AS wgbez,
  NULLIF(charg,'')   AS charg,
  clabs,
  ma_price,
  ntgew,
  NULLIF(gewei,'')   AS gewei,
  NULLIF(aging_date,'') AS aging_date,
  NULLIF(aging_bucket,'') AS aging_bucket
FROM {T}
"""
rows = con.execute(sql).fetchall()
names = [d[0] for d in con.description]

# Load per-material avg sales (built from ZTSD_DETAIL over last 6 months)
con_sales = duckdb.connect(SALES, read_only=True)
sales = {}
for mat, tot, act, avg in con_sales.execute(
    "SELECT MATERIAL, total_qty_6mo, active_months, avg_monthly_active FROM avg_sales_6mo"
).fetchall():
    sales[mat] = {"total_qty_6mo": tot, "active_months": act, "avg_monthly_active": avg}
con_sales.close()

def clean(v):
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        return round(v, 6)
    return v

# Last sales date per material, from SAP billing fact (fact_ztsd_detail).
# material is 18-digit zero-padded, matching our matnr directly. Use MAX(inv_date).
FACT = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\fact_ztsd_detail.duckdb"
last_sales = {}
try:
    with duckdb.connect(FACT, read_only=True) as con_fact:
        for mat, mx in con_fact.execute(
            'SELECT material, MAX(inv_date) FROM sap_prd.fact_ztsd_detail GROUP BY 1'
        ).fetchall():
            if mat and mx:
                iso = mx.isoformat() if hasattr(mx, "isoformat") else str(mx)
                last_sales[str(mat)] = iso
except Exception as e:
    print("WARN: last_sales join skipped:", e)
    last_sales = {}

# Forecast per material, from fact_forecast (sum of zbvalue / zbqty across months/plants).
FC = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\fact_forecast.duckdb"
forecast = {}
try:
    with duckdb.connect(FC, read_only=True) as con_fc:
        for mat, val, qty in con_fc.execute(
            'SELECT material, SUM(zbvalue), SUM(zbqty) FROM sap_prd.fact_forecast GROUP BY 1'
        ).fetchall():
            if mat:
                forecast[str(mat)] = {
                    "value": float(val) if val is not None else None,
                    "qty": float(qty) if qty is not None else None,
                }
except Exception as e:
    print("WARN: forecast join skipped:", e)
    forecast = {}

data = []
for r in rows:
    rec = {names[i]: clean(r[i]) for i in range(len(names))}
    rec["value"] = round((rec["clabs"] or 0) * (rec["ma_price"] or 0), 4)
    s = sales.get(rec["matnr"])
    rec["avg_monthly_active"] = round(s["avg_monthly_active"], 4) if (s and s["avg_monthly_active"] is not None) else None
    rec["total_qty_6mo"] = round(s["total_qty_6mo"], 4) if (s and s["total_qty_6mo"] is not None) else None
    ls = last_sales.get(str(rec["matnr"]))
    rec["last_sales"] = ls
    fc = forecast.get(str(rec["matnr"]))
    rec["forecast_value"] = round(fc["value"], 4) if (fc and fc["value"] is not None) else None
    rec["forecast_qty"] = round(fc["qty"], 4) if (fc and fc["qty"] is not None) else None
    data.append(rec)
con.close()

meta = {
    "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "source": "material_aging.duckdb :: sap_prd.material_aging",
    "grain": "WERKS + MATNR + CHARG (batches with CLABS > 0)",
    "row_count": len(data),
    "aging_buckets_order": ["Expired","0-30","31-60","61-90","91-120",">120 Days"],
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"meta": meta, "records": data}, f, ensure_ascii=False)

# Inline variant so the dashboard opens via file:// (browsers block fetch on file://)
OUT_JS = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\Dashboards\MaterialAgingDashboard\data\data.js"
with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write("window.__AGING__ = ")
    json.dump({"meta": meta, "records": data}, f, ensure_ascii=False)
    f.write(";")

# sanity
print("Rows written:", len(data))
print("Sample value rec:", data[0])
from collections import Counter
c = Counter(r["aging_bucket"] for r in data)
print("Bucket row counts:", dict(c))
tv = sum(r["value"] for r in data)
tq = sum(r["clabs"] or 0 for r in data)
print(f"Total stock value: {tv:,.2f}  | Total qty: {tq:,.2f}")
print("File size bytes:", __import__("os").path.getsize(OUT))
