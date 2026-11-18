import re, sys, os, zipfile
d = sys.argv[1]
p = os.path.join(d, "ppt", "presentation.xml")
x = open(p, encoding="utf-8").read()
ids = re.findall(r'<p:sldId id="(\d+)"', re.search(r"<p:sldIdLst>.*?</p:sldIdLst>", x).group(0))
def sec(name, guid, lst):
    return f'<p14:section name="{name}" id="{{{guid}}}"><p14:sldIdLst>' + "".join(f'<p14:sldId id="{i}"/>' for i in lst) + "</p14:sldIdLst></p14:section>"
new = ('<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">'
       + sec("Bìa &amp; Mục lục", "0A1B2C3D-0000-4000-8000-000000000001", ids[:2])
       + sec("Báo cáo NTF · Re-test · FPY", "0A1B2C3D-0000-4000-8000-000000000002", ids[2:-1])
       + sec("Kết thúc", "0A1B2C3D-0000-4000-8000-000000000003", ids[-1:])
       + "</p14:sectionLst>")
x = re.sub(r"<p14:sectionLst.*?</p14:sectionLst>", new, x, flags=re.S)
open(p, "w", encoding="utf-8").write(x)
out = sys.argv[2]
if os.path.exists(out): os.remove(out)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    # [Content_Types].xml first
    z.write(os.path.join(d, "[Content_Types].xml"), "[Content_Types].xml")
    for root, _, files in os.walk(d):
        for f in files:
            full = os.path.join(root, f); arc = os.path.relpath(full, d).replace("\\", "/")
            if arc != "[Content_Types].xml": z.write(full, arc)
print("ok", ids)
