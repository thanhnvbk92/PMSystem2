"""Improvement verification for the monthly report (read from Reports/ImprovementList.xlsx).

List columns (no header): Line | Station | Error code (may be empty, or several separated by ';') | Model | Action | Date.
For each improvement, at that line + station + model (model = Job File mapping, else model id):
  code rate  = NG attempts with the error code (incl. 'CODE|...' sub-codes and '[instrument] CODE') / test attempts, in %
  before     = WINDOW days before the date, after = up to WINDOW days after (action day excluded)
  p-value    = two-proportion z-test; control = same station + model + code on lines without an action there
  trend      = weekly (daily when the after period is shorter than 14 days), before vs after
An empty error code is filled with the code that decreased most (significant) at that station.
Source: pcb_analytics_daily (factory wall-clock days)."""
import datetime as dt, math, os
from collections import defaultdict

WINDOW = 28

def _one(code, fam):
    return code == fam or code.startswith(fam + "|") or code.endswith("] " + fam) or code.endswith(" " + fam)

def _in_family(code, fams):
    """fams: one error code or several separated by ';' (each also matches its sub-codes / instrument prefix)."""
    return any(_one(code, f.strip()) for f in fams.split(";") if f.strip())

def _p2(k1, n1, k2, n2):
    if not n1 or not n2: return None
    p = (k1 + k2) / (n1 + n2)
    if not 0 < p < 1: return None
    z = (k2 / n2 - k1 / n1) / math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    return math.erfc(abs(z) / math.sqrt(2))

