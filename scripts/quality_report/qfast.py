"""Fast monthly report data (a few minutes) from the PMSystem2 statistics tables.

  Re-test, error codes : pcb_analytics_daily (daily rollup on the factory wall-clock day)
  NTF, station/line RTY: pcb_ntf_summaries  (one row per PID + Station, with job file / model)
  plant RTY            : pcb_rty_summaries  (one row per PID)
NTF and RTY use the cohort of PCBs whose FIRST test (at the station / on the line / in the plant)
falls in the period. Model = Job File mapping, else the model id sent by the PC.
Every metric is additive per day, so any period is a sum of days.

Usage (normally via generate.py): python qfast.py --month 2026-11 --out data.json
"""
import argparse, datetime as dt, json, os, re, sys, time
from collections import defaultdict
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
T0 = time.time()
def log(msg): print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)

def connect():
    cs = os.environ.get("PMS_CONNECTION")
    if not cs:
        cfg = json.load(open(os.path.join(HERE, "..", "..", "backend", "appsettings.Local.json"), encoding="utf-8"))
        cs = cfg["ConnectionStrings"]["DefaultConnection"]
    kv = {k.strip().lower(): v for k, v in (p.split("=", 1) for p in cs.split(";") if "=" in p)}
    conn = psycopg2.connect(host=kv.get("host", "localhost"), port=kv.get("port", "5432"), dbname=kv["database"],
                            user=kv.get("username") or kv.get("user id"), password=kv["password"],
                            application_name="quality-report")
    conn.set_session(readonly=True, autocommit=True)
    return conn

def month_start(d, back=0):
    y, m = d.year, d.month - back
    while m <= 0: m += 12; y -= 1
    return dt.date(y, m, 1)

