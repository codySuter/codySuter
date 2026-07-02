#!/usr/bin/env python3
"""Generate the 24x36 in. legacy-saw chain identification wall poster.

Companion to build_poster.py (current models, factory DSM data): this one
covers discontinued/legacy saws using the fitment matrix extracted from the
STIHL Bar & Chain Catalog selection guide (data/catalog_fitment.js).

Models whose base designation exists in the current product data are left to
the main poster. Variants with identical fitment (MS 170 / MS 170 C) are
merged onto one label, and each bar/pitch/gauge setup shows one primary
chain (newest generation available in the price file today).

Writes sign-shop/poster-legacy.html.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load(name):
    raw = (ROOT / "data" / name).read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


def base(name):
    m = re.match(r"(i?[A-Z]{2,4} ?\d{2,3}(?:\.\d)?i?)", name)
    return m.group(1) if m else name


def pick_chain(chains):
    """Prefer the newest chain generation (family ending in 3, e.g. 63PM3)."""
    gen3 = [c for c in chains if re.match(r"\d{2} ?[A-Z]{2,3}3\b", c["name"])]
    return (gen3 or chains)[0]


def merge_label(names):
    """['MS 170', 'MS 170 C'] -> 'MS 170 / C'; keeps full names when the
    suffix trick would be ambiguous."""
    names = sorted(names, key=len)
    head = names[0]
    parts = [head]
    for n in names[1:]:
        if n.startswith(head + " "):
            parts.append(n[len(head) + 1:])
        else:
            parts.append(n)
    return " / ".join(parts)


def main():
    cat = load("catalog_fitment.js")
    products = load("products.js")
    current = {base(m["model"]) for m in products["models"]}

    # group variants that share identical fitment
    groups = defaultdict(list)
    for model, rows in cat.items():
        if base(model) in current or not rows:
            continue
        groups[(base(model), json.dumps(rows, sort_keys=True))].append(model)

    entries = []  # (section, label, rows)
    for (b, key), names in groups.items():
        rows_in = json.loads(key)
        seen, rows = set(), []
        for r in sorted(rows_in, key=lambda r: (r["bar"], r["pitch"], r["gauge"], r["dl"])):
            k = (r["bar"], r["pitch"], r["gauge"], r["dl"])
            if k in seen or not r["chains"]:
                continue
            seen.add(k)
            c = pick_chain(r["chains"])
            rows.append({"bar": r["bar"], "chain": c["name"], "part": c["part"]})
        if not rows:
            continue
        label = merge_label(names)
        if re.match(r"\d", b):
            sec = "GAS SAWS — CLASSIC NUMBER SERIES"
        elif b.startswith(("MSA", "MSE", "E ")):
            sec = "ELECTRIC & BATTERY SAWS"
        elif b.startswith(("HT", "HTA")):
            sec = "POLE PRUNERS"
        else:
            sec = "GAS SAWS — MS SERIES"
        entries.append((sec, label, rows, b))

    order = ["GAS SAWS — CLASSIC NUMBER SERIES", "GAS SAWS — MS SERIES",
             "ELECTRIC & BATTERY SAWS", "POLE PRUNERS"]

    def sort_key(e):
        sec, label, rows, b = e
        m = re.search(r"(\d+(?:\.\d)?)", b)
        return (order.index(sec), b.split()[0] if not re.match(r"\d", b) else "",
                float(m.group(1)) if m else 0, label)

    entries.sort(key=sort_key)
    total_rows = sum(len(rows) for _, _, rows, _ in entries)

    COLS = ('<colgroup><col style="width:34%"><col style="width:11%">'
            '<col style="width:24%"><col style="width:31%"></colgroup>')

    def block(label, rows):
        trs = "\n".join(
            f'<tr><td class="m">{label if i == 0 else ""}</td>'
            f'<td class="b">{r["bar"]}&Prime;</td>'
            f'<td class="c">{r["chain"]}</td>'
            f'<td class="p">{r["part"]}</td></tr>'
            for i, r in enumerate(rows))
        return f'<table class="mb">{COLS}<tbody>{trs}</tbody></table>'

    body_parts = []
    last_sec = None
    for sec, label, rows, _ in entries:
        if sec != last_sec:
            body_parts.append(f"""
    <div class="group">
      <div class="group-head">{sec}</div>
      <table class="hdr">{COLS}
        <thead><tr><th class="m">SAW MODEL</th><th class="b">BAR</th>
        <th class="c">CHAIN</th><th class="p">CHAIN PART #</th></tr></thead>
      </table>
    </div>""")
            last_sec = sec
        body_parts.append(block(label, rows))
    body_html = "\n".join(body_parts)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>STIHL Saw Chain Finder — Older Saws</title>
<link rel="stylesheet" href="fonts.css">
<style>
  @page {{ size: 24in 36in; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ width: 24in; height: 36in; overflow: hidden; }}
  body {{
    font-family: "Barlow", sans-serif; color: #191919; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  .band {{ background: #191919; color: #fff; padding: .35in .9in .32in;
    display: flex; align-items: flex-end; justify-content: space-between; }}
  .band .logo {{
    display: inline-block; background: #fff; color: #EF7A1A;
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .5in; line-height: 1;
    padding: .08in .18in .11in .15in; border-radius: .05in;
  }}
  .band .logo sup {{ font-size: .13in; font-style: normal; vertical-align: .24in; }}
  .band h1 {{
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .92in; line-height: .95;
    letter-spacing: -.015in; margin-top: .15in;
  }}
  .band h1 span {{ color: #EF7A1A; }}
  .band .sub {{
    font-family: "Barlow Condensed", sans-serif; font-weight: 600;
    font-size: .32in; letter-spacing: .035in; margin-top: .12in; opacity: .85;
  }}
  .band .right {{ text-align: right; font-family: "Barlow", sans-serif;
    font-weight: 600; font-size: .24in; line-height: 1.4; color: #ccc; }}
  .band .right b {{ color: #F9A05B; }}

  .content {{ height: 32.49in; padding: .3in .7in .12in; column-count: 6;
    column-gap: .4in; column-fill: auto; overflow: hidden; }}
  .group {{ break-inside: avoid-column; break-after: avoid-column;
    margin: .18in 0 .1in; }}
  .group:first-child {{ margin-top: 0; }}
  .group-head {{
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .21in; color: #EF7A1A;
    border-bottom: .028in solid #EF7A1A; padding-bottom: .05in;
    margin-bottom: .06in;
  }}
  table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
  table.mb {{ break-inside: avoid-column; }}
  th {{
    font-family: "Barlow", sans-serif; font-weight: 600; font-size: .1in;
    letter-spacing: .02in; color: #9C9C9C; text-align: left;
    padding: .03in .04in .04in; border-bottom: .014in solid #E4E4E4;
  }}
  td {{
    font-family: "Barlow Condensed", sans-serif; font-weight: 600;
    font-size: .14in; line-height: 1.06; padding: .014in .04in;
    border-bottom: .008in solid #ECECEC; white-space: nowrap;
    overflow: hidden;
  }}
  td.m {{ font-weight: 700; font-size: .135in; }}
  td.b, th.b {{ text-align: center; }}
  td.b {{ font-weight: 700; color: #EF7A1A; }}
  td.p {{ font-family: "Barlow", sans-serif; font-weight: 600; font-size: .12in; }}
  tbody tr:nth-child(even) {{ background: #F7F7F7; }}

  .footer {{
    display: flex; justify-content: space-between; align-items: center;
    padding: .18in .9in .24in; background: #F4F4F4;
    font-family: "Barlow", sans-serif; font-weight: 500; font-size: .17in;
    color: #888;
  }}
</style>
</head>
<body>
  <div class="band">
    <div>
      <div class="logo">STIHL<sup>&reg;</sup></div>
      <h1>CHAIN FINDER <span>&mdash; OLDER SAWS</span></h1>
      <div class="sub">DISCONTINUED &amp; CLASSIC MODELS &bull; CHAINS WE CAN STILL GET YOU TODAY</div>
    </div>
    <div class="right">
      Find your <b>model</b> (on the housing or starter cover)<br>
      and your <b>bar length</b> (stamped near the bar tip),<br>
      then bring the <b>chain part #</b> to the counter.
    </div>
  </div>
  <div class="content">
{body_html}
  </div>
  <div class="footer">
    <div>From the STIHL Guide Bar &amp; Saw Chain Selection Guide. Where several chains fit, the current-generation STIHL OILOMATIC&reg; loop is shown. The number after the chain name is the drive-link count.</div>
    <div>Don&rsquo;t see your saw or bar? Ask us &mdash; we&rsquo;ll match the loop.</div>
  </div>
</body>
</html>
"""
    out = ROOT / "poster-legacy.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}: {len(entries)} model groups, {total_rows} rows")


if __name__ == "__main__":
    main()
