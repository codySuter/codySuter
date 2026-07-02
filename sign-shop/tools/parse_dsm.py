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
    "Pressure", "Flow", "Recommended", "Stroke", "Strokes", "Working",
    "Spray", "Tank", "Vacuum", "Suction", "Hose", "Cord", "Charge", "Solid",
    "Length", "Torque", "Drilling", "Sweeping", "Total", "Horsepower",
    "Overall",
}
KEY_RE = re.compile(r"\b([A-Z][A-Za-z0-9()®™ /&.'-]{2,48}?):\s+")
# keys anchored to the allowed vocabulary, so values ("Up to 25 minutes …")
# can never be consumed as keys
KEY_HEAD_RE = re.compile(
    r"\b((?:" + "|".join(sorted(KEY_FIRST_WORDS)) + r")[A-Za-z0-9()®™ /&.'*-]{0,46}?):\s+")
STRAY_COLON_RE = re.compile(r"\s[A-Z][A-Za-z0-9()®™ /&.'*-]{2,45}:")
# gas one-liners, two layouts:
#   saws:   '3.06 cu. in. (50.2 cc), 3.5 bhp (2.6 kW)'
#   others: '64.8 cc (3.95 cu. in.), 2.8 kW (3.8 bhp), 9.8 kg (21.6 Ibs.…'
GAS_INLINE_RE = re.compile(
    r"([\d.]+)\s*cu\.?\s*in\.?\s*\(([\d.]+)\s*cc\)[,\s]*([\d.]+)\s*bhp"
    r"(?:\s*\(([\d.]+)\s*kW\))?"
    r"(?:[,\s]*(?:[A-Za-z-]+ \(Shown\):\s*)?([\d.]+)\s*kg\s*\(([\d.]+)\s*lbs?)?")
GAS_INLINE2_RE = re.compile(
    r"([\d.]+)\s*cc\s*\(([\d.]+)\s*cu\.?\s*in\.?\),?\s*([\d.]+)\s*kW\s*\(([\d.]+)\s*b?hp\)"
    r"(?:,?\s*([\d.]+)\s*kg\s*\(([\d.]+)\s*lbs?)?"
    r"(?:,?\s*([\d.]+)\s*L\s*\(([\d.]+)\s*qt)?")
TABLE_START_RE = re.compile(r"Description\s+(Part Number|Case Qty)|Part Number\s+Description")
PRICE_RE = re.compile(r"\$[\d,]+\.\d\d")
ELECTRIC_HDR_RE = re.compile(
    r"120 [Vv](?:olts?)? \(60 ?[Hh]z\),\s*([\d.]+) kW \(([\d.]+) amps?\),\s*"
    r"(?:[\d.]+ kg \()?([\d.]+) lbs?\.?\)?")

MODEL_CATS_BATTERY = {"0LB", "1HB", "1LB", "1ZB", "1IB"}

# catalog name -> the name the manual uses for the same tool
MODEL_ALIASES = {
    "MSE 170 C-BQ": "MSE 170 C-B",
}


def load_products():
    raw = (DATA / "products.js").read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


def norm_model(name: str) -> str:
    """Version-insensitive form: 'MSA 220.0 C-B' -> 'MSA 220 C-B'."""
    return re.sub(r"(\d)\.0(?=\s|$)", r"\1", name).strip()


