"""Runs every shot in shots.json through pooltool and writes sampled trajectories in the app frame.

Setup (once):  python -m venv tmp/.venv-pooltool
               tmp/.venv-pooltool/Scripts/python -m pip install -r scripts/engine-compare/requirements.txt
Usage:         tmp/.venv-pooltool/Scripts/python scripts/engine-compare/run_pooltool.py [--cushion han|stronge] [out]
               --cushion: pooltool ball-cushion model (default han = Han 2005, same model as the app;
               stronge = pooltool 0.6.0 default, Stronge compliant omega_ratio 1.8)

Frames
  app:      x along the long rail (0..W), y across (0..H), z DOWN, mm.
  pooltool: x across (0..w), y along the long rail (0..l), z UP, m.
  position  pt = ((H - uy), ux) / 1000          (rotation +90 deg, then translate)
  velocity  pt = (-vy, vx) / 1000
  spin      pt = (wy, -wx, wz)                  (pseudovector under rotation + z flip, det = -1)
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pooltool as pt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SPEC = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
ARGS = sys.argv[1:]
CUSHION = "han"
if "--cushion" in ARGS:
    i = ARGS.index("--cushion")
    CUSHION = ARGS[i + 1]
    del ARGS[i : i + 2]
OUT = Path(ARGS[0]) if ARGS else ROOT / "tmp" / "engine-compare" / "pooltool.json"
APP = json.loads((ROOT / "tmp" / "engine-compare" / "js.json").read_text(encoding="utf-8"))
TP = APP["table"]  # app table profile, written by run-js.mjs
W, H = TP["W"], TP["H"]
R = APP["R"]


def to_pt_pos(x, y):
    return ((H - y) / 1000.0, x / 1000.0)


def to_app_pos(px, py):
    return (py * 1000.0, H - px * 1000.0)


def cue_state(c):
    """Same cue-ball state as run-js.mjs cueState(), converted to the pooltool frame."""
    a = math.radians(c["angleDeg"])
    vx, vy = c["speed"] * math.cos(a), c["speed"] * math.sin(a)
    wx, wy, wz = c["topspin"] * vy / R, -c["topspin"] * vx / R, -c["side"] / R
    v = np.array([-vy, vx, 0.0]) / 1000.0
    w = np.array([wy, -wx, wz])
    return v, w


def make_table():
    specs = pt.objects.PocketTableSpecs(
        l=W / 1000.0,
        w=H / 1000.0,
        corner_pocket_width=TP["cornerMouth"] / 1000.0,
        side_pocket_width=TP["sideMouth"] / 1000.0,
    )
    return pt.Table.from_table_specs(specs)


def make_params():
    """pooltool BallParams matched to the app table profile (u_b, u_sp: pooltool defaults)."""
    return dict(
        R=R / 1000.0,
        u_s=TP["muSlide"],
        u_r=TP["muRoll"],
        e_c=TP["cushionRestitution"],
        f_c=TP["cushionSpinTransfer"],
        e_b=0.95,  # app E_BALL
        g=9.81,
    )


def make_engine():
    from pooltool.physics.engine import PhysicsEngine
    from pooltool.physics.resolve.resolver import default_resolver

    resolver = default_resolver()
    if CUSHION == "han":
        from pooltool.physics.resolve.ball_cushion.han_2005.model import Han2005Circular, Han2005Linear

        resolver.ball_linear_cushion = Han2005Linear()
        resolver.ball_circular_cushion = Han2005Circular()
    elif CUSHION != "stronge":
        raise SystemExit(f"unknown --cushion {CUSHION!r} (han | stronge)")
    return PhysicsEngine(resolver=resolver)


def run_shot(shot):
    table = make_table()
    params = make_params()
    balls = {}
    for b in shot["balls"]:
        bid = "cue" if b["id"] == 0 else str(b["id"])
        balls[bid] = pt.Ball.create(bid, xy=to_pt_pos(b["x"], b["y"]), **params)
    v, w = cue_state(shot["cue"])
    cue_ball = balls["cue"]
    cue_ball.state.rvw[1] = v
    cue_ball.state.rvw[2] = w
    cue_ball.state.s = pt.constants.sliding
    # V0 = 0: no stick-ball event, the cue ball starts from the state set above
    system = pt.System(cue=pt.Cue(cue_ball_id="cue", V0=0.0), table=table, balls=balls)
    pt.simulate(system, engine=make_engine(), inplace=True, continuous=True, dt=SPEC["sampleDt"], max_events=2000)

    ids = [b["id"] for b in shot["balls"]]
    hist = {}
    for b in shot["balls"]:
        bid = "cue" if b["id"] == 0 else str(b["id"])
        rvw, s, t = system.balls[bid].history_cts.vectorize()
        hist[b["id"]] = (rvw, s, t)

    t_all = sorted({round(float(x), 4) for i in ids for x in hist[i][2]})
    samples = []
    for tt in t_all:
        row = []
        for i in ids:
            rvw, s, t = hist[i]
            k = min(int(np.searchsorted(t, tt, side="right")) - 1, len(t) - 1)
            k = max(k, 0)
            x, y = to_app_pos(rvw[k][0][0], rvw[k][0][1])
            row.append({"id": i, "x": x, "y": y, "potted": int(s[k]) == pt.constants.pocketed})
        samples.append({"t": tt, "balls": row})

    contacts, cushions, potted = [], [], []
    name_to_id = {("cue" if b["id"] == 0 else str(b["id"])): b["id"] for b in shot["balls"]}
    for ev in system.events:
        et = ev.event_type
        ag = [a.id for a in ev.agents]
        if et == pt.EventType.BALL_BALL:
            contacts.append({"a": name_to_id[ag[0]], "b": name_to_id[ag[1]], "t": ev.time})
        elif et in (pt.EventType.BALL_LINEAR_CUSHION, pt.EventType.BALL_CIRCULAR_CUSHION):
            cushions.append({"id": name_to_id[ag[0]], "t": ev.time, "wall": ag[1]})
        elif et == pt.EventType.BALL_POCKET:
            potted.append(name_to_id[ag[0]])

    duration = max(float(hist[i][2][-1]) for i in ids)
    return {"id": shot["id"], "duration": duration, "samples": samples,
            "events": {"contacts": contacts, "cushions": cushions, "potted": potted}}


def main():
    result = {"engine": "pooltool", "version": getattr(pt, "__version__", "?"), "cushion": CUSHION,
              "shots": [run_shot(s) for s in SPEC["shots"]]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result), encoding="utf-8")
    print(f"pooltool {result['version']}: {len(result['shots'])} shots -> {OUT}")


if __name__ == "__main__":
    main()