def read_list(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    items = []
    for r in wb.worksheets[0].iter_rows(values_only=True):
        r = list(r) + [None] * 6
        line, station, code, model, action, date = r[:6]
        if not line or not station or not model or date is None: continue
        if isinstance(date, dt.datetime): d = date.date()
        elif isinstance(date, dt.date): d = date
        else:
            try: d = dt.date.fromisoformat(str(date)[:10])
            except ValueError: continue        # header or text row
        items.append(dict(line=str(line).strip(), station=str(station).strip(), code=(str(code).strip() if code else ""),
                          model=str(model).strip(), action=(str(action).strip() if action else ""), date=d))
    return items

def analyze(conn, path, today):
    """today = exclusive end of data. Returns a list of dicts (one per improvement)."""
    if not os.path.exists(path): return []
    items = read_list(path)
    if not items: return []
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM models"); model_name = dict(cur.fetchall())
    cur.execute("SELECT job_file, model_id FROM job_file_model_mappings WHERE model_id IS NOT NULL"); job_model = dict(cur.fetchall())
    cur.execute("SELECT s.id, l.name, s.name FROM stations s JOIN lines l ON l.id = s.line_id")
    st = {i: (ln, sn) for i, ln, sn in cur.fetchall()}
    sids = [i for i, (ln, sn) in st.items() if sn in {it["station"] for it in items}]
    start = min(it["date"] for it in items) - dt.timedelta(days=WINDOW + 14)
    cur.execute("""SELECT bucket_date, station_id, job_file, model_id, result, error_code, sum(total_count)::bigint
                   FROM pcb_analytics_daily
                   WHERE bucket_date >= %s AND bucket_date < %s AND station_id = ANY(%s) AND error_code <> 'DEFECT_UNSPECIFIED'
                   GROUP BY 1, 2, 3, 4, 5, 6""", (start, today, sids))
    tests = defaultdict(int); ngc = defaultdict(int); tjob = defaultdict(int)
    for day, sid, job, mid, res, code, n in cur.fetchall():
        m = job_model.get(job) or mid or 0
        if m == 0: continue
        ln, sn = st[sid]; mn = model_name.get(m, f"model {m}")
        tests[(day, ln, sn, mn)] += n; tjob[(day, ln, sn, mn, job or "")] += n
        if res in ("NG", "FAIL"): ngc[(day, ln, sn, mn, code or "")] += n

    def agg(ln, sn, mn, fam, a, b):
        t = sum(v for (d, l, s, m), v in tests.items() if l == ln and s == sn and m == mn and a <= d < b)
        k = sum(v for (d, l, s, m, c), v in ngc.items() if l == ln and s == sn and m == mn and a <= d < b and (fam is None or _in_family(c, fam)))
        return t, k
    def by_code(ln, sn, mn, a, b):
        out = defaultdict(int)
        for (d, l, s, m, c), v in ngc.items():
            if l == ln and s == sn and m == mn and a <= d < b: out[c] += v
        return out

    res = []
    for it in items:
        d = it["date"]
        b0, b1 = d - dt.timedelta(days=WINDOW), d
        a0, a1 = d + dt.timedelta(days=1), min(d + dt.timedelta(days=WINDOW + 1), today)
        tb, _ = agg(it["line"], it["station"], it["model"], None, b0, b1)
        ta, _ = agg(it["line"], it["station"], it["model"], None, a0, a1)
        cb, ca = by_code(it["line"], it["station"], it["model"], b0, b1), by_code(it["line"], it["station"], it["model"], a0, a1)
        auto = False
        if not it["code"] and tb and ta:
            # code with the largest significant decrease of its rate at that station
            best = None
            for c in set(cb) | set(ca):
                rb_, ra_ = cb.get(c, 0) / tb, ca.get(c, 0) / ta
                p = _p2(cb.get(c, 0), tb, ca.get(c, 0), ta)
                if ra_ < rb_ and p is not None and p < 0.01 and (best is None or rb_ - ra_ > best[0]): best = (rb_ - ra_, c)
            if best: it = dict(it, code=best[1]); auto = True
        kb = sum(v for c, v in cb.items() if it["code"] and _in_family(c, it["code"]))
        ka = sum(v for c, v in ca.items() if it["code"] and _in_family(c, it["code"]))
        rb = kb * 100 / tb if tb else None; ra = ka * 100 / ta if ta else None
        rel = (ra - rb) / rb * 100 if rb else None
        p = _p2(kb, tb, ka, ta)
        rtb = sum(cb.values()) * 100 / tb if tb else None; rta = sum(ca.values()) * 100 / ta if ta else None
        acted = {x["line"] for x in items if x["station"] == it["station"] and abs((x["date"] - d).days) <= WINDOW}
        ctl = sorted({l for (_, l, s, m) in tests if s == it["station"] and m == it["model"] and l not in acted})
        ctb = ckb = cta = cka = 0
        for l in ctl:
            t1, k1 = agg(l, it["station"], it["model"], it["code"], b0, b1); t2, k2 = agg(l, it["station"], it["model"], it["code"], a0, a1)
            ctb += t1; ckb += k1; cta += t2; cka += k2
        crel = ((cka / cta - ckb / ctb) / (ckb / ctb) * 100) if ctb > 2000 and cta > 2000 and ckb else None
        days_after = (a1 - a0).days
        notes = []
        if auto: notes.append("error code detected from the data")
        if tb and ta < 0.1 * tb * days_after / WINDOW:
            notes.append(f"after-period tests dropped to {ta:,} (logs missing?)")
        if rtb is not None and rta is not None and rta - rtb >= 0.2 and ta >= 2000:
            ups = sorted(((ca.get(c, 0) / ta - cb.get(c, 0) / tb) * 100, c) for c in set(cb) | set(ca))[::-1][:2]
            ups = [f"{c} +{v:.2f}%p" for v, c in ups if v > 0]
            if ups: notes.insert(0, "station Re-test up mainly from " + ", ".join(ups))
        # a new job file (program) taking over right after the action also changes the result
        jb, ja = defaultdict(int), defaultdict(int)
        for (dd_, l, s_, m, j), v in tjob.items():
            if l == it["line"] and s_ == it["station"] and m == it["model"]:
                if d - dt.timedelta(days=7) <= dd_ < d: jb[j] += v
                elif d < dd_ <= d + dt.timedelta(days=7): ja[j] += v
        new_jobs = [j for j in ja if j and jb.get(j, 0) == 0]
        if ja and sum(ja[j] for j in new_jobs) > 0.5 * sum(ja.values()):
            top_ = sorted(new_jobs, key=lambda j: -ja[j])
            notes.append("new job file after the action: " + top_[0] + (f" (+{len(top_) - 1} more)" if len(top_) > 1 else ""))
        earlier = sorted({x["date"] for x in items if x["line"] == it["line"] and x["station"] == it["station"]
                          and x["model"] == it["model"] and b0 <= x["date"] < d})
        if earlier:
            notes.append("before period includes the action of " + ", ".join(f"{e:%d/%m} (W{e.isocalendar()[1]})" for e in earlier))
        if days_after < WINDOW: notes.append(f"only {days_after} days after")
        if crel is not None and rel is not None and rel < 0 and crel <= rel * 0.6:
            notes.append(f"control lines also {crel:+.0f}%")
        if rel is not None and rel <= -30 and ta:
            moved = max(((ca.get(c, 0) / ta - cb.get(c, 0) / tb) * 100, c) for c in set(cb) | set(ca) if not _in_family(c, it["code"]))
            if moved[0] >= 0.3 * (rb - ra):
                notes.append(f"watch: {moved[1]} rose +{moved[0]:.2f}%p at the same station")
        if ta < 2000 or days_after < 3: verdict = "Insufficient data"
        elif not it["code"]: verdict = "No error code"
        elif not tb or rb is None: verdict = "No baseline"
        elif kb == 0 and ka == 0: verdict = "Code not seen"
        elif rel <= -30 and p is not None and p < 0.05:
            verdict = "Effective"
        elif rel < -10: verdict = "Improving (not significant)" if (p is None or p >= 0.05) else "Small improvement"
        elif rel > 10 and p is not None and p < 0.05: verdict = "Worse"
        else: verdict = "No clear effect"
        if days_after < 7 and verdict not in ("Insufficient data", "No error code", "No baseline", "Code not seen"):
            verdict += " (early)"

        # trend: weekly, daily when the after period is short
        daily = days_after < 14
        pts = []
        if daily:
            day = d - dt.timedelta(days=14)
            while day < today:
                t, k = agg(it["line"], it["station"], it["model"], it["code"], day, day + dt.timedelta(days=1))
                if day != d: pts.append((day.strftime("%d/%m"), k * 100 / t if t else None, day > d, t))
                day += dt.timedelta(days=1)
        else:
            w = d - dt.timedelta(days=d.weekday()) - dt.timedelta(weeks=6)
            last = min(d + dt.timedelta(days=WINDOW + 14), today)
            while w < last:
                e = min(w + dt.timedelta(days=7), today)
                t, k = agg(it["line"], it["station"], it["model"], it["code"], w, e)
                pts.append((f"W{w.isocalendar()[1]}", k * 100 / t if t else None, w + dt.timedelta(days=3) > d, t))
                w += dt.timedelta(days=7)
        res.append(dict(it, before=[b0.isoformat(), b1.isoformat()], after=[a0.isoformat(), a1.isoformat()], days_after=days_after,
                        tests_before=tb, tests_after=ta, ng_before=kb, ng_after=ka, rate_before=rb, rate_after=ra, change_pct=rel,
                        p_value=p, retest_before=rtb, retest_after=rta, control_lines=ctl, control_change_pct=crel,
                        verdict=verdict, notes=notes, auto_code=auto, trend_daily=daily, trend=pts, date=d.isoformat()))
    return res
