#!/usr/bin/env python3
"""Extract the saw -> bar/chain fitment matrix from the STIHL Bar & Chain
Catalog ("Guide Bar & Saw Chain Selection Guide for STIHL Products").

Usage: python3 parse_catalog.py <catalog_text.txt> [...]

Output: sign-shop/data/catalog_fitment.js
  window.SIGN_CATALOG = {
    "<model>": [ {bar, pitch, gauge, dl, barPart,
                  chains: [{name, part, sku}...]}, ... ], ... }

Chains are emitted only when they match a loop in the current dealer price
file (so everything shown is orderable today); the marketing name is
normalized to the price file's spelling. Guide bar part numbers come
verbatim from the catalog.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# Newer pages put a 'Chain sprockets' block between the model heading and
# its guide-bar table, so both act as section markers; a marker without a
# model heading continues the previous model's section.
SECTION_RE = re.compile(
    r"((?:[^\n]{0,130}\n){1,8})"
    r"((?:Optional|Common) STIHL Guide Bars|Chain sprockets"
    r"|Guide bars Saw chains)")  # oldest pages use the bare table header

# legacy numeric saw designations (pre-'MS' era) — anything else numeric on
# a heading line is a page number
LEGACY_MODELS = {
    "009", "010", "011", "012", "015", "017", "018", "019", "020", "021",
    "023", "024", "025", "026", "028", "029", "030", "031", "032", "034",
    "036", "038", "041", "042", "044", "045", "046", "048", "056", "064",
    "065", "066", "075", "076", "084", "088", "090",
}
MODEL_TOKEN_RE = re.compile(
    r"\b(MS[AE]? ?\d{2,3}(?:\.\d)?i?(?: ?[CT]{1,2}(?:-[A-Z]{1,3})?)?(?: R\b| [A-Z]\b| C-[A-Z]{1,3})?"
    r"|HTA? ?\d{2,3}(?:\.\d)?|GS ?\d{3}|GTA ?\d{2}|E ?\d{2,3}|\d{3}(?: ?AV[EQW]*)?)\b")
ROW_RE = re.compile(
    r"(?:(?P<len>\d{1,2})\s+)?"
    r"(?P<pitch>(?:1/4|\.325|3/8)\"?P?|\.404\"?)\s+"
    r"(?P<gauge>\.0\d{2})\s+"
    r"(?P<dl>\d{2,3})\s+"
    r"O?\s*(?P<bar>\d{4} \d{3} \d{4})"
    r"(?P<cells>(?:\s+(?:—|\d{2} ?[A-Z]{2,3}\d? \d{2,3}))+)")
CHAIN_TOKEN_RE = re.compile(r"\d{2} ?[A-Z]{2,3}\d? \d{2,3}")

# text between these markers is the STIHL-products selection guide
START_MARK = "SELECTION GUIDE"
COMPETITOR_MARK = "COMPETITOR"


def load_products():
    raw = (ROOT / "data" / "products.js").read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


def load_dsm_parts():
    raw = (ROOT / "data" / "dsm_parts.js").read_text()
    return json.loads(re.search(r"= (.*);", raw, re.S).group(1))


# chain family first digit -> pitch (STIHL numbering)
PITCH_BY_DIGIT = {"1": '1/4"', "2": '.325"', "3": '3/8"', "4": '.404"',
                  "6": '3/8P"', "7": '1/4P"'}


def model_base(name):
    """'MS 271 C-M R' / 'MS 271 C' -> 'MS 271' (brand + number)."""
    m = re.match(r"(i?[A-Z]{2,4} ?\d{2,3}(?:\.\d)?i?)", name)
    return m.group(1) if m else name


def norm_chain(name):
    return re.sub(r"\s+", "", name).upper()


def models_in_heading(chunk):
    """All saw model names in the 1-4 lines preceding a fitment table."""
    found = []
    for line in chunk.splitlines():
        line = line.replace("®", "").replace("™", "").strip(" *")
        # page footers glue onto headings: '176MS 440' -> 'MS 440'
        line = re.sub(r"^\d{1,3}(?=[A-Z])", "", line)
        low = line.lower()
        if not line or "guide bar" in low or "cutting length" in low or "saw chain" in low:
            continue
        for tok in MODEL_TOKEN_RE.findall(line):
            name = re.sub(r"\s{2,}", " ", tok.strip())
            if re.fullmatch(r"\d{3}(?: ?AV[EQW]*)?", name):
                if name.split()[0] not in LEGACY_MODELS:
                    continue  # page number, not a legacy model
            if name not in found:
                found.append(name)
    return found


def main(paths):
    text = "\n\n".join(Path(p).read_text(errors="replace") for p in paths)
    # pdf kerning splits digits: '23 RM3 7 4' (drive links), '3005 000 7 405'
    # and '3695 005 007 4' (part numbers), '.0 43' (gauge). Rejoin only those
    # exact shapes so real tokens ('4 1/4"' bars, '3317 23 RM3') survive.
    text = re.sub(r"\.0 (\d\d)\b", r".0\1", text)
    text = re.sub(r"(?<=[ ])(\d) (\d)(?=[ \n]|$)", r"\1\2", text)
    text = re.sub(r"\b(\d) (\d{3})\b", r"\1\2", text)
    text = re.sub(r"\b(\d{3}) (\d)\b(?![./])", r"\1\2", text)
    # adjacent chain cells also fuse: '36 RM3 7236 RS3 72' is drive-link 72
    # then the next cell's family 36 — split the blob before 'NN <family>'
    text = re.sub(r"(\d{2,3})(?=\d{2} ?[A-Z]{2,3}\d? \d)", r"\1 ", text)
    text = text.replace("/uniFB00", "ff").replace("/uniFB01", "fi").replace("/uniFB02", "fl")

    products = load_products()
    chain_by_marketing = {}
    for c in products["chains"]:
        if c.get("marketing"):
            chain_by_marketing[norm_chain(c["marketing"])] = c

    fitment = {}
    sections = list(SECTION_RE.finditer(text))
    dropped = 0
    current_models = []
    for i, m in enumerate(sections):
        models = models_in_heading(m.group(1))
        if models:
            current_models = models
        else:
            dropped += 1
        if "Chain sprockets" in m.group(2):
            continue  # rows live in the guide-bar table that follows
        if not current_models:
            continue
        models = current_models
        end = sections[i + 1].start() if i + 1 < len(sections) else min(len(text), m.end() + 6000)
        block = text[m.end(): end]
        cut = block.find(COMPETITOR_MARK)
        if cut > 0:
            block = block[:cut]
        rows = []
        cur_len = None
        for rm in ROW_RE.finditer(block):
            if rm.group("len"):
                cur_len = int(rm.group("len"))
            if cur_len is None or not (4 <= cur_len <= 60):
                continue
            pitch = rm.group("pitch").replace('"', "") + '"'
            dl = int(rm.group("dl"))
            chains = []
            seen = set()
            for tok in CHAIN_TOKEN_RE.findall(rm.group("cells")):
                meta = chain_by_marketing.get(norm_chain(tok))
                if not meta or meta["part"] in seen:
                    continue
                # a chain's own numbering must agree with the row: first
                # digit encodes pitch (misprinted cells bleed in from
                # adjacent tables, e.g. '26 RS 67' inside a 3/8" row)
                if PITCH_BY_DIGIT.get(meta["marketing"][0]) != pitch:
                    continue
                seen.add(meta["part"])
                chains.append({"name": meta["marketing"], "part": meta["part"],
                               "sku": meta.get("aceSku", "")})
            # ... and its trailing number is the drive-link count. When every
            # chain agrees on a different count the row's DL cell is the
            # misprint (MSE 220 prints cutting lengths there); otherwise the
            # odd chain out is.
            dls = {int(c["name"].split()[-1]) for c in chains
                   if c["name"].split()[-1].isdigit()}
            if len(dls) == 1 and dl not in dls:
                dl = dls.pop()
            else:
                chains = [c for c in chains
                          if not c["name"].split()[-1].isdigit()
                          or int(c["name"].split()[-1]) == dl]
            rows.append({
                "bar": cur_len,
                "pitch": pitch,
                "gauge": rm.group("gauge"),
                "dl": dl,
                "barPart": rm.group("bar").replace(" ", "-"),
                "chains": chains,
            })
        if not rows:
            continue
        for model in models:
            fitment.setdefault(model, []).extend(rows)

    # The catalog prints shared pages for saw groups (e.g. MS 271/291 with
    # MS 290); flat text extraction can't attribute per-model applicability
    # dots, so a model can inherit its page-mates' rows in another pitch.
    # For current models the factory chain pitch (verified DSM data) gates
    # which pitches are real for that saw.
    parts = load_dsm_parts()
    variant_model = {}
    for pm in products["models"]:
        for v in pm["variants"]:
            variant_model[v["materialDash"]] = model_base(pm["model"])
    factory_pitch = {}
    for mat, p in parts.items():
        base = variant_model.get(mat)
        if base:
            pitch = PITCH_BY_DIGIT.get(p["chainName"][0])
            if pitch:
                factory_pitch.setdefault(base, set()).add(pitch)
    gated = 0
    for model, rows in list(fitment.items()):
        allowed = factory_pitch.get(model_base(model))
        if not allowed:
            continue
        kept = [r for r in rows if r["pitch"] in allowed]
        gated += len(rows) - len(kept)
        fitment[model] = kept

    # modern sections contain the bare header inside the Optional/Common
    # block, which double-parses them — dedupe per model
    for model, rows in fitment.items():
        seen, unique = set(), []
        for r in rows:
            key = (r["bar"], r["pitch"], r["gauge"], r["dl"], r["barPart"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
        fitment[model] = sorted(unique, key=lambda r: (r["bar"], r["pitch"], r["dl"]))

    n_rows = sum(len(v) for v in fitment.values())
    n_chains = sum(len(r["chains"]) for v in fitment.values() for r in v)
    (ROOT / "data" / "catalog_fitment.js").write_text(
        "// Generated by tools/parse_catalog.py from the STIHL Bar & Chain\n"
        "// Catalog selection guide. Chains limited to loops orderable in the\n"
        "// current dealer price file.\n"
        "window.SIGN_CATALOG = " + json.dumps(fitment, indent=1) + ";\n")
    print(f"models: {len(fitment)}  bar rows: {n_rows}  chain options: {n_chains}"
          f"  (headings skipped: {dropped}; rows pitch-gated: {gated})")
    print("models:", ", ".join(sorted(fitment)[:200]))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
