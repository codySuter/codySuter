#!/usr/bin/env python3
"""Extract authoritative specs (and saw bar/chain part numbers) from the
STIHL Dealer Support Manual text and emit app data files.

Usage:
  python3 parse_dsm.py <dsm_text_file> [<dsm_text_file> ...]

Inputs are plain-text extractions of the DSM PDF (any subset of sections;
files are concatenated). Existing entries in data/specs_dsm.js are replaced.

Outputs:
  ../data/specs_dsm.js  window.SIGN_SPECS_DSM  {model: {title, specs[4]}}
  ../data/dsm_parts.js  window.SIGN_DSM_PARTS  {materialDash: {bar, chain, chainName}}

Accuracy gates:
  - specs come only from "Key: value" lines inside a model's own block
  - bar/chain part numbers are emitted only if they validate against the
    dealer price file's guide-bar list / replacement-chain list AND the row's
    unit material number matches a known variant of that model
  - SRP/dealer pricing in the DSM is ignored (pricing comes from the price
    file import, which is always newer)
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

SOURCE_LABEL = "2026 STIHL Dealer Support Manual V2 (April 2026)"

KEY_FIRST_WORDS = {
    "Weight", "Run", "Runtime", "Chain", "Cutting", "Blade", "Deck", "Area",
    "Grass", "Blowing", "Max", "Avg", "Air", "Sound", "Mechanical",
    "Electrical", "Bar", "Guide", "Shrub", "Cuts", "Battery", "Voltage",
    "Displacement", "Engine", "Power", "Fuel", "Oil", "Nozzle", "Water",
    "Pressure", "Flow", "Recommended", "Stroke", "Working", "Spray", "Tank",
    "Vacuum", "Suction", "Hose", "Cord", "Charge", "Solid", "Length",
    "Torque", "Drilling", "Sweeping", "Total",
}
KEY_RE = re.compile(r"\b([A-Z][A-Za-z0-9()®™ /&.'-]{2,48}?):\s+")
# keys anchored to the allowed vocabulary, so values ("Up to 25 minutes …")
# can never be consumed as keys
KEY_HEAD_RE = re.compile(
    r"\b((?:" + "|".join(sorted(KEY_FIRST_WORDS)) + r")[A-Za-z0-9()®™ /&.'-]{0,46}?):\s+")
STRAY_COLON_RE = re.compile(r"\s[A-Z][A-Za-z0-9()®™ /&.'-]{2,45}:")
TABLE_START_RE = re.compile(r"Description\s+(Part Number|Case Qty)|Part Number\s+Description")
PRICE_RE = re.compile(r"\$[\d,]+\.\d\d")
ELECTRIC_HDR_RE = re.compile(
    r"120 V \(60 ?[Hh]z\),\s*([\d.]+) kW \(([\d.]+) amps?\),\s*[\d.]+ kg \(([\d.]+) lbs?\.?\)")

MODEL_CATS_BATTERY = {"0LB", "1HB", "1LB", "1ZB", "1IB"}


def load_products():
    raw = (DATA / "products.js").read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


def norm_model(name: str) -> str:
    """Version-insensitive form: 'MSA 220.0 C-B' -> 'MSA 220 C-B'."""
    return re.sub(r"(\d)\.0(?=\s|$)", r"\1", name).strip()


def clean_value(v: str) -> str:
    v = re.sub(r"\s+", " ", v).strip().rstrip(":;,")
    # prefer the imperial value in parentheses: '3.1 kg (6.8 lbs.)' -> '6.8 lb'
    m = re.search(r"\(([\d.,]+ ?(?:lbs?|oz|mph|cfm|gal|in|ft)\.?\)?\"?)\)?", v)
    if m:
        v = m.group(1).rstrip(")")
    else:
        # inch values: '51.0 cm (20")' or '53.3 cm (21)"' -> '20″'
        m = re.search(r"\(([\d.]+)\s*\)?\s*\"", v)
        if m:
            v = m.group(1).rstrip(".0") + "″" if "." in m.group(1) else m.group(1) + "″"
    v = v.replace("lbs.", "lb").replace("lbs", "lb").replace("minutes", "min")
    # run-time values sometimes glue the next line's first word on
    if v.startswith("Up to"):
        v = re.sub(r"\s+[A-Z][a-z]+$", "", v)
    # trim runaway values (footnotes glued on)
    if len(v) > 30:
        v = v[:30].rsplit(" ", 1)[0] + "…"
    return v


def parse_block_specs(block: str):
    """Return dict of Key -> cleaned value from a model block."""
    tm = TABLE_START_RE.search(block)
    region = block[: tm.start()] if tm else block
    specs = {}
    matches = list(KEY_HEAD_RE.finditer(region))
    for i, m in enumerate(matches):
        key = re.sub(r"\s+", " ", m.group(1)).strip()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(region)
        val = region[m.end():end]
        # cut at any unrecognized "Some Phrase:" gluing onto the value,
        # and never span a paragraph of prose
        stray = STRAY_COLON_RE.search(val)
        if stray:
            val = val[:stray.start()]
        val = val.split("PLEASE NOTE")[0]
        specs.setdefault(key, clean_value(val))
    em = ELECTRIC_HDR_RE.search(block[:400])
    if em:
        specs.setdefault("Power Source", "120 V corded")
        specs.setdefault("Power Output", f"{em.group(1)} kW ({em.group(2)} A)")
        specs.setdefault("Weight", f"{em.group(3)} lb")
    return specs


def pick(specs, *keys):
    """First spec whose key starts with any of the given prefixes."""
    for want in keys:
        for k, v in specs.items():
            if k.lower().startswith(want.lower()) and v:
                return v
    return ""


def slot_specs(model, specs):
    """Map raw DSM keys onto the sign's four spec slots."""
    cat = model["category"]
    name = model["model"]
    is_battery = cat in MODEL_CATS_BATTERY or re.match(r"^[A-Z]{2,3}A\b", name)
    is_electric = bool(specs.get("Power Source"))

    if is_battery:
        battery = pick(specs, "Recommended Battery")
        weight = pick(specs, "Weight without battery", "Weight (Powerhead",
                      "Weight w/o", "Weight")
        runtime = pick(specs, "Run time", "Runtime", "Run Time")
        title = "BATTERY & PERFORMANCE"
        rows = [["BATTERY SYSTEM", battery], ["WEIGHT (W/O BATTERY)", weight]]
        if cat in ("0LB",) or name.startswith(("MSA", "GTA", "HTA")):
            rows += [["RUN TIME (UP TO)", runtime],
                     ["CHAIN TYPE", pick(specs, "Chain Type", "Bar & Chain", "Chain")]]
        elif name.startswith(("BGA", "BRA")):
            rows += [["AIR VOLUME", pick(specs, "Air Volume")],
                     ["MAX AIR VELOCITY", pick(specs, "Max Air Velocity", "Avg. Air Velocity")]]
        elif name.startswith(("HSA", "HLA")):
            rows += [["RUN TIME (UP TO)", runtime],
                     ["BLADE LENGTH", pick(specs, "Blade Length", "Cutting Length",
                                           "Shrub Shear Length", "Knife length")]]
        elif name.startswith(("FSA", "FCA")):
            rows += [["RUN TIME (UP TO)", runtime],
                     ["CUTTING WIDTH", pick(specs, "Cutting Width")]]
        elif name.startswith(("RMA", "RZA")):
            fourth = (["RUN TIME (UP TO)", runtime] if runtime
                      else ["AREA MOWED (UP TO)", pick(specs, "Area Mowed")])
            rows += [["CUTTING WIDTH", pick(specs, "Cutting Width", "Deck Width")],
                     fourth]
        else:
            extra = pick(specs, "Cutting", "Blowing Force", "Max Pressure",
                         "Water Flow", "Suction", "Sweeping", "Drilling", "Torque")
            rows += [["RUN TIME (UP TO)", runtime], ["PERFORMANCE", extra]]
        return title, rows

    if is_electric:
        title = "SPECIFICATIONS"
        fourth_label, fourth = "PERFORMANCE", ""
        if name.startswith(("BGE",)):
            fourth_label, fourth = "AIR VOLUME", pick(specs, "Air Volume")
        elif name.startswith(("SE",)):
            fourth_label, fourth = "SUCTION POWER", pick(specs, "Suction", "Vacuum")
        elif name.startswith(("HSE",)):
            fourth_label, fourth = "BLADE LENGTH", pick(specs, "Blade Length", "Cutting Length")
        elif name.startswith(("RE",)):
            fourth_label, fourth = "MAX PRESSURE", pick(specs, "Max Pressure", "Working Pressure", "Pressure")
        return title, [
            ["POWER SOURCE", specs.get("Power Source", "")],
            ["POWER OUTPUT", specs.get("Power Output", "")],
            ["WEIGHT", pick(specs, "Weight")],
            [fourth_label, fourth],
        ]

    # gas units
    title = "ENGINE & PERFORMANCE"
    weight_label = "POWERHEAD WEIGHT" if cat == "0CS" else "WEIGHT"
    rows = [
        ["DISPLACEMENT", pick(specs, "Displacement")],
        ["POWER OUTPUT", pick(specs, "Engine Power", "Power Output")],
        [weight_label, pick(specs, "Weight (Powerhead", "Powerhead Weight", "Weight")],
        ["FUEL CAPACITY", pick(specs, "Fuel Capacity")],
    ]
    if cat in ("1BB", "1BH"):
        rows[1] = ["AIR VOLUME", pick(specs, "Air Volume")]
        rows[3] = ["MAX AIR VELOCITY", pick(specs, "Max Air Velocity", "Avg. Air Velocity")]
    return title, rows