def collect(month: str, cfg: dict):
    RM = dt.date.fromisoformat(month + "-01")
    nxt = month_start(RM, -1)
    today = dt.date.today()
    RE = min(nxt, today)                                   # exclusive; today is still running
    if RE <= RM: raise SystemExit(f"No complete day in {month} yet.")
    FOCUS, CONTROL = cfg["focus_line_id"], cfg["control_line_id"]
    GROUPS = [g["name"] for g in cfg["model_groups"]]
    EXCL = set(cfg.get("excluded_error_codes", []))   # not real error codes (e.g. UNKNOWN): kept in Re-test, left out of code lists
    # Each model group has its own improvement start: before = [baseline_start, improvement_start), after = [improvement_start, RE)
    PERIODS = [((dt.date.fromisoformat(g["baseline_start"]), dt.date.fromisoformat(g["improvement_start"])),
                (dt.date.fromisoformat(g["improvement_start"]), RE)) for g in cfg["model_groups"]]
    WIN = (min([month_start(RM, cfg["trend_months"] - 1)] + [p[0][0] for p in PERIODS]), RE)
    conn = connect(); cur = conn.cursor()

    cur.execute("SELECT id, name FROM models")
    def group_of(name):
        if not name: return "No model"
        for g in GROUPS:
            if name.lower().startswith(g.lower()): return g
        return name
    model_group = {i: group_of(n) for i, n in cur.fetchall()}
    cur.execute("SELECT job_file, model_id FROM job_file_model_mappings WHERE model_id IS NOT NULL")
    job_model = dict(cur.fetchall())
    def eff_model(job, model_id):
        m = job_model.get(job)
        return m if m is not None else (model_id or 0)
    cur.execute("SELECT id, name, remark FROM lines ORDER BY id")
    lines = [{"id": i, "name": n, "remark": r} for i, n, r in cur.fetchall()]
    cur.execute("""SELECT s.id, s.line_id, l.name, s.name, mg.name FROM stations s
                   LEFT JOIN lines l ON l.id = s.line_id LEFT JOIN model_groups mg ON mg.id = s.model_group_id ORDER BY s.id""")
    stations = [{"id": i, "lineId": li, "lineName": ln, "name": n, "modelGroupName": g} for i, li, ln, n, g in cur.fetchall()]
    st_line = {s["id"]: s["lineId"] or 0 for s in stations}
    # Unassigned Line (line 0) is not part of the report; tests with an infinite start time never fall in a period.

    # ---- A. attempts per day / station / model group (rollup) ----
    att = defaultdict(lambda: [0, 0])        # (day, station, group) -> [attempts, ng]
    errs = defaultdict(int)                  # (day, line, group, code) -> ng
    errs_st = defaultdict(int)               # (day, station, group, code) -> ng
    excl_st = defaultdict(int)               # (day, station) -> ng with an excluded code
    cur.execute("""SELECT bucket_date, station_id, job_file, model_id, result, error_code, sum(total_count)::bigint
                   FROM pcb_analytics_daily
                   WHERE bucket_date >= %s AND bucket_date < %s AND error_code <> 'DEFECT_UNSPECIFIED'
                     AND error_code !~* %s    -- not a test (e.g. job change), left out completely
                   GROUP BY 1, 2, 3, 4, 5, 6""", WIN + (cfg.get("not_a_test_regex") or "^$NONE",))
    for day, sid, job, mid, res, code, n in cur.fetchall():
        em = eff_model(job, mid)
        if em == 0 or st_line.get(sid, 0) == 0: continue
        g = model_group.get(em, "No model"); ng = res in ("NG", "FAIL")
        a = att[(day, sid, g)]; a[0] += n
        if ng:
            a[1] += n
            c_ = code or "UNKNOWN_DEFECT"
            if c_ not in EXCL:
                errs[(day, st_line.get(sid, 0), g, c_)] += n
                errs_st[(day, sid, g, c_)] += n
            else:
                excl_st[(day, sid)] += n
    log(f"rollup rows aggregated ({len(att)} day-station-model keys)")

    # ---- B. NTF pairs per first-test day / station / model group ----
    pairs = defaultdict(lambda: [0, 0])
    cur.execute("""SELECT (first_test_time AT TIME ZONE 'UTC')::date, station_id, job_file, model_id,
                          count(*), count(*) FILTER (WHERE ever_ng)
                   FROM pcb_ntf_summaries
                   WHERE first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC')
                     AND pid <> 'None'
                   GROUP BY 1, 2, 3, 4""", WIN)
    for day, sid, job, mid, n, nng in cur.fetchall():
        if st_line.get(sid, 0) == 0: continue
        g = model_group.get(eff_model(job, mid), "No model")
        p = pairs[(day, sid, g)]; p[0] += n; p[1] += nng
    log("NTF pairs aggregated")

    # ---- C/D. line RTY (PID x line) and plant RTY (PID over all assigned lines), first-test cohorts ----
    lrty = defaultdict(lambda: [0, 0]); prty = defaultdict(lambda: [0, 0])
    cur.execute("""
        WITH x AS (
            SELECT n.pid, s.line_id, min(n.first_test_time) AS first_t, bool_or(n.ever_ng) AS ng,
                   (array_agg(n.job_file ORDER BY n.first_test_time DESC))[1] AS job_file,
                   (array_agg(n.model_id ORDER BY n.first_test_time DESC))[1] AS model_id
            FROM pcb_ntf_summaries n JOIN stations s ON s.id = n.station_id
            WHERE n.pid IN (SELECT pid FROM pcb_ntf_summaries
                            WHERE first_test_time >= (%s::timestamp AT TIME ZONE 'UTC') AND first_test_time < (%s::timestamp AT TIME ZONE 'UTC'))
              AND n.pid <> 'None' AND s.line_id <> 0 AND isfinite(n.first_test_time)
            GROUP BY n.pid, s.line_id),
        p AS (SELECT pid, min(first_t) AS first_t, bool_or(ng) AS ng FROM x GROUP BY pid)
        SELECT 'L', (first_t AT TIME ZONE 'UTC')::date, line_id, job_file, model_id, count(*), count(*) FILTER (WHERE ng)
        FROM x WHERE first_t >= (%s::timestamp AT TIME ZONE 'UTC') AND first_t < (%s::timestamp AT TIME ZONE 'UTC')
        GROUP BY 2, 3, 4, 5
        UNION ALL
        SELECT 'P', (first_t AT TIME ZONE 'UTC')::date, NULL, NULL, NULL, count(*), count(*) FILTER (WHERE ng)
        FROM p WHERE first_t >= (%s::timestamp AT TIME ZONE 'UTC') AND first_t < (%s::timestamp AT TIME ZONE 'UTC')
        GROUP BY 2""", WIN + WIN + WIN)
    for kind, day, lid, job, mid, n, nng in cur.fetchall():
        if kind == "P":
            r = prty[day]; r[0] += n; r[1] += nng; continue
        g = model_group.get(eff_model(job, mid), "No model")
        r = lrty[(day, lid, g)]; r[0] += n; r[1] += nng
    log("line and plant RTY aggregated")
    conn.close()

    def r_(n, d): return round(n * 100.0 / d, 2) if d else 0
    def qm(a, b, line=None, station=None, model=None):
        def keep(day, sid, g):
            return a <= day < b and (station is None or sid == station) and \
                   (line is None or st_line.get(sid, 0) == line) and (model is None or g == model)
        at = ng = pr = prng = 0
        for (day, sid, g), (n, k) in att.items():
            if keep(day, sid, g): at += n; ng += k
        for (day, sid, g), (n, k) in pairs.items():
            if keep(day, sid, g): pr += n; prng += k
        if station is not None:
            pc, pcng = pr, prng
        elif line is not None:
            pc = pcng = 0
            for (day, lid, g), (n, k) in lrty.items():
                if a <= day < b and lid == line and (model is None or g == model): pc += n; pcng += k
        else:
            pc = sum(v[0] for d_, v in prty.items() if a <= d_ < b); pcng = sum(v[1] for d_, v in prty.items() if a <= d_ < b)
        return {"retestAttempts": at, "retestNgAttempts": ng, "retestDefectRate": r_(ng, at),
                "ntfPcbStations": pr, "ntfNgPcbStations": prng, "ntfRate": r_(prng, pr),
                "rtyPcbs": pc, "rtyStraightThroughPcbs": pc - pcng, "rtyRate": r_(pc - pcng, pc)}
    def pareto(a, b, line=None, model=None, top=40):
        tot = defaultdict(int)
        for (day, lid, g, code), n in errs.items():
            if a <= day < b and (line is None or lid == line) and (model is None or g == model): tot[code] += n
        s = sum(tot.values()) or 1
        return [{"code": c, "count": n, "pct": round(n * 100.0 / s, 2)} for c, n in sorted(tot.items(), key=lambda kv: -kv[1])[:top]]

    def pareto_station(a, b, sid, model, top=40):
        tot = defaultdict(int)
        for (day, s_, g, code), n in errs_st.items():
            if a <= day < b and s_ == sid and g == model: tot[code] += n
        return [{"code": c, "count": n} for c, n in sorted(tot.items(), key=lambda kv: -kv[1])[:top]]
    def mrange(i): return month_start(RM, i), (RE if i == 0 else month_start(RM, i - 1))
    iso = lambda x: dt.datetime.combine(x, dt.time()).isoformat()
    out = {"lines": lines, "stations": stations, "models": GROUPS,
           "model_info": [{"name": g["name"], "short": g.get("short", g["name"]),
                           "before": [iso(PERIODS[k][0][0]), iso(PERIODS[k][0][1])],
                           "after": [iso(PERIODS[k][1][0]), iso(PERIODS[k][1][1])]} for k, g in enumerate(cfg["model_groups"])],
           "meta": {"report_month": dt.datetime.combine(RM, dt.time()).isoformat(), "report_end": dt.datetime.combine(RE, dt.time()).isoformat(),
                    "focus": FOCUS, "control": CONTROL, "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
                    "source": "rollup + summaries (first-test cohorts)",
                    "excluded": "Unassigned Line; tests with an infinite start time"}}
    for i in range(cfg["trend_months"]):
        a, b = mrange(i); out[f"m{i}"] = qm(a, b)
        for lid in (FOCUS, CONTROL):
            out[f"m{i}_line{lid}"] = qm(a, b, line=lid)
            for k, g in enumerate(GROUPS): out[f"m{i}_line{lid}_g{k}"] = qm(a, b, line=lid, model=g)
    a0, b0 = mrange(0)
    out["excl_m0_st"] = {str(s_): v for s_, v in
                         ((s_, sum(v for (d_, s2), v in excl_st.items() if s2 == s_ and a0 <= d_ < b0)) for s_ in {s2 for _, s2 in excl_st}) if v}
    for l in lines:
        if l["id"] in (0, FOCUS, CONTROL): continue
        for i in (0, 1):
            a, b = mrange(i); out[f"m{i}_line{l['id']}"] = qm(a, b, line=l["id"])
    w = dt.date.fromisoformat(cfg["weekly_trend_start"])
    w -= dt.timedelta(days=w.weekday())
    while w < RE:
        e = min(w + dt.timedelta(days=7), RE); n = w.isocalendar()[1]
        for lid in (FOCUS, CONTROL):
            for k, g in enumerate(GROUPS): out[f"wk{n}_line{lid}_g{k}"] = qm(w, e, line=lid, model=g)
        w += dt.timedelta(days=7)
    for k, g in enumerate(GROUPS):
        for tag, (a, b) in zip(("before", "after"), PERIODS[k]):
            for lid in (FOCUS, CONTROL):
                out[f"line{lid}_{tag}_g{k}"] = qm(a, b, line=lid, model=g)
                out[f"pareto_line{lid}_{tag}_g{k}"] = pareto(a, b, line=lid, model=g)
            for s in stations:
                if s["lineId"] in (FOCUS, CONTROL):
                    out[f"st{s['id']}_{tag}_g{k}"] = qm(a, b, station=s["id"], model=g)
                    if s["lineId"] == FOCUS: out[f"pareto_st{s['id']}_{tag}_g{k}"] = pareto_station(a, b, s["id"], g)
    for i in (0, 1):
        a, b = mrange(i); out[f"pareto_m{i}"] = pareto(a, b, top=20)
        for l in lines:
            if l["id"] != 0: out[f"pareto_m{i}_line{l['id']}"] = pareto(a, b, line=l["id"], top=60)
    a, b = mrange(0)
    ng_by_station = defaultdict(int)
    for (day, sid, g), (n, k) in att.items():
        if a <= day < b: ng_by_station[sid] += k
    for sid, _ in sorted(ng_by_station.items(), key=lambda kv: -kv[1])[:12]:
        out[f"m0_st{sid}"] = qm(a, b, station=sid)
    log("report data assembled")
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--out", required=True)
    ap.add_argument("--config", default=os.path.join(HERE, "report_config.json"))
    args = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}", args.month): raise SystemExit("--month must be YYYY-MM")
    data = collect(args.month, json.load(open(args.config, encoding="utf-8")))
    json.dump(data, open(args.out, "w", encoding="utf-8"), ensure_ascii=False)
    log(f"written {args.out}")