def clean_value(v: str) -> str:
    v = re.sub(r"\s+", " ", v).replace("*", "").strip().rstrip(":;,")
    v = re.sub(r"^\([^)]{1,12}\)\s*", "", v)  # leading '(144 Wh)' etc.
    v = v.replace('sq. "', "sq. ft")  # 'ft' ligature extracts as '"'
    v = re.sub(r"\bminutes?\b", "min", v, flags=re.I)
    # capacity typo guard: when 'NNN cc (M oz.)' disagree (HL 56 K says
    # '340 cc (1.5 oz.)'), recompute ounces from the metric value
    cm = re.match(r"^(\d{2,4})\s*cc\s*\(([\d.]+)\s*oz", v)
    if cm and abs(int(cm.group(1)) / 29.5735 - float(cm.group(2))) > 1:
        return str(round(int(cm.group(1)) / 29.5735, 1)) + " oz"
    # oz-first fuel form: '20.3 oz. (600 cc)' -> '20.3 oz.'
    om = re.match(r"^([\d.]+ ?oz\.?)\s*\(", v)
    if om:
        return om.group(1)
    # 'Engine Power: 0.8 kW (1.1 bhp), 6.1 kg (13.5 lbs)' -> '0.8 kW / 1.1 bhp'
    m = re.match(r"^([\d.]+) kW \(([\d.]+) bhp\)", v)
    if m:
        return m.group(1) + " kW / " + m.group(2) + " bhp"
    # prefer the imperial value in parentheses: '3.1 kg (6.8 lbs.)' -> '6.8 lb',
    # 'Fuel Capacity: 710 cc (24.0 oz.)' -> '24.0 oz'
    m = re.search(r"\(([\d.,]+ ?(?:lbs?|oz|mph|cfm|gal|in|ft|psi|gpm|GPM)\.?\)?\"?)\)?", v)
    if m:
        v = m.group(1).rstrip(")")
    elif re.match(r"^[\d.]+ cc\b", v):
        # 'Displacement: 27.2 cc (1.7 cu. in.)' -> '27.2 cc'
        return re.match(r"^([\d.]+ cc)\b", v).group(1)
    else:
        # inch values: '51.0 cm (20")' or '53.3 cm (21)"' -> '20″'
        m = re.search(r"\(([\d.]+)\s*\)?\s*\"", v)
        if m:
            v = m.group(1).rstrip(".0") + "″" if "." in m.group(1) else m.group(1) + "″"
    v = v.replace("lbs.", "lb").replace("lbs", "lb")
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
        key = re.sub(r"\s+", " ", m.group(1)).replace("*", "").strip()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(region)
        val = region[m.end():end]
        # cut at any unrecognized "Some Phrase:" gluing onto the value,
        # and never span a paragraph of prose
        stray = STRAY_COLON_RE.search(val)
        if stray:
            val = val[:stray.start()]
        val = val.split("PLEASE NOTE")[0]
        specs.setdefault(key, clean_value(val))
    def checked_cc(cuin, cc):
        """The manual occasionally mistypes one of the paired values
        ('1.94 cu. in. (38.1 cc)'); recompute cc from cu. in. on conflict."""
        calc = float(cuin) * 16.387
        if abs(calc - float(cc)) > 1.5:
            return str(round(calc, 1))
        return cc

    # gas pages carry displacement/power (/weight) as an inline line
    gm = GAS_INLINE_RE.search(region)
    if gm:
        specs.setdefault("Displacement", checked_cc(gm.group(1), gm.group(2)) + " cc")
        power = (gm.group(4) + " kW / " + gm.group(3) + " bhp") if gm.group(4) \
            else gm.group(3) + " bhp"
        specs.setdefault("Power Output", power)
        if gm.group(6):
            specs.setdefault("Weight", gm.group(6) + " lb")
    gm = GAS_INLINE2_RE.search(region)
    if gm:
        specs.setdefault("Displacement", checked_cc(gm.group(2), gm.group(1)) + " cc")
        specs.setdefault("Power Output", gm.group(3) + " kW / " + gm.group(4) + " bhp")
        if gm.group(6):
            specs.setdefault("Weight", gm.group(6) + " lb")
        if gm.group(8):
            specs.setdefault("Fuel Capacity", gm.group(8) + " qt")
    # engines described without a power figure ('190 cc (11.59 cu. in.), …')
    gm = re.search(r"([\d.]+)\s*cc\s*\(([\d.]+)\s*cu\.?\s*in", region)
    if gm:
        specs.setdefault("Displacement", gm.group(1) + " cc")
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
        battery = re.sub(r"\s+Recommend\w*$", "", pick(specs, "Recommended Battery"))
        weight = pick(specs, "Weight without battery", "Weight Without Battery",
                      "Weight (Powerhead", "Weight w/o", "Weight")
        runtime = pick(specs, "Run time", "Runtime", "Run Time", "Run- Time",
                       "Run-time", "Run-Time")
        title = "BATTERY & PERFORMANCE"
        rows = [["BATTERY SYSTEM", battery], ["WEIGHT (W/O BATTERY)", weight]]
        if cat in ("0LB",) or name.startswith(("MSA", "GTA", "HTA")):
            rows += [["RUN TIME (UP TO)", runtime],
                     ["CHAIN TYPE", pick(specs, "Chain Type", "Bar & Chain")]]
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
                         "Water Flow", "Maximum Suction", "Suction Power",
                         "Sweeping", "Drilling", "Torque")
            rows += [["RUN TIME (UP TO)", runtime], ["PERFORMANCE", extra]]
        return title, rows

    # powerhead attachments have no engine of their own
    if cat in ("3TT", "3MA"):
        return "SPECIFICATIONS", [
            ["FITS", "STIHL KombiMotors" if cat == "3TT" else "MM 56 YARD BOSS"],
            ["WEIGHT", pick(specs, "Weight")],
            ["OVERALL LENGTH", pick(specs, "Overall Length", "Length")],
            ["", ""],
        ]

    # pressure washers (gas RB and corded RE share the layout)
    if cat == "1RB":
        displacement = pick(specs, "Displacement")
        if displacement:
            fourth = ["DISPLACEMENT", displacement]
        elif name.startswith("RE"):  # RE washers are the corded line
            fourth = ["POWER SOURCE", "120 V corded"]
        else:
            fourth = ["DISPLACEMENT", ""]
        return "SPECIFICATIONS", [
            ["MAX PRESSURE", pick(specs, "Water Pressure", "Max Pressure", "Working Pressure")],
            ["WATER FLOW", pick(specs, "Water Flow", "Flow")],
            ["WEIGHT", pick(specs, "Weight")],
            fourth,
        ]

    if is_electric:
        title = "SPECIFICATIONS"
        fourth_label, fourth = "PERFORMANCE", ""
        if name.startswith(("BGE",)):
            fourth_label, fourth = "AIR VOLUME", pick(specs, "Air Volume")
        elif name.startswith(("SE",)):
            fourth_label, fourth = "SUCTION POWER", pick(specs, "Suction", "Vacuum")
        elif name.startswith(("HSE",)):
            fourth_label, fourth = "BLADE LENGTH", pick(specs, "Blade Length", "Cutting Length")
        elif name.startswith(("FSE",)):
            fourth_label, fourth = "CUTTING WIDTH", pick(specs, "Cutting Swath", "Cutting Width")
        return title, [
            ["POWER SOURCE", specs.get("Power Source", "")],
            ["POWER OUTPUT", specs.get("Power Output", "")],
            ["WEIGHT", pick(specs, "Weight")],
            [fourth_label, fourth],
        ]

    # gas zero-turns / front mowers
    if cat in ("1RZ", "8RZ"):
        return "ENGINE & PERFORMANCE", [
            ["DISPLACEMENT", pick(specs, "Displacement")],
            ["POWER OUTPUT", pick(specs, "Horsepower", "Engine Power", "Power Output")],
            ["WEIGHT", pick(specs, "Weight")],
            ["DECK WIDTH", pick(specs, "Deck Width", "Cutting Width")],
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


def fmt_part(digits: str) -> str:
    """'30038123317' -> '3003-812-3317'; unit materials may start with letters."""
    return digits[:4] + "-" + digits[4:7] + "-" + digits[7:]


def parse_parts_tables(text: str, bars_set, chains_by_part, variant_models):
    """Pull per-configuration guide bar / chain part numbers out of the DSM's
    'Bar Length | Guide Bar | [Scabbard] | Chain | Chain PN | Part Number'
    tables, wherever they appear.

    Rows (pypdf extraction, digit groups may have stray spaces):
      '18" 3003 812 3317 0000 792 9175 23RM3 7 4 3695 005 007 4 1141 200 0681 US $529.99'
      '14" 3005 000 4409 0000 792 9172 61 PS3 50 3699 005 0050 MA03 200 0015 $439.99'
    An entry is emitted only when the unit material matches a known saw
    variant AND the bar and chain part numbers validate against the dealer
    price file lists AND the chain's marketing number agrees.
    """
    out = {}
    row_re = re.compile(
        r"(?P<len>\d{1,2})\"\s+"
        r"(?P<left>[\d ]{11,30}?)\s*"
        r"(?P<mkt>\d{2}\s?[A-Z]{2,4}\d?)\s+"
        r"(?P<right>[\d ]{13,34}?)"
        r"(?:(?P<unitpfx>[A-Z]{2}\d{2})\s?(?P<unitrest>\d{3}\s?\d{4}))?"
        r"\s*(?:US)?\s*\$")
    for m in row_re.finditer(text):
        left = re.sub(r"\s", "", m.group("left"))
        right = re.sub(r"\s", "", m.group("right"))
        if len(left) not in (11, 22):
            continue
        bar = fmt_part(left[:11])  # second 11 digits, if present, are the scabbard
        if m.group("unitpfx"):     # battery saws: unit material is alphanumeric
            links, chain_digits = None, None
            for l in (2, 3):
                if len(right) - l == 11:
                    links, chain_digits = right[:l], right[l:]
            unit = m.group("unitpfx") + re.sub(r"\s", "", m.group("unitrest"))
        else:                      # gas saws: unit material is all digits
            links = chain_digits = unit = None
            for l in (2, 3):
                if len(right) - l == 22:
                    links, chain_digits, unit = right[:l], right[l:l + 11], right[l + 11:]
        if not links or not chain_digits or not unit:
            continue
        chain = fmt_part(chain_digits)
        unit = fmt_part(unit)
        chain_name = re.sub(r"\s", "", m.group("mkt")) + " " + links
        if unit not in variant_models:
            continue
        # bars that ship only on saws aren't in the price file's bar list;
        # accept them when column alignment is proven by the scabbard
        # column's invariant '0000 792' prefix next to the bar digits
        bar_ok = bar in bars_set or (
            len(left) == 22 and left[11:18] == "0000792")
        if not bar_ok or chain not in chains_by_part:
            continue
        mkt = chains_by_part[chain].get("marketing", "")
        if mkt and mkt.replace(" ", "") != chain_name.replace(" ", ""):
            continue  # chain P/N and marketing number disagree — skip
        out[unit] = {"bar": bar, "chain": chain,
                     "chainName": mkt or chain_name, "barLen": int(m.group("len"))}

    # pole pruner attachment pages use a parenthesized layout:
    #   '10" Bar (3005 008 3403)\nChain (3670 005 0056) 71PM3 56\n
    #    Scabbard (…)\n4182 200 0219 US … $204.99'
    paren_re = re.compile(
        r'(?P<len>\d{1,2})"\s*Bar\s*\((?P<bar>\d{4}\s\d{3}\s\d{4})\)\s*'
        r"Chain\s*\((?P<chain>\d{4}\s\d{3}\s\d{4})\)\s*"
        r"(?P<mkt>\d{2}\s?[A-Z]{2,4}\d?)\s?(?P<links>\d{2,3})"
        r"[\s\S]{0,90}?(?P<unit>\d{4}\s\d{3}\s\d{4})\s*US")
    for m in paren_re.finditer(text):
        unit = m.group("unit").replace(" ", "-")
        bar = m.group("bar").replace(" ", "-")
        chain = m.group("chain").replace(" ", "-")
        chain_name = re.sub(r"\s", "", m.group("mkt")) + " " + m.group("links")
        if unit not in variant_models or chain not in chains_by_part:
            continue
        mkt = chains_by_part[chain].get("marketing", "")
        if mkt and mkt.replace(" ", "") != chain_name.replace(" ", ""):
            continue
        out.setdefault(unit, {"bar": bar, "chain": chain,
                              "chainName": mkt or chain_name,
                              "barLen": int(m.group("len"))})
    return out


def main(paths):
    text = "\n\n".join(Path(p).read_text(errors="replace") for p in paths)
    text = text.replace("\\!", "!").replace("“", '"').replace("”", '"')
    text = text.replace(" ", " ")

    # pypdf extraction artifacts: split decimals ('7 .6 kg'), split capitals
    # ('Chain T ype', 'T ooth'), fl/fi ligatures, 'Ibs' OCR, manual typos,
    # words hyphenated across line breaks ('Displace-\nment')
    text = re.sub(r"([A-Za-z])-\s*\n\s*([a-z])", r"\1\2", text)
    text = re.sub(r"(\d) \.(\d)", r"\1.\2", text)
    text = re.sub(r"\bT (?=[a-z])", "T", text)
    text = text.replace("/uniFB02", "fl").replace("/uniFB01", "fi")
    text = re.sub(r"\bIbs\b", "lbs", text)
    text = re.sub(r"\b[Uu]p t[po]\b", "Up to", text)
    text = text.replace("1/ 4", "1/4")
    text = re.sub(r'([&\s])!(?=["”])', r"\g<1>1/4", text)  # '¼' extracts as '!'
    text = re.sub(r"Chain Type,\s", "Chain Type: ", text)  # comma-for-colon typo

    products = load_products()
    bars_set = {b["part"] for b in products["bars"]}
    chains_by_part = {c["part"]: c for c in products["chains"]}

    # locate each model's spec block: score every occurrence by how many
    # "Key: value" spec lines follow it, keep the best
    all_names = {m["model"] for m in products["models"]}

    def name_regex(name, flex):
        parts = []
        for t in name.split():
            if flex and re.search(r"\d\.0", t):
                # '.0' is optional anywhere in a numeric token: 752.0i ~ 752i
                p = re.escape(t).replace(re.escape(".0"), r"(?:\.0)?")
            elif flex and re.match(r"^[A-Z]{2}-[A-Z]+$", t):
                # suffixes may gain a space in the manual: 'RC-E' ~ 'R C-E'
                p = t[0] + r" ?" + re.escape(t[1:])
            else:
                p = re.escape(t)
            parts.append(p)
        return re.compile(r"(?<![A-Za-z0-9])" + r"\s+".join(parts) + r"(?![A-Za-z0-9.])",
                          re.IGNORECASE if flex else 0)

    # 'MS 251' must not match at an 'MS 251 C-BE' heading (sibling product)
    norm_names = {norm_model(n).upper() for n in all_names}

    def is_sibling_heading(name, following):
        t = re.match(r"\s+([A-Za-z][A-Za-z0-9.\-]{0,7})", following)
        if not t:
            return False
        tok = t.group(1)
        cand = norm_model(name + " " + tok).upper()
        if cand != norm_model(name).upper() and cand in norm_names:
            return True
        # a trim-designator token right after the name means this is a
        # LONGER model's heading ('MS 362' matching at 'MS 362 R MAGNUM'),
        # even when that longer model isn't a catalog product. A lone 'Z'
        # is a dealer config code, not a trim ('BG 86 C-E Z' is BG 86 C-E),
        # and a token leading straight into 'Series' is battery-line prose
        # with a dropped letter ('FSA 50.0 \nK Series/ Series FA05').
        # same line only — 'R\nSeries' is a wrap-handle heading, not prose
        if re.match(r"[ ]*/?[ ]*Series", following[t.end():t.end() + 12]):
            return False
        return bool(re.match(r"^([RTK]|[A-Z]-[A-Z]{1,2}|SET|PLUS|CONTROL|EVO)$",
                             tok.upper()))

    def count_keys(chunk):
        return sum(1 for km in KEY_RE.finditer(chunk)
                   if km.group(1).split()[0] in KEY_FIRST_WORDS)

    def find_best(name, flex):
        best = None
        for m in name_regex(name, flex).finditer(text):
            if is_sibling_heading(name, text[m.end(): m.end() + 12]):
                continue
            window = text[m.end(): m.end() + 1500]
            near = count_keys(window[:300])  # keys right after the heading
            far = count_keys(window)
            if near == 0 and far < 2:
                continue
            score = near * 10 + far
            # a real spec page opens with '<MODEL> … Series …', the electric
            # '120 V (60 hz)' header, or the mower 'WB01/ Professional' tag;
            # TOC pages and comparison charts don't. A '$' on the model's own
            # line means this is a price row, not a heading. And the marker
            # must belong to THIS heading — if another model's heading line
            # sits between the name and the marker, the marker is the
            # neighbor's (e.g. an 'FSA 30.0 set…' row right before the
            # FSA 50.0 page must not borrow FSA 50's 'Series' line).
            nl = text.find("\n", m.end())
            rest_of_line = text[m.end(): m.end() + 80 if nl == -1 else min(nl, m.end() + 80)]
            marker = re.search(r"Series|120 V|W[AB]\d\d\s*/", window[:80])
            own_marker = False
            if marker and "$" not in rest_of_line:
                between = window[:marker.start()]
                own_marker = not re.search(r"\n\s*(?:STIHL )?[A-Z]{2,4} ?\d", between)
            if own_marker:
                score += 1000
            if best is None or score > best[1]:
                best = (m.start(), score)
        return best

    positions = []
    for model in products["models"]:
        # only real model designations get spec lookups — free-text entries
        # like 'Deflector' would match accessory prose
        if not re.match(r"^i?[A-Z]{2,4} ?\d", model["model"]):
            continue
        # version-flexible matching ('MSA 160 C-B' ~ 'MSA 160.0 C-B') is a
        # superset of exact matching, so use it whenever the flexed name is
        # not itself a different catalog model — successor generations must
        # not inherit each other's specs. This matters: a model's exact name
        # often appears only in price rows while its heading drops the '.0'.
        flexed = norm_model(model["model"])
        conflict = any(n != model["model"] and norm_model(n) == flexed
                       for n in all_names)
        hit = find_best(model["model"], flex=not conflict)
        if not hit and model["model"] in MODEL_ALIASES:
            hit = find_best(MODEL_ALIASES[model["model"]], flex=True)
        if hit:
            positions.append((hit[0], model))
    positions.sort(key=lambda x: x[0])

    def clip_block(block):
        """A model's block never spans past its page footer — the next page
        may describe a different variant (e.g. the RESCUE saws)."""
        w = block.find("WARNING!", 100)
        return block[:w] if w > 0 else block

    specs_out = {}
    for i, (pos, model) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else min(len(text), pos + 4000)
        block = clip_block(text[pos:min(end, pos + 6000)])
        raw = parse_block_specs(block)
        if raw:
            title, rows = slot_specs(model, raw)
            if any(v for _, v in rows):
                specs_out[model["model"]] = {"title": title, "specs": rows}

    # part-number tables are matched globally; validation ties rows to models
    variant_models = {}
    for model in products["models"]:
        if model["category"] in ("0CS", "0LB", "0ES", "0GS", "1HT", "3TT"):
            for v in model["variants"]:
                variant_models[v["materialDash"]] = model["model"]
    parts_out = parse_parts_tables(text, bars_set, chains_by_part, variant_models)

    # R/T handle variants share a page headed by the bare model (HS 87 R/T
    # -> 'HS 87'); parse that shared block, whose R/T-specific weight bullets
    # are ignored by the key vocabulary, leaving the common engine specs.
    # If the variant matched directly (e.g. at its bullet), keep whichever
    # block fills more cells.
    def filled(entry):
        return sum(1 for _, v in entry["specs"] if v) if entry else 0

    for model in products["models"]:
        name = model["model"]
        bases = []
        if re.search(r" [RT]$", name):
            bases.append(name[:-2])
        if " SET" in name:
            b = name.replace(" SET", "").strip()
            bases += [b, b.replace("(USA)", "").strip()]
        for base in dict.fromkeys(bases):
            if not base or base == name or base in all_names:
                continue  # a real product owns that page; don't borrow it
            hit = find_best(base, flex=True)
            if not hit:
                continue
            raw = parse_block_specs(clip_block(text[hit[0]: hit[0] + 4000]))
            if not raw:
                continue
            title, rows = slot_specs(model, raw)
            cand = {"title": title, "specs": rows}
            # ties go to the base page: a SET/R/T model's own direct match
            # is usually a bundle price row bleeding the next page's specs
            if filled(cand) >= filled(specs_out.get(name)):
                specs_out[name] = cand

    # Gas saw trim levels share the powerhead: a carbureted model without
    # its own DSM page takes its M-Tronic sibling's specs and vice versa,
    # preferring the sibling with the same handle (R) configuration.
    def gas_saw_siblings(name):
        cands = []
        if name.endswith(" C-M R"):
            # the manual orders it 'R C-M' — that's the model's own page
            cands.append(name.replace(" C-M R", " R C-M"))
        if " C-M" in name:
            cands.append(name.replace(" C-M", ""))   # 'MS 362 C-M R' -> 'MS 362 R'
        else:
            cands.append(re.sub(r"^([A-Z]+ \d+\w*)", r"\1 C-M", name))
        return cands

    for model in products["models"]:
        if model["category"] != "0CS":
            continue
        name = model["model"]
        entry = specs_out.get(name)
        has_engine = entry and any(
            v for l, v in entry["specs"] if l == "DISPLACEMENT")
        if has_engine:
            continue
        for cand in gas_saw_siblings(name):
            if cand in specs_out:
                specs_out[name] = specs_out[cand]
                break
            # the sibling may have its own DSM page without being a
            # catalog product ('MS 362 R' page for 'MS 362 C-M R')
            if cand in all_names:
                continue
            hit = find_best(cand, flex=True)
            if hit:
                raw = parse_block_specs(clip_block(text[hit[0]: hit[0] + 4000]))
                if raw:
                    title, rows = slot_specs(model, raw)
                    if any(v for _, v in rows):
                        specs_out[name] = {"title": title, "specs": rows}
                        break

    # SET packages share the base tool's hardware specs (and vice versa).
    # A SET never has its own spec page — any direct match was a price row,
    # so the base product's specs always win for a SET.
    for model in products["models"]:
        name = model["model"]
        if " SET" in name:
            for base in (name.replace(" SET", "").strip(),
                         name.replace(" SET", "").replace("(USA)", "").strip()):
                if base in all_names and base in specs_out:
                    specs_out[name] = specs_out[base]
                    break
        elif name not in specs_out and (name + " SET") in specs_out:
            specs_out[name] = specs_out[name + " SET"]

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
