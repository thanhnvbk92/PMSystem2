import json, urllib.request, urllib.parse, concurrent.futures as cf, datetime as dt, os, sys
B = "http://localhost:5000/api/v1"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")

def get(path, **q):
    q = {k: v for k, v in q.items() if v is not None}
    url = f"{B}{path}?{urllib.parse.urlencode(q)}"
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=900) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            err = str(e)
    return {"error": err}

def iso(d): return d.strftime("%Y-%m-%dT%H:%M:%S") + "+07:00"
END = dt.datetime(2026, 11, 16)   # end of ISO W46 (Mon 09/11 - Sun 15/11)
W0 = END - dt.timedelta(days=7)
jobs = {}
for w in range(6):
    e = END - dt.timedelta(days=7 * w); s = e - dt.timedelta(days=7)
    jobs[f"week{w}"] = ("/production/quality-modes", dict(startDate=iso(s), endDate=iso(e)))
jobs["weekcur"] = ("/production/quality-modes", dict(startDate=iso(END), endDate=iso(END + dt.timedelta(days=2))))
for d in range(9):
    s = W0 + dt.timedelta(days=d)
    jobs[f"day{d}"] = ("/production/quality-modes", dict(startDate=iso(s), endDate=iso(s + dt.timedelta(days=1))))
lines = get("/master/lines")
stations = get("/master/stations")
for l in lines:
    if l["id"] == 0: continue
    jobs[f"line{l['id']}"] = ("/production/quality-modes", dict(lineId=l["id"], startDate=iso(W0), endDate=iso(END)))
    jobs[f"lineprev{l['id']}"] = ("/production/quality-modes", dict(lineId=l["id"], startDate=iso(W0 - dt.timedelta(days=7)), endDate=iso(W0)))
for s in stations:
    if s["id"] == 0: continue
    jobs[f"st{s['id']}"] = ("/production/quality-modes", dict(stationId=s["id"], startDate=iso(W0), endDate=iso(END)))
jobs["pareto"] = ("/production/stats/defect-pareto", dict(startDate=iso(W0), endDate=iso(END)))
jobs["stationyield"] = ("/production/stats/station-yield", dict(startDate=iso(W0), endDate=iso(END)))
jobs["lineyield"] = ("/production/stats/line-yield", dict(startDate=iso(W0), endDate=iso(END)))

res = {"lines": lines, "stations": stations}
if os.path.exists(OUT):
    old = json.load(open(OUT, encoding="utf-8"))
    for k, v in old.items():
        if k in jobs and isinstance(v, dict) and "error" not in v or isinstance(v, list) and k in jobs:
            res[k] = v
jobs = {k: v for k, v in jobs.items() if k not in res}
print("todo", len(jobs), flush=True)
with cf.ThreadPoolExecutor(2) as ex:
    futs = {ex.submit(get, p, **q): k for k, (p, q) in jobs.items()}
    for n, f in enumerate(cf.as_completed(futs), 1):
        res[futs[f]] = f.result()
        print(n, len(jobs), futs[f], flush=True)
        json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("DONE")
