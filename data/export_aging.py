import duckdb, json, datetime, os
from collections import Counter
SRC = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\material_aging.duckdb"
SALES = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\duckdb\avg_sales_6mo.duckdb"
OUT = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\Dashboards\MaterialAgingDashboard\data\material_aging.json"
T = "sap_prd.material_aging"

# NOTE: the source schema of material_aging.duckdb has changed repeatedly between
# loads (columns added/renamed/removed). To stay robust we SELECT * and adapt in
# Python, so "rerun export" keeps working regardless of the current variant.
con = duckdb.connect(SRC, read_only=True)
rows = con.execute(f"SELECT * FROM {T}").fetchall()
names = [d[0] for d in con.description]
present = set(names)
print("Source columns:", names)

# Map possible column-name variants to canonical names.
def pick(*candidates):
    for c in candidates:
        if c in present:
            return c
    return None

C_WERKS  = pick("werks")
C_NAME1  = pick("name1", "name11")
C_REGIO  = pick("regio")
C_VKORG  = pick("vkorg")
C_MATNR  = pick("matnr")
C_MAKTX  = pick("maktx")
C_MATKL  = pick("matkl")
C_WGBEZ  = pick("wgbez")
C_EXTWG  = pick("extwg")
C_EWBEZ  = pick("ewbez")
C_MFRNR  = pick("mfrnr")
C_VENDOR= pick("vendor_name")
C_CHARG  = pick("charg")
C_VFDAT  = pick("vfdat")
C_HSDAT  = pick("hsdat")
C_CLABS  = pick("clabs")
C_NTGEW  = pick("ntgew")
C_GEWEI  = pick("gewei")
C_UMREZ  = pick("umrez")
C_MAPRICE= pick("ma_price")
C_LGORT  = pick("lgort")

# ---- recompute aging_date / aging_bucket (mirrors the original build logic) ----
import datetime as _dt
TODAY = _dt.date.today()
def _parsed_date(s):
    if not s: return None
    s = str(s).strip()
    if len(s) == 10 and s[4] == '.' and s[7] == '.':
        try: return _dt.datetime.strptime(s, "%Y.%m.%d").date()
        except: pass
    if len(s) == 8 and s.isdigit():
        try: return _dt.datetime.strptime(s, "%Y%m%d").date()
        except: pass
    return None

def compute_aging(vkorg, charg, vfdat):
    d = None
    v = (vkorg or '').strip()
    if v in ('1000', '', ' '):
        d = _parsed_date(charg)
    elif v == '6000':
        d = _parsed_date(vfdat)
    if d is None:
        return None, '>120 Days'
    delta = (d - TODAY).days
    if delta < 0:       b = 'Expired'
    elif delta <= 30:  b = '0-30'
    elif delta <= 60:  b = '31-60'
    elif delta <= 90:  b = '61-90'
    elif delta <= 120: b = '91-120'
    else:              b = '>120 Days'
    return d.strftime("%Y%m%d"), b

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
    if isinstance(v, str):
        v = v.strip()
        return None if v == '' else v
    return v

# Last sales date per material, from SAP billing fact (fact_ztsd_detail).
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

def get(rec, col):
    return rec.get(col) if col else None

data = []
for r in rows:
    rec = {names[i]: clean(r[i]) for i in range(len(names))}
    clabs = rec.get(C_CLABS) or 0
    ma_price = rec.get(C_MAPRICE) or 0
    rec["value"] = round(clabs * ma_price, 4)
    aging_date, aging_bucket = compute_aging(get(rec, C_VKORG), get(rec, C_CHARG), get(rec, C_VFDAT))
    rec["aging_date"] = aging_date
    rec["aging_bucket"] = aging_bucket
    rec["lgort"] = rec.get(C_LGORT) if C_LGORT else None  # carried when present in source, else null
    s = sales.get(rec.get(C_MATNR))
    rec["avg_monthly_active"] = round(s["avg_monthly_active"], 4) if (s and s["avg_monthly_active"] is not None) else None
    rec["total_qty_6mo"] = round(s["total_qty_6mo"], 4) if (s and s["total_qty_6mo"] is not None) else None
    ls = last_sales.get(str(rec.get(C_MATNR)))
    rec["last_sales"] = ls
    fc = forecast.get(str(rec.get(C_MATNR)))
    rec["forecast_value"] = round(fc["value"], 4) if (fc and fc["value"] is not None) else None
    rec["forecast_qty"] = round(fc["qty"], 4) if (fc and fc["qty"] is not None) else None
    data.append(rec)
con.close()

meta = {
    "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "source": f"material_aging.duckdb :: {T}",
    "grain": "WERKS + MATNR + CHARG (batches with CLABS > 0)",
    "row_count": len(data),
    "source_columns": names,
    "aging_buckets_order": ["Expired","0-30","31-60","61-90","91-120",">120 Days"],
    "note": "aging_date/aging_bucket recomputed in export from charg (VKORG 1000) / vfdat (VKORG 6000); lgort absent in current source. SELECT * keeps export resilient to schema changes.",
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"meta": meta, "records": data}, f, ensure_ascii=False)

OUT_JS = r"C:\Users\c.crizaldo\OneDrive - Ahmad A. Abed Trading Co. Ltd\Documents\Dashboards\MaterialAgingDashboard\data\data.js"
with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write("window.__AGING__ = ")
    json.dump({"meta": meta, "records": data}, f, ensure_ascii=False)
    f.write(";")

print("Rows written:", len(data))
print("Sample value rec:", {k: data[0].get(k) for k in [C_WERKS,C_MATNR,C_MAKTX,C_MATKL,'value','aging_bucket','last_sales','forecast_qty'] if k})
c = Counter(r["aging_bucket"] for r in data)
print("Bucket row counts:", dict(c))
tv = sum(r["value"] for r in data)
tq = sum(r.get(C_CLABS) or 0 for r in data)
print(f"Total stock value: {tv:,.2f}  | Total qty: {tq:,.2f}")
print("File size bytes:", os.path.getsize(OUT))