def parse_saw_parts(block: str, model, bars_set, chains_by_part, variants_set):
    """Pull per-configuration guide bar / chain part numbers out of a saw table.

    Rows look like (after removing $prices):
      '... MA03 200 0015 14" 3005 000 14" 4409 0000 792 9172 61 PS3 50 3699 005 0050 ...'
    Emits only entries where unit material, bar part, and chain part all
    validate against the dealer price file data.
    """
    tm = TABLE_START_RE.search(block)
    if not tm:
        return {}
    table = PRICE_RE.sub(" ", block[tm.start():])
    table = re.sub(r"\s+", " ", table)
    out = {}
    row_re = re.compile(
        r"(?P<unit>[A-Z0-9]{4} \d{3} \d{4})(?: US)?"          # unit material
        r"[^\d]{0,40}?(?P<len>\d{1,2})\" "                     # bar length
        r"(?P<barA>\d{4} \d{3}) (?:(?P=len)\" )?(?P<barB>\d{4})"  # split bar P/N
        r".{0,40}? (?P<mktA>\d{2}) ?(?P<mktB>[A-Z]{1,4}\d?) "  # chain marketing
        r"(?P<links>\d{2,3}) (?P<chA>\d{4}) (?:US )?(?P<chB>\d{3} \d{4})")
    for m in row_re.finditer(table):
        unit = m.group("unit").replace(" ", "-")
        bar = (m.group("barA") + " " + m.group("barB")).replace(" ", "-")
        chain = (m.group("chA") + " " + m.group("chB")).replace(" ", "-")
        chain_name = f'{m.group("mktA")}{m.group("mktB")} {m.group("links")}'
        if unit not in variants_set:
            continue
        if bar not in bars_set or chain not in chains_by_part:
            continue
        mkt = chains_by_part[chain].get("marketing", "")
        if mkt and mkt.replace(" ", "") != chain_name.replace(" ", ""):
            continue  # chain P/N and marketing number disagree — skip
        out[unit] = {"bar": bar, "chain": chain,
                     "chainName": mkt or chain_name, "barLen": int(m.group("len"))}
    return out


