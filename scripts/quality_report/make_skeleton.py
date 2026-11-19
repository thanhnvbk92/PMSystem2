"""Build the monthly-report skeleton from the Haengsung template.
Order: cover(7), contents(8), 3 content, section(10), 4 content (Line review), section(10 copy),
1 + 24 content (improvement summary + one Verify-PCA page per improvement, unused ones removed at build), 3 content, end(12)."""
import os, re, sys, shutil, subprocess, zipfile
SKILL = sys.argv[1]; TPL = sys.argv[2]; OUT = sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "build_m")
shutil.rmtree(D, ignore_errors=True)
zipfile.ZipFile(TPL).extractall(D)
created = []
N_PCA = 24
for _ in range(10 + N_PCA):
    out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "add_slide.py"), D, "slide17.xml"],
                         capture_output=True, text=True, check=True).stdout
    created.append(re.search(r"Created ppt/slides/(slide\d+)\.xml", out).group(1))
rels = open(os.path.join(D, "ppt", "_rels", "presentation.xml.rels"), encoding="utf-8").read()
rid = {m.group(2): m.group(1) for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="slides/(slide\d+)\.xml"', rels)}
p = os.path.join(D, "ppt", "presentation.xml"); x = open(p, encoding="utf-8").read()
sid = {r: i for i, r in re.findall(r'<p:sldId id="(\d+)" r:id="(rId\d+)"/>', x)}
out = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "add_slide.py"), D, "slide10.xml"],
                     capture_output=True, text=True, check=True).stdout
sec2 = re.search(r"Created ppt/slides/(slide\d+)\.xml", out).group(1)
rels = open(os.path.join(D, "ppt", "_rels", "presentation.xml.rels"), encoding="utf-8").read()
rid = {m.group(2): m.group(1) for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="slides/(slide\d+)\.xml"', rels)}
x = open(p, encoding="utf-8").read()
sid = {r: i for i, r in re.findall(r'<p:sldId id="(\d+)" r:id="(rId\d+)"/>', x)}
c = ["slide17"] + created
order = (["slide7", "slide8"] + c[0:3] + ["slide10"] + c[3:7] + [sec2] + c[7:8 + N_PCA] + c[8 + N_PCA:11 + N_PCA] + ["slide12"])
ids = [(sid[rid[s]], rid[s]) for s in order]
x = re.sub(r"<p:sldIdLst>.*?</p:sldIdLst>", "<p:sldIdLst>" + "".join(f'<p:sldId id="{i}" r:id="{r}"/>' for i, r in ids) + "</p:sldIdLst>", x, flags=re.S)
def sec(name, n, lst):
    return f'<p14:section name="{name}" id="{{0A1B2C3D-0000-4000-8000-00000000000{n}}}"><p14:sldIdLst>' + "".join(f'<p14:sldId id="{i}"/>' for i, _ in lst) + "</p14:sldIdLst></p14:section>"
secs = [("Cover &amp; Contents", ids[0:2]), ("Monthly KPI", ids[2:5]), ("Line 6-1 Improvement Review", ids[5:10]),
        ("Improvement Verification", ids[10:12 + N_PCA]), ("Highlights, Issues &amp; Actions", ids[12 + N_PCA:15 + N_PCA]),
        ("End", ids[15 + N_PCA:])]
x = re.sub(r"<p14:sectionLst.*?</p14:sectionLst>", '<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">'
           + "".join(sec(n, k + 1, l) for k, (n, l) in enumerate(secs)) + "</p14:sectionLst>", x, flags=re.S)
open(p, "w", encoding="utf-8").write(x)
subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "clean.py"), D], capture_output=True, check=True)
if os.path.exists(OUT): os.remove(OUT)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(D, "[Content_Types].xml"), "[Content_Types].xml")
    for root, _, files in os.walk(D):
        for f in files:
            full = os.path.join(root, f); arc = os.path.relpath(full, D).replace("\\", "/")
            if arc != "[Content_Types].xml": z.write(full, arc)
print("ok", order)
