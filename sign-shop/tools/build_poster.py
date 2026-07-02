#!/usr/bin/env python3
"""Generate the 24x36 in. saw chain identification wall poster.

Reads the app's verified data (products.js, dsm_parts.js, specs_dsm.js) and
writes sign-shop/poster.html — a print-ready page in the sign design
language. Every model/bar/chain row comes from the Dealer Support Manual's
configuration tables, cross-validated against the dealer price file.

Print to PDF at exact size with:  tools/build_poster.py --pdf
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load(name):
    raw = (ROOT / "data" / name).read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


# chain family code -> pitch, from STIHL's numbering (first digit) —
# confirmed by the DSM's own Chain Type lines (e.g. '3/8" PS3', '.325" RS3')
PITCH_BY_DIGIT = {"1": '1/4"', "2": '.325"', "3": '3/8"', "4": '.404"',
                  "6": '3/8" PICCO', "7": '1/4" PICCO'}


def family_of(chain_name):
    """'61PMM3 55' -> '61 PMM3'"""
    m = re.match(r"(\d{2})\s?([A-Z]+\d?)", chain_name)
    return (m.group(1) + " " + m.group(2)) if m else chain_name


def main():
    products = load("products.js")
    parts = load("dsm_parts.js")
    chains_by_part = {c["part"]: c for c in products["chains"]}

    # rows: model + bar -> chain (from the DSM configuration tables)
    sections = {
        "GAS CHAIN SAWS": [],
        "BATTERY CHAIN SAWS": [],
        "POLE PRUNERS & ELECTRIC SAWS": [],
    }
    sec_for_cat = {"0CS": "GAS CHAIN SAWS", "0LB": "BATTERY CHAIN SAWS",
                   "0ES": "POLE PRUNERS & ELECTRIC SAWS",
                   "1HT": "POLE PRUNERS & ELECTRIC SAWS",
                   "3TT": "POLE PRUNERS & ELECTRIC SAWS"}
    families_used = {}
    seen = set()
    for m in products["models"]:
        sec = sec_for_cat.get(m["category"])
        if not sec:
            continue
        display = m["model"] + ((" " + m["nickname"]) if m["nickname"] else "")
        for v in m["variants"]:
            p = parts.get(v["materialDash"])
            if not p:
                continue
            chain_meta = chains_by_part.get(p["chain"], {})
            key = (display, p["barLen"], p["chain"])
            if key in seen:
                continue
            seen.add(key)
            fam = family_of(p["chainName"])
            families_used.setdefault(fam, chain_meta.get("desc", ""))
            sections[sec].append({
                "model": display,
                "bar": p["barLen"],
                "chain": p["chainName"],
                "part": p["chain"],
                "sku": chain_meta.get("aceSku", ""),
            })

    for sec in sections.values():
        sec.sort(key=lambda r: (r["model"], r["bar"]))

    # legend: family -> full name + pitch
    legend = []
    for fam, desc in sorted(families_used.items()):
        name = re.sub(r"^[\d ]+[A-Z]+\d? ", "", desc)
        name = re.sub(r"\s*[Cc]hain.*$", "", name).strip() or "STIHL OILOMATIC"
        pitch = PITCH_BY_DIGIT.get(fam[0], "")
        legend.append((fam, name, pitch))

    total_rows = sum(len(s) for s in sections.values())

    COLS = ('<colgroup><col style="width:29%"><col style="width:10%">'
            '<col style="width:18%"><col style="width:26%">'
            '<col style="width:17%"></colgroup>')

    def model_blocks(rows):
        """One atomic table per model so a model never splits across
        columns without its name."""
        blocks, current, cur_model = [], [], None
        for r in rows:
            if r["model"] != cur_model and current:
                blocks.append((cur_model, current))
                current = []
            cur_model = r["model"]
            current.append(r)
        if current:
            blocks.append((cur_model, current))
        out = []
        for model, rs in blocks:
            trs = "\n".join(
                f'<tr><td class="m">{model if i == 0 else ""}</td>'
                f'<td class="b">{r["bar"]}&Prime;</td>'
                f'<td class="c">{r["chain"]}</td>'
                f'<td class="p">{r["part"]}</td>'
                f'<td class="s">{r["sku"] or "—"}</td></tr>'
                for i, r in enumerate(rs))
            out.append(f'<table class="mb">{COLS}<tbody>{trs}</tbody></table>')
        return "\n".join(out)

    def section_html(title, rows):
        if not rows:
            return ""
        return f"""
    <div class="group">
      <div class="group-head">{title}</div>
      <table class="hdr">{COLS}
        <thead><tr><th class="m">SAW MODEL</th><th class="b">BAR</th>
        <th class="c">CHAIN</th><th class="p">CHAIN PART #</th>
        <th class="s">STORE SKU</th></tr></thead>
      </table>
    </div>
{model_blocks(rows)}"""

    legend_html = "\n".join(
        f'<div class="fam"><div class="fam-code">{fam}</div>'
        f'<div class="fam-name">{name}</div>'
        f'<div class="fam-pitch">{pitch} pitch</div></div>'
        for fam, name, pitch in legend)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>STIHL Saw Chain Finder</title>
<link rel="stylesheet" href="fonts.css">
<style>
  @page {{ size: 24in 36in; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ width: 24in; height: 36in; overflow: hidden; }}
  body {{
    font-family: "Barlow", sans-serif; color: #191919; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  .band {{ background: #EF7A1A; color: #fff; padding: .45in .9in .4in; }}
  .band .logo {{
    display: inline-block; background: #fff; color: #EF7A1A;
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .62in; line-height: 1;
    padding: .1in .22in .13in .18in; border-radius: .06in;
  }}
  .band .logo sup {{ font-size: .16in; font-style: normal; vertical-align: .3in; }}
  .band h1 {{
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: 1.35in; line-height: .95;
    letter-spacing: -.02in; margin-top: .25in;
  }}
  .band .sub {{
    font-family: "Barlow Condensed", sans-serif; font-weight: 600;
    font-size: .42in; letter-spacing: .04in; margin-top: .18in; opacity: .92;
  }}
  .howto {{
    display: flex; gap: .6in; padding: .45in .9in;
    background: #191919; color: #fff;
  }}
  .step {{ display: flex; align-items: center; gap: .25in; flex: 1; }}
  .step .n {{
    flex: none; width: .75in; height: .75in; border-radius: 50%;
    background: #EF7A1A; color: #fff; display: flex; align-items: center;
    justify-content: center; font-family: "Barlow Semi Condensed", sans-serif;
    font-weight: 800; font-style: italic; font-size: .46in;
  }}
  .step .t {{ font-family: "Barlow", sans-serif; font-weight: 600;
    font-size: .27in; line-height: 1.25; }}
  .step .t b {{ color: #F9A05B; }}

  .content {{ height: 24.9in; padding: .5in .9in .2in; column-count: 3;
    column-gap: .7in; column-fill: auto; overflow: hidden; }}
  .group {{ break-inside: avoid-column; margin-bottom: .5in; }}
  .group-head {{
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .44in; color: #EF7A1A;
    border-bottom: .045in solid #EF7A1A; padding-bottom: .08in;
    margin-bottom: .14in;
  }}
  table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
  table.mb {{ break-inside: avoid-column; }}
  .group {{ break-after: avoid-column; }}
  th {{
    font-family: "Barlow", sans-serif; font-weight: 600; font-size: .16in;
    letter-spacing: .035in; color: #9C9C9C; text-align: left;
    padding: .05in .08in .07in; border-bottom: .02in solid #E4E4E4;
  }}
  td {{
    font-family: "Barlow Condensed", sans-serif; font-weight: 600;
    font-size: .255in; padding: .055in .08in;
    border-bottom: .014in solid #ECECEC; white-space: nowrap;
  }}
  td.m {{ font-weight: 700; }}
  td.b, th.b {{ text-align: center; }}
  td.b {{ font-weight: 700; color: #EF7A1A; }}
  td.c {{ letter-spacing: .01in; }}
  td.p {{ font-family: "Barlow", sans-serif; font-weight: 600; font-size: .22in; }}
  td.s {{ color: #666; font-size: .22in; }}
  tbody tr:nth-child(even) {{ background: #F7F7F7; }}

  .legend {{ background: #F4F4F4; padding: .32in .9in .3in; }}
  .legend-head {{
    font-family: "Barlow", sans-serif; font-weight: 700; font-size: .3in;
    letter-spacing: .07in; color: #EF7A1A; margin-bottom: .22in;
  }}
  .fams {{ display: flex; flex-wrap: wrap; gap: .22in .45in; }}
  .fam {{ min-width: 2.55in; }}
  .fam-code {{
    font-family: "Barlow Semi Condensed", sans-serif; font-weight: 800;
    font-style: italic; font-size: .34in; color: #191919;
  }}
  .fam-name {{ font-family: "Barlow Condensed", sans-serif; font-weight: 600;
    font-size: .26in; margin-top: .02in; }}
  .fam-pitch {{ font-family: "Barlow", sans-serif; font-weight: 600;
    font-size: .19in; letter-spacing: .03in; color: #9C9C9C; margin-top: .02in; }}
  .footer {{
    display: flex; justify-content: space-between; align-items: center;
    padding: .22in .9in .3in; background: #F4F4F4;
    font-family: "Barlow", sans-serif; font-weight: 500; font-size: .2in;
    color: #9C9C9C;
  }}
</style>
</head>
<body>
  <div class="band">
    <div class="logo">STIHL<sup>®</sup></div>
    <h1>FIND YOUR SAW CHAIN</h1>
    <div class="sub">MATCH YOUR SAW &amp; BAR LENGTH TO THE RIGHT STIHL OILOMATIC&reg; CHAIN</div>
  </div>
  <div class="howto">
    <div class="step"><div class="n">1</div><div class="t">Find your <b>saw model</b> — it&rsquo;s printed on the starter cover or the side of the housing.</div></div>
    <div class="step"><div class="n">2</div><div class="t">Check your <b>bar length</b> — stamped near the tip of the guide bar (16&Prime;, 18&Prime;, 20&Prime;&hellip;).</div></div>
    <div class="step"><div class="n">3</div><div class="t">Match the row below and bring the <b>chain part #</b> to the counter. We&rsquo;ll take it from there.</div></div>
  </div>
  <div class="content">
{section_html("GAS CHAIN SAWS", sections["GAS CHAIN SAWS"])}
{section_html("BATTERY CHAIN SAWS", sections["BATTERY CHAIN SAWS"])}
{section_html("POLE PRUNERS & ELECTRIC SAWS", sections["POLE PRUNERS & ELECTRIC SAWS"])}
  </div>
  <div class="legend">
    <div class="legend-head">KNOW YOUR CHAIN FAMILIES</div>
    <div class="fams">
{legend_html}
    </div>
  </div>
  <div class="footer">
    <div>Factory configurations from the 2026 STIHL Dealer Support Manual. The number after the chain name is the drive-link count &mdash; it must match your bar.</div>
    <div>Running a non-standard bar? Ask us &mdash; we&rsquo;ll match the loop.</div>
  </div>
</body>
</html>
"""
    out = ROOT / "poster.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}: {total_rows} configuration rows, "
          f"{len(legend)} chain families")


if __name__ == "__main__":
    main()