def main(paths):
    text = "\n\n".join(Path(p).read_text(errors="replace") for p in paths)
    text = text.replace("\\!", "!").replace("“", '"').replace("”", '"')
    text = text.replace(" ", " ")

    products = load_products()
    bars_set = {b["part"] for b in products["bars"]}
    chains_by_part = {c["part"]: c for c in products["chains"]}

    # locate each model's spec block: score every occurrence by how many
    # "Key: value" spec lines follow it, keep the best
    all_names = {m["model"] for m in products["models"]}

    def name_regex(name, flex):
        parts = []
        for t in name.split():
            base = t[:-2] if flex and t.endswith(".0") else t
            p = re.escape(base)
            if flex and base and base[-1].isdigit():
                p += r"(?:\.0)?"
            parts.append(p)
        return re.compile(r"(?<![A-Za-z0-9])" + r"\s+".join(parts) + r"(?![A-Za-z0-9.])")

    def find_best(name, flex):
        best = None
        for m in name_regex(name, flex).finditer(text):
            window = text[m.end(): m.end() + 1500]
            score = sum(1 for km in KEY_RE.finditer(window)
                        if km.group(1).split()[0] in KEY_FIRST_WORDS)
            # a real spec page opens with '<MODEL> … Series …' (or the
            # electric '120 V (60 hz)' header); comparison charts don't
            if re.search(r"Series|120 V", window[:80]):
                score += 100
            if score >= 2 and (best is None or score > best[1]):
                best = (m.start(), score)
        return best

    positions = []
    for model in products["models"]:
        hit = find_best(model["model"], flex=False)
        if not hit:
            # version-flexible match ('MSA 160 C-B' ~ 'MSA 160.0 C-B'), but only
            # when the flexed name is not itself a different catalog model —
            # successor generations must not inherit each other's specs
            flexed = norm_model(model["model"])
            conflict = any(n != model["model"] and norm_model(n) == flexed
                           for n in all_names)
            if not conflict:
                hit = find_best(model["model"], flex=True)
        if hit:
            positions.append((hit[0], model))
    positions.sort(key=lambda x: x[0])

    specs_out, parts_out = {}, {}
    for i, (pos, model) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else min(len(text), pos + 4000)
        block = text[pos:min(end, pos + 6000)]
        raw = parse_block_specs(block)
        if raw:
            title, rows = slot_specs(model, raw)
            if any(v for _, v in rows):
                specs_out[model["model"]] = {"title": title, "specs": rows}
        if model["category"] in ("0CS", "0LB"):
            variants_set = {v["materialDash"] for v in model["variants"]}
            parts_out.update(parse_saw_parts(block, model, bars_set,
                                             chains_by_part, variants_set))

    # SET packages share the base tool's hardware specs
    for model in products["models"]:
        name = model["model"]
        if name in specs_out or " SET" not in name:
            continue
        for base in (name.replace(" SET", ""),
                     name.replace(" SET", "").replace(" (USA)", "")):
            if base in specs_out:
                specs_out[name] = specs_out[base]
                break

    (DATA / "specs_dsm.js").write_text(
        "// Generated by tools/parse_dsm.py from the " + SOURCE_LABEL + ".\n"
        "// Do not edit by hand — rerun the parser instead.\n"
        "window.SIGN_SPECS_DSM = " + json.dumps(specs_out, indent=1, ensure_ascii=False) + ";\n")
    (DATA / "dsm_parts.js").write_text(
        "// Generated by tools/parse_dsm.py — bar/chain part numbers per unit\n"
        "// material, validated against the dealer price file lists.\n"
        "window.SIGN_DSM_PARTS = " + json.dumps(parts_out, indent=1) + ";\n")

    matched = set(specs_out)
    missing = [m["model"] for m in products["models"] if m["model"] not in matched]
    print(f"specs extracted for {len(specs_out)} models; "
          f"saw part sets for {len(parts_out)} unit materials")
    print(f"models still without DSM specs ({len(missing)}):")
    print("  " + ", ".join(missing))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
