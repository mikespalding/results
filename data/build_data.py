#!/usr/bin/env python3
"""Build refreshed DATA blob for acq_newhire_dashboard.html.

Strategy:
- Load prior DATA from HTML for existing reps' historical RTS data (Zoom/Five9
  hours by week — these don't change in retrospect for active weeks).
- Load roster from data/roster.tsv (filtered to acquisition new hires).
- Load refreshed deals data (contracts, marketing, pos_spread, assignments,
  assignment_fees) from TSVs.
- Use RTS data extracted from user pastes for NEW weeks (week 4/20/2026 mostly,
  and full RTS history for the 4/7/2026 cohort).
- Recompute rts_tier per ramp-week thresholds.
- Output the new DATA dict as JSON.
"""

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path("/home/user/results")
DATA = ROOT / "data"
HTML = ROOT / "acq_newhire_dashboard.html"

GENERATED_DATE = "4/25/2026"


# ───────────────────────────────────────────────────────── helpers
def parse_date(s):
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"bad date: {s!r}")


def fmt_date(d):
    return f"{d.month}/{d.day}/{d.year}"


def monday_of(d):
    """Return the Monday of the ISO week containing date d."""
    return d - timedelta(days=d.weekday())


def week_num(hire_date, week_start):
    """1-indexed week number: hire week = 1."""
    hire_monday = monday_of(hire_date)
    return ((week_start - hire_monday).days // 7) + 1


def compute_tier(wn, rts_hrs):
    """Compute RTS tier from week_num and total rts hours."""
    if wn == 1:
        return "n/a"
    if wn == 2:
        if rts_hrs < 12: return "below"
        if rts_hrs < 20: return "minimum"
        if rts_hrs < 25: return "target"
        return "expert"
    if wn == 3:
        if rts_hrs < 20: return "below"
        if rts_hrs < 23: return "minimum"
        if rts_hrs < 25: return "target"
        return "expert"
    if wn == 4:
        if rts_hrs < 22: return "below"
        if rts_hrs < 25: return "minimum"
        if rts_hrs < 30: return "target"
        return "expert"
    # week 5+
    if rts_hrs < 25: return "below"
    if rts_hrs < 30: return "minimum"
    if rts_hrs < 35: return "target"
    return "expert"


def exit_stage(weeks_to_exit):
    if weeks_to_exit < 1: return "<1 wk"
    if weeks_to_exit < 2: return "1–2 wks"
    if weeks_to_exit < 4: return "2–4 wks"
    if weeks_to_exit < 6: return "4–6 wks"
    if weeks_to_exit < 8: return "6–8 wks"
    return "8–12 wks"


# ───────────────────────────────────────────────────────── load roster
def load_roster():
    reps = []
    with open(DATA / "roster.tsv") as f:
        header = f.readline().rstrip("\n").split("\t")
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < len(header): cols += [""] * (len(header) - len(cols))
            row = dict(zip(header, cols))
            hire = parse_date(row["Hire Date"])
            exit_d = parse_date(row["Exit Date"]) if row["Exit Date"].strip() else None
            wte = (exit_d - hire).days / 7.0 if exit_d else None
            reps.append({
                "name": row["Employee Name"].strip(),
                "manager": row["Current Manager"].strip(),
                "hire_date": fmt_date(hire),
                "_hire": hire,
                "cohort": fmt_date(hire),
                "status": row["Status"].strip(),
                "exit_date": fmt_date(exit_d) if exit_d else "",
                "_exit": exit_d,
                "weeks_to_exit": round(wte, 1) if wte is not None else None,
                "email": row["Email Address"].strip().lower(),
            })
    return reps


# ───────────────────────────────────────────────────────── re_exp from prior data
def load_prior_re_exp():
    """Pull re_exp ('RE' or 'Non') from existing HTML DATA where available."""
    txt = HTML.read_text()
    idx = txt.find("const DATA = ")
    prior, _ = json.JSONDecoder().raw_decode(txt[idx + len("const DATA = "):])
    return {r["name"]: r.get("re_exp", "Non") for r in prior["reps"]}, prior


# ───────────────────────────────────────────────────────── load refreshed deal feeds
def parse_count_tsv(path, cols=("count", "week", "name")):
    """Generic loader for a TSV with count, M/D/YY week, and Name."""
    out = defaultdict(dict)  # name -> {week_monday_str -> count}
    with open(path) as f:
        f.readline()  # header
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3: continue
            try:
                n = float(parts[0]) if "." in parts[0] else int(parts[0])
            except ValueError:
                continue
            wk = parse_date(parts[1])
            name = parts[2].strip()
            wkey = fmt_date(monday_of(wk))
            out[name][wkey] = n
    return out


def load_deal_feeds():
    contracts = parse_count_tsv(DATA / "contracts.tsv")
    marketing = parse_count_tsv(DATA / "marketing.tsv")
    pos_spread = parse_pos_spread(DATA / "pos_spread.tsv")
    assignments = parse_count_tsv(DATA / "assignments.tsv")
    fees = parse_fees(DATA / "assignment_fees.tsv")
    return contracts, marketing, pos_spread, assignments, fees


def parse_pos_spread(path):
    out = defaultdict(dict)
    with open(path) as f:
        f.readline()
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3: continue
            wk = parse_date(parts[0])
            name = parts[1].strip()
            try:
                cnt = int(parts[2])
            except ValueError:
                continue
            wkey = fmt_date(monday_of(wk))
            out[name][wkey] = cnt
    return out


def parse_fees(path):
    out = defaultdict(dict)
    with open(path) as f:
        f.readline()
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3: continue
            try:
                amt = float(parts[0].replace(",", ""))
            except ValueError:
                continue
            wk = parse_date(parts[1])
            name = parts[2].strip()
            wkey = fmt_date(monday_of(wk))
            out[name][wkey] = amt
    return out


# ───────────────────────────────────────────────────────── RTS hours per (rep, week)
# Aggregated from user's Zoom + Five9 pastes for NEW weeks.
# Format: {rep_name: {week_start_mm_dd_yyyy: (zoom_hrs, five9_hrs)}}

# Prior dashboard data (for existing reps' historical weeks) provides RTS for
# weeks already recorded. For NEW weeks (4/20/2026 across all reps, plus 4/7
# cohort full history), we use values extracted from the user's Zoom and Five9
# pastes. Below are extracted per-rep weekly aggregates.

# Week 4/20/2026 = ISO week 17 in user's data (covers 4/20-4/26)
# These aggregates are sums of Zoom call duration minutes / 60 + Five9 Avail Time hours.

NEW_WEEK_RTS = {
    # Cohort 1/12 — Selena Ziman (exited 3/2), Chasity Clark (exited 3/24): no new weeks
    # Cohort 2/9 — week 11 (4/20):
    "Kevin Scott": {"4/20/2026": (3.55, 13.12)},  # Zoom 213m / Five9 sum
    "Debran Collins": {"4/20/2026": (1.83, 24.50)},
    "Tony Riska": {"4/20/2026": (4.93, 23.95)},
    "Gerardo Macias": {"4/20/2026": (3.08, 21.40)},
    "Michael Purcell": {"4/20/2026": (4.52, 22.03)},
    # 2/9 cohort exits already handled (Avery, Traci-Ayn, Brad, Wyatt, Tanner, Tivia, Chris Roberts) — no week 11
    # Cohort 3/9 — week 7 (4/20):
    "EJ Colclough": {"4/20/2026": (5.33, 21.00)},
    "Chloe Rodman": {"4/20/2026": (1.65, 26.00)},
    "Eric Loya": {"4/20/2026": (3.42, 26.00)},
    # 3/9 exits: Robby (3/23), Jessica (3/16), Matthew (3/16), Kelly (3/12), Jeffrey (4/1), Ben (4/13), Ted (4/17), Irma (4/17), Zach (4/23)
    # Zach Brodsky exited 4/23 — has partial week 7
    "Zach Brodsky": {"4/20/2026": (0.10, 31.10)},
    # Cohort 4/7 — weeks 1, 2, 3:
    "John Kinney": {
        "4/7/2026": (0.05, 0.90),
        "4/13/2026": (1.30, 21.93),
        "4/20/2026": (1.07, 24.93),
    },
    "Cierra Lynch": {
        "4/7/2026": (0.0, 0.0),
        "4/13/2026": (0.87, 16.65),
        "4/20/2026": (0.10, 19.45),
    },
    "Michael Johnson": {
        "4/7/2026": (0.28, 1.20),
        "4/13/2026": (0.47, 14.93),
        "4/20/2026": (0.93, 25.45),
    },
    "Andrew Bentley": {  # exited 4/21
        "4/7/2026": (0.0, 0.20),
        "4/13/2026": (0.55, 11.73),
        "4/20/2026": (0.0, 5.40),
    },
    "Justin Halladay": {
        "4/7/2026": (0.0, 1.43),
        "4/13/2026": (0.22, 14.50),
        "4/20/2026": (1.92, 19.85),
    },
    "Justin Fairbanks": {
        "4/7/2026": (0.0, 1.52),
        "4/13/2026": (0.55, 13.65),
        "4/20/2026": (1.40, 24.32),
    },
    "Joy Jones": {
        "4/7/2026": (0.0, 1.62),
        "4/13/2026": (0.40, 9.78),
        "4/20/2026": (3.43, 23.20),
    },
    "Nat Dorsey": {
        "4/7/2026": (0.0, 1.50),
        "4/13/2026": (0.45, 17.07),
        "4/20/2026": (1.70, 24.12),
    },
}


# ───────────────────────────────────────────────────────── build per-rep week records
def build_rep_weeks(rep, prior_rep, deals):
    """Return list of week records for this rep."""
    contracts, marketing, pos_spread, assignments, fees = deals
    name = rep["name"]
    hire = rep["_hire"]
    last_active = rep["_exit"] if rep["_exit"] else parse_date(GENERATED_DATE)

    # Determine number of weeks to render
    last_monday = monday_of(last_active)
    # If exit is mid-week, include that week. If still active and as-of is mid-week,
    # only include weeks fully completed before generated date.
    if not rep["_exit"]:
        # active rep — include weeks up to most-recent completed Monday
        cutoff = monday_of(parse_date(GENERATED_DATE))
        if cutoff > last_monday:
            last_monday = cutoff
        # but also don't include current week if generated date is before its Sunday
        # GENERATED_DATE = 4/25/2026 (Saturday), so week 4/20 is in progress
        # We DO include in-progress weeks (per prior dashboard convention where
        # generated 4/14 included week 4/13)
    weeks = []
    wn = 0
    cur = monday_of(hire)
    while cur <= last_monday:
        wn += 1
        wk_str = fmt_date(cur)
        weeks.append({"week": wk_str, "week_num": wn, "_monday": cur})
        cur += timedelta(days=7)

    # Index prior rep's RTS data by week_str
    prior_by_wk = {w["week"]: w for w in prior_rep["weeks"]} if prior_rep else {}

    # Index NEW_WEEK_RTS for this rep
    new_rts = NEW_WEEK_RTS.get(name, {})

    cum_pos = 0
    out = []
    for w in weeks:
        wk_str = w["week"]
        # RTS hours: prefer prior data, else NEW_WEEK_RTS, else 0
        if wk_str in prior_by_wk:
            zoom_hrs = prior_by_wk[wk_str].get("zoom_hrs", 0.0)
            five9_hrs = prior_by_wk[wk_str].get("five9_hrs", 0.0)
        elif wk_str in new_rts:
            zoom_hrs, five9_hrs = new_rts[wk_str]
        else:
            zoom_hrs, five9_hrs = 0.0, 0.0
        rts_hrs = round(zoom_hrs + five9_hrs, 2)

        # Deal data — refresh from TSVs
        c = contracts.get(name, {}).get(wk_str, 0)
        m = marketing.get(name, {}).get(wk_str, 0)
        ps = pos_spread.get(name, {}).get(wk_str)
        if ps is None:
            # Try title-case variant (e.g. "Ej Colclough" vs "EJ Colclough")
            for variant in [name.title(), name.replace("EJ", "Ej"), name.replace("Mcneill", "McNeill")]:
                if variant in pos_spread and wk_str in pos_spread[variant]:
                    ps = pos_spread[variant][wk_str]
                    break
        a = assignments.get(name, {}).get(wk_str, 0)
        af = fees.get(name, {}).get(wk_str, 0.0)

        # Tier
        tier = compute_tier(w["week_num"], rts_hrs)

        # cum_pos_spread: start cumsum from week 1; null until first reported value
        if ps is not None:
            cum_pos += ps
            cps = cum_pos
        else:
            # only show null for very early weeks before any data
            cps = cum_pos if cum_pos > 0 else None

        out.append({
            "week": wk_str,
            "week_num": w["week_num"],
            "rts_hrs": rts_hrs,
            "zoom_hrs": round(zoom_hrs, 2),
            "five9_hrs": round(five9_hrs, 2),
            "contracts": int(c),
            "contracts_to_mktg": int(m),
            "pos_spread_deals": int(ps) if ps is not None else None,
            "assignments": int(a),
            "assignment_fees": float(af),
            "rts_tier": tier,
            "cum_pos_spread": cps,
        })
    return out


# ───────────────────────────────────────────────────────── main
def main():
    re_exp_map, prior = load_prior_re_exp()
    prior_by_name = {r["name"]: r for r in prior["reps"]}

    # also map "Jeffery Linn" → "Jeffrey Linn" since spelling was fixed
    if "Jeffery Linn" in prior_by_name and "Jeffrey Linn" not in prior_by_name:
        prior_by_name["Jeffrey Linn"] = prior_by_name["Jeffery Linn"]
        re_exp_map["Jeffrey Linn"] = re_exp_map.get("Jeffery Linn", "RE")

    reps = load_roster()
    deals = load_deal_feeds()

    out_reps = []
    for r in reps:
        prior_rep = prior_by_name.get(r["name"])
        weeks = build_rep_weeks(r, prior_rep, deals)
        out_reps.append({
            "name": r["name"],
            "cohort": r["cohort"],
            "hire_date": r["hire_date"],
            "status": r["status"],
            "exit_date": r["exit_date"],
            "weeks_to_exit": r["weeks_to_exit"],
            "manager": r["manager"],
            "weeks": weeks,
            "re_exp": re_exp_map.get(r["name"], "Non"),
        })

    # Build attrition rollup
    attrition = []
    for r in out_reps:
        if r["status"] == "Exited":
            attrition.append({
                "name": r["name"],
                "cohort": r["cohort"],
                "weeks_to_exit": r["weeks_to_exit"],
                "exit_stage": exit_stage(r["weeks_to_exit"]),
                "manager": r["manager"],
                "exit_date": r["exit_date"],
                "re_exp": r["re_exp"],
            })
    # Sort attrition: by cohort then exit date
    attrition.sort(key=lambda x: (parse_date(x["cohort"]), parse_date(x["exit_date"])))

    total = len(out_reps)
    active = sum(1 for r in out_reps if r["status"] == "Active")
    exited = total - active

    DATA_OUT = {
        "reps": out_reps,
        "attrition": attrition,
        "generated": GENERATED_DATE,
        "total_reps": total,
        "active": active,
        "exited": exited,
    }
    # Sort reps alphabetically (matches prior dashboard order)
    DATA_OUT["reps"].sort(key=lambda r: r["name"])

    # Strip private fields used internally
    out_path = DATA / "DATA.json"
    out_path.write_text(json.dumps(DATA_OUT, separators=(", ", ": ")))
    print(f"Wrote {out_path}: {total} reps ({active} active, {exited} exited), "
          f"{len(attrition)} attrition records")
    print(f"\nReps:")
    for r in DATA_OUT["reps"]:
        last = r["weeks"][-1]
        print(f"  {r['name']:<25} {r['status']:<7} cohort={r['cohort']:<10} "
              f"weeks={len(r['weeks']):2d}  last RTS={last['rts_hrs']:5.2f}h ({last['rts_tier']})")


if __name__ == "__main__":
    main()
