# Billiard Simulator 9-Ball — Implementation Plan

Mobile-first web app (PWA) for practising 9-ball: place cue ball + object balls, see ghost-ball aim,
cut angle, fullness, predicted paths, then simulate the shot with power + spin.

## Constraints
- **Vanilla JS ES modules, no build step, no dependencies.** Open via any static server.
- UI text in **Vietnamese**.
- Must work on phone (portrait + landscape) and desktop. Touch + mouse via Pointer Events.
- All world coordinates in **millimetres**; convert to pixels only in the renderer.
- Physics module must be pure (no DOM) so it can be unit-tested with Node.

## File layout
```
index.html          # layout, canvas, control panel
css/style.css       # mobile-first, dark felt theme
js/vec.js           # DONE — vector helpers (add, sub, scale, dot, norm, perp, distPointSeg, ...)
js/table.js         # table constants, pockets, rail segments
js/geometry.js      # ghost ball, cut angle, fullness, best pocket, obstruction checks
js/physics.js       # simulation engine (pure)
js/render.js        # canvas drawing + view transform (world<->screen, auto-rotate)
js/input.js         # pointer handling: drag balls, tap ball/pocket, spin pad
js/drills.js        # practice modes + scoring (localStorage)
js/share.js         # encode/decode positions in URL hash
js/app.js           # state + wiring
manifest.webmanifest, sw.js, icon.svg   # PWA, offline cache
tests/physics.test.mjs                   # node --test
README.md
```

## Table constants (9 ft, playing surface)
- W = 2540, H = 1270 mm. Origin top-left of playing surface, x right, y down.
- Ball radius R = 28.575 mm (2.25 in diameter).
- Pockets (6): corners (0,0),(W,0),(0,H),(W,H); sides (W/2,0),(W/2,H).
- Pocket **aim point** (for geometry): corner → point 15 mm inside along diagonal; side → (W/2, 0 - 10) / (W/2, H + 10).
- Rail openings: corner gap = 110 mm along each rail from the corner; side gap = half-width 62 mm around W/2.
- Potting rule: ball is potted when its center is within capture radius of pocket center (corner 60 mm, side 55 mm),
  OR its center crosses the rail line (x<0, x>W, y<0, y>H) inside a gap region.
- Head string at x = W/4; foot spot at (3W/4, H/2). Diamonds every W/8 on long rails, H/4 on short rails (draw only).

## geometry.js API
```js
computeShot(cue, obj, aimPoint, R) -> {
  ghost, aimDir, objDir, cutAngleDeg, fullness /*0..1*/, fullnessLabel /* "Đầy", "3/4", "1/2", "1/4", "1/8", "Lướt" */,
  cueAfterStunDir /* 90° tangent line */, cueAfterRollDir /* ~30° rule approximation */, possible /* cut < 88° */
}
bestPocket(cue, obj, balls, R) -> pocket index with smallest cut angle, unobstructed preferred
isPathBlocked(a, b, balls, R, ignoreIds) -> ball id | null   // segment vs 2R clearance
```
- ghost = obj − objDir · 2R, objDir = norm(aimPoint − obj); aimDir = norm(ghost − cue).
- cut angle = angle between aimDir and objDir. fullness = 1 − sin(cut) (overlap fraction of ball).
- 30° rule: rolling cue ball deflects ~30° from aimDir for cuts between ~1/4 and 3/4 ball — label as approximation in UI.

## physics.js — model
Each ball: `{ id, pos, vel, spin /* 2D "roll" vector R·ω in velocity units */, side /* R·ωz, mm/s */, potted, path: [] }`.
- Constants: g = 9810 mm/s², μ_slide = 0.2, μ_roll = 0.01, side decay factor ≈ 0.3/s exponential, ball-ball restitution 0.95,
  cushion restitution 0.75, fixed timestep dt = 1/600 s, stop when all |vel| < 5 mm/s.
- **Sliding** (|vel − spin| > 1e-3): slip c = vel − spin, ĉ = norm(c);
  vel −= μ_slide·g·ĉ·dt; spin += 2.5·μ_slide·g·ĉ·dt. Clamp so slip does not overshoot (if it would, set spin = vel = (5v+2s)/7-consistent value).
- **Rolling**: vel decelerates by μ_roll·g; spin = vel.
- **Cue strike** `strike(ball, aimDir, power 0..1, tip {x,y} in [-1,1] circle)`:
  speed = 300 + power·(6500); vel = aimDir·speed; tip offset b = tip·0.5 (max half radius);
  spin = aimDir·(2.5·b.y_top·speed) (top = +follow, bottom = draw, centre = stun → spin 0); side = 2.5·b.x·speed.
- **Ball–ball**: equal masses; exchange normal velocity components with restitution; **spin unchanged** (this produces natural follow/draw curves).
  Resolve overlap by pushing apart along normal. Ignore throw (note in README as a limitation).
- **Cushion**: outside gap regions reflect normal velocity component × 0.75; tangent += side·0.3 (english changes rebound angle); side ×= 0.5;
  normal component of spin reversed ×0.5.
- `simulate(balls, shot, {recordPaths:true, maxTime: 20})` → returns final state + per-ball paths (sample every ~8 ms) + events
  (`firstContact` ball id, `potted` ids in order, `cushionHits`). Used both for **live animation** and for the **prediction preview**.
- Provide a step API too: `createSim(balls)` with `.step(dt)` and `.isMoving()` for animation at 60 fps (run 10 substeps per frame).

## render.js
- View transform: fit table + rails (rail width 60 mm, wood frame) into canvas with padding; **if canvas is portrait, rotate table 90°**.
  Expose `worldToScreen`, `screenToWorld`. Handle devicePixelRatio.
- Draw: wood frame, felt (#0b6e4f), pockets (dark circles), diamonds, head string (faint), balls with 9-ball colours
  (1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black, 9 yellow stripe) and number circle, cue ball white.
- Overlays (togglable): aim line cue→ghost, dashed ghost ball outline, object ball line to pocket, tangent line (90°) and 30° roll line,
  predicted paths from the physics preview (cue ball white dashed, object ball coloured), highlighted selected target/pocket,
  red warning if path blocked, drill target zone.

## input.js / interactions
- Drag any ball (snap inside table, prevent overlap: push to nearest free spot). Pointer capture; make hit area ≥ 44 px on phone.
- Tap object ball → becomes target. Tap near pocket → selects pocket (otherwise auto `bestPocket`).
- Fine aim offset slider ±5° (practise aiming errors) — default 0.
- Spin pad: circle widget showing cue ball face; tap/drag to set tip position; double-tap resets centre.
- Power slider 0–100 %.

## Panel (bottom sheet on phone, side panel on desktop ≥ 900 px)
- Info: Góc cắt (°), Độ dày (label + %), Khoảng cách bi cái–bi mục tiêu, bi mục tiêu–lỗ (cm), cảnh báo bị chặn.
- Controls: Lực, Điểm chạm (spin pad), Lệch ngắm, buttons: **Đánh**, **Đặt lại** (restore pre-shot positions), **Ngẫu nhiên**,
  **Xếp 9 bi** (rack diamond at foot spot, cue ball behind head string), **Chia sẻ** (copy URL with hash), toggles for overlays.
- Ball tray: chips 1–9 to add/remove balls from table.
- After a shot: toast with result ("Vào lỗ!", "Trượt", "Bi cái vào lỗ – lỗi", "Chạm sai bi trước" — 9-ball rule: first contact must be lowest-numbered ball).

## drills.js — modes (tabs: Tự do / Đoán độ dày / Điều bi cái)
1. **Tự do** (free): everything above.
2. **Đoán độ dày**: random cue + one object ball + pocket with cut 5°–75°; aim overlays hidden; user picks from
   Đầy / 3/4 / 1/2 / 1/4 / 1/8; reveal correct answer + actual angle; then auto-play the shot. Track streak/accuracy.
3. **Điều bi cái** (position play): random easy pot + a target circle (r = 150 mm) somewhere; user sets power + spin and shoots;
   success = object ball potted AND cue ball stops inside circle. Score saved.
- Persist stats in localStorage with try/catch.

## share.js
- Hash format: `#c=1270,635;1=1905,635;9=2000,700;t=1;p=2` (ints in mm, t = target id, p = pocket index). Load on start + on `hashchange`.

## PWA
- `manifest.webmanifest` (name "Bida 9 bi – Tập luyện", display standalone, theme #0b6e4f, icon.svg).
- `sw.js`: cache-first for app shell files; bump cache version constant on change.

## Tests (node --test tests/)
- Straight-in shot: cut angle 0, fullness 1, ghost exactly 2R behind obj.
- 30° cut → fullness 0.5.
- Stun shot straight-on: cue ball stops (|vel| < 5) after collision, object ball moves forward.
- Draw shot: cue ball ends behind its collision point; follow: ends ahead.
- Cushion bounce keeps ball inside table; ball aimed directly into corner pocket gets potted.
- Energy sanity: no ball speeds up without a collision.

## PHASE 2 (do NOT implement in phase 1) — Table & cue selection + folder reorg

### 2.0 Folder reorg (global convention)
```
index.html
assets/        style.css, icon.svg, manifest.webmanifest
src/core/      vec.js, table.js, geometry.js, physics.js, equipment.js   (pure, no DOM)
src/ui/        render.js, input.js, panel.js, settings.js
src/features/  drills.js, share.js
src/app.js
sw.js          (must stay at root for scope)
tests/core/    *.test.mjs
docs/          physics-notes.md
```

### 2.1 Equipment model — `src/core/equipment.js` (pure)
All physics constants currently hard-coded in table.js/physics.js move into two profile objects
passed to `createSim(balls, {table, cue})` / `simulate(...)` / geometry.

```js
TableProfile = {
  id, name,
  size: '7ft' | '8ft' | '9ft',           // 1980×990 | 2240×1120 | 2540×1270 mm playing surface
  muSlide,        // ball–cloth sliding friction (0.15–0.25)
  muRoll,         // rolling resistance: fast worsted cloth ≈ 0.008, slow napped ≈ 0.015
  sideSpinDecay,  // 1/s
  cushionRestitution, // 0.70 (dead) – 0.85 (lively)
  cushionSpinTransfer, // how much english changes rebound angle
  cornerMouth, sideMouth, // pocket mouth width mm (tight pro ≈ 114/127, standard ≈ 127/140)
  pocketCaptureScale,     // derived capture radius / rail gaps scale with mouth width
}
CueProfile = {
  id, name,
  massG,          // 510–600 g (18–21 oz); break cue heavier
  tipDiameterMm,  // 11.5–14
  tipHardness: 'soft'|'medium'|'hard'|'phenolic',
  shaft: 'standard'|'low-deflection'|'carbon',
  squirtDegPerFullSide, // cue-ball deflection (deg) at max side offset; standard > LD > carbon
  miscueLimit,    // max tip offset (fraction of R) before miscue: soft ≈ 0.6, hard ≈ 0.5, phenolic ≈ 0.45
  spinEfficiency, // 0.8–1.0 multiplier on transferred spin
  tipRestitution, // ≈ 0.7–0.85 (phenolic highest)
}
```
**All preset numbers are approximations for training feel, not measured data — show "(ước lượng)" in UI.**

### 2.2 Physics changes
- Cue strike: power slider = cue stick speed (0.5–9 m/s). Ball speed
  `v = (1 + e_tip) · m_cue / (m_cue + m_ball) · v_stick`, m_ball = 170 g.
- Spin: spin/side scaled by `spinEfficiency`.
- **Squirt**: cue-ball launch direction = aimDir rotated by `−sign(tip.x) · squirtDegPerFullSide · |tip.x|`
  (right english pushes ball left). Prediction + aim overlay show both "đường ngắm" and "đường bi cái thực tế".
- **Miscue**: if |tip| > miscueLimit → cue ball launched at 30 % speed with random ±3° and no spin; toast "Trượt cơ (miscue)!".
- Table: size changes W/H (rescale existing ball positions proportionally), friction, cushion, pocket mouths
  (rail gaps + capture radius derived from mouth width).
- Tests: heavier cue ⇒ faster ball for same stick speed; LD shaft squirt < standard; miscue above limit;
  7ft table dims; slower cloth ⇒ shorter roll distance.

### 2.3 Presets
Tables: `pro-9ft` (fast cloth, lively cushions, tight pockets), `club-9ft` (standard), `bar-7ft` (slow cloth, dead cushions,
wide pockets), `custom`.
Cue preset values (training estimates, not measured):

| id | massG | tipMm | tip | squirtDegPerFullSide | miscueLimit | spinEfficiency | tipRestitution |
|---|---|---|---|---|---|---|---|
| standard | 539 | 13.0 | medium | 3.0 | 0.55 | 0.90 | 0.75 |
| low-deflection | 539 | 12.5 | medium | 1.8 | 0.55 | 0.92 | 0.75 |
| carbon | 539 | 12.5 | medium | 1.2 | 0.55 | 0.95 | 0.77 |
| break | 595 | 13.0 | phenolic | 3.5 | 0.45 | 0.60 | 0.85 |
| user-cue (Fury TK-03) | 539 | 12.5 | medium | 1.8 | 0.55 | 0.92 | 0.75 |

Cues: `standard` (shaft thường), `low-deflection`, `carbon`, `break` (heavy, phenolic tip, low spinEfficiency),
`user-cue` = **"Gậy của tôi"** — default name **"Fury TK-03"** (model confirmed by user: HT2 Hybrid shaft, sharkskin
leather wrap), values editable by user. Pre-fill from retailer listings (unverified, no official Fury spec sheet found):
`massG: 539` (19 oz, retailers list 19–19.5 oz, adjustable), `tipDiameterMm: 12.5`, `tipHardness: 'medium'`
(retailers mention Kamui Black Medium or Fury Super Tip depending on model), `shaft: 'low-deflection'`
(HT2 / HTH hybrid shaft with carbon core per VN retailers; one MY retailer says maple — treat as LD),
`squirtDegPerFullSide`: use the low-deflection preset value, `miscueLimit: 0.55`, `spinEfficiency: 0.92`.
UI note under this cue: "Thông số lấy từ cửa hàng bán lẻ, chưa xác minh với hãng".

### 2.4 UI
- Header chip shows current table + cue ("Bàn: Pro 9ft · Gậy: Fury TK-03"); tap opens **Thiết bị** sheet.
- Sheet: two tabs Bàn / Gậy; preset cards; "Nâng cao" expander with sliders for every profile field;
  "Lưu thành gậy của tôi" / rename. Persist in localStorage (try/catch). Include profile ids in share hash (`tb=`, `cu=`).
- Aim panel adds "Bù squirt: x.x°" when side spin ≠ 0, so the player learns how much to compensate with this cue.
- Drill "Bù squirt": random shot requiring side spin; user adjusts aim offset to compensate; scored by pot success.

### 2.5 Free aiming (user request)
- Aim mode: "Tự động" (ghost-ball) / "Tự do". Drag on empty felt rotates aim around cue ball (relative angular drag);
  ball drags still move balls. Fine-tune buttons ±0.1° / ±1° (long-press repeat). Cue stick drawn behind cue ball, pulled back by power.
- Manual mode: ray-cast squirt-adjusted path → first ball hit → cut/fullness info; "Không chạm bi nào" if none.
- Share hash `a=` aim degrees. Test for ray-cast first-hit helper.

## Definition of done
- `python -m http.server 8765` from project root serves a working app; no console errors.
- Works at 375×812 (portrait phone) and desktop; drag, aim info, prediction, shooting, drills all functional.
- `node --test tests/` passes.
- README (Vietnamese) explains how to run locally, open on phone in same Wi-Fi (`http://<LAN-IP>:8765`), deploy to GitHub Pages / Netlify,
  and lists physics limitations (no throw, no squirt/swerve, simplified pockets).

## PHASE 3 — English-aware auto aim, swerve, throw, visible rolling (user feedback)
User feedback: auto aim does not adjust for side english ("má phê"); balls have no rolling effect, so cue-ball
paths do not match real rolling behaviour.

### 3.1 3D spin model (src/core/physics.js)
Replace the 2D `spin` + scalar `side` with a full angular velocity `w = {x,y,z}` (rad/s) per ball (keep helper getters
so UI/tests can still read "roll" and "side" in velocity units).
- Contact point (r = (0,0,−R)) slip: `u = (vx − R·wy, vy + R·wx)`.
- Sliding (|u| > eps): `F = −μ_slide·m·g·û`; `v += F/m·dt`; `w += (r × F)/I·dt` with I = 2/5·m·R²
  ⇒ `wx += (5/(2R))·(F.y/m)·dt`, `wy += −(5/(2R))·(F.x/m)·dt`. Clamp so slip never reverses in one step.
- Rolling: v decelerates by μ_roll·g; set w.x, w.y to the rolling values; `wz` decays by `sideSpinDecay`
  (spin-friction torque).
- This must reproduce all existing tests (stun/draw/follow, (5v+2s)/7 rule).

### 3.2 Cue strike in 3D with elevation (swerve emerges naturally)
- New shot param `elevationDeg` (0–30, default 5; slider "Nâng cơ" in Điều khiển; drills keep 5).
- Cue direction `d = (cosθ·aim.x, cosθ·aim.y, −sinθ)`; hit point on sphere `p = R·(tipX·sidê + tipY·ẑ' + …)` — use
  the standard model: offsets a (side) and b (vertical) as fractions of R measured in the plane ⟂ d; p = surface
  point. Impulse J along d with magnitude from the existing stick-speed/mass/tip-restitution formula.
  `v = J_horizontal/m` (vertical part absorbed by table, ignore jumping), `w = (p × J)/I`, then × spinEfficiency,
  then apply squirt rotation to v as now.
- With θ > 0 and side english, w gets a horizontal component ⟂ aim ⇒ lateral slip ⇒ curved path (swerve/massé lite).
  θ = 0 ⇒ no swerve.

### 3.3 Ball–ball throw (src/core/physics.js)
- On collision (normal n from 1→2, tangent t): normal impulse Jn as now (restitution 0.95).
- Relative tangential velocity of contact points: `vt = (v1 − v2)·t + R·(w1z + w2z)` (sign consistent with t; also
  include horizontal w terms projected — vertical-axis terms dominate, keep it simple: use z-spin + linear).
- Friction impulse `Jt = min(μ_ball·Jn, m·|vt|/7)` opposing vt; μ_ball = 0.06 (estimate; put in TableProfile as
  `ballFriction`).
- Apply: `v1 −= (Jt/m)·t̂`, `v2 += (Jt/m)·t̂`, and update w1z, w2z by `(R·Jt)/I` with correct signs (both balls'
  spins are reduced toward zero relative slip).
- Result: cut-induced throw (stun cut ⇒ object ball thrown ~1–3° toward the cut side) and spin-induced throw
  (side english throws object ball opposite to the english side).

### 3.4 Auto aim compensates english (src/core/geometry.js or new src/core/aim-solver.js, pure)
- `solveAim(state, targetId, pocketPoint, shot, table, cue)` → `{ aimDir, correctionDeg, parts: {squirt, swerve,
  throw} }`.
- Method: start from ghost-ball aim; simulate (same engine, no path recording) only until the first ball–ball contact
  plus ~50 ms; measure object-ball heading error vs line to pocket point; secant/bisection on aim angle within ±8°,
  ≤ 12 iterations, tolerance 0.02°. If first contact is not the target ball, report failure.
- Parts breakdown: squirt = launch rotation; swerve = (actual contact point vs straight-line contact) angle; throw =
  object heading vs line of centres at contact.
- Panel toggle "Tự bù effet" (default ON in Tự do mode; in Bù squirt drill it stays OFF — that drill is about manual
  compensation). Info rows: "Ngắm bù: x.x° (squirt a · cong b · throw c)".
- Recompute throttled (it costs several mini-simulations); cache by state hash.

### 3.5 Visible rolling (src/ui/render.js + orientation in physics)
- Each ball keeps an orientation quaternion `q`, integrated each step from w (`q += 0.5·(0,w)·q·dt`, renormalize).
  Pure function, tested.
- Render: number disc / stripe band / cue-ball red dots are body-fixed features projected orthographically: feature
  axis n (world) → screen offset R·(n.x, n.y); draw only when n.z > 0, squash by n.z (ellipse). Cue ball gets 2
  opposite red dots so spin is visible (spinning in place for stun/draw, rolling forward when rolling).
- Path drawing (prediction + replay trail): colour segments by state — sliding = orange, rolling = white/ball colour,
  plus a small marker where the ball reaches natural roll. Record state per path sample.

### 3.6 Tests (tests/core)
- Existing 29 still pass (update only the internal representation accessors, not expectations).
- Swerve: θ=15°, right english, medium speed ⇒ cue path lateral deviation to the expected side grows over time;
  θ=0 ⇒ deviation from squirt only (straight line).
- Throw: stun 30° cut ⇒ object ball direction differs from line of centres by 0.5°–4° toward the cut direction;
  straight-on hit with left english ⇒ object ball thrown right (and vice versa).
- Auto aim: with right english + elevation 5°, uncompensated ghost aim misses the pocket aim point by > some mm,
  `solveAim` result pots the ball (simulate full shot, assert potted).
- Quaternion stays unit length after 10 s of rolling; rolling ball's number disc advances by v·t/R radians.

### Definition of done (phase 3)
`npm test` passes, `node --check` clean, sw.js CACHE_VERSION bumped to 'bida9-v4', README updated (Vietnamese) with
the new controls (Nâng cơ, Tự bù effet) and the model limits (no jump shots, simplified throw, estimates).

## PHASE 4 — Realistic throw + corrected criteria (user approved "Sửa cả hai")
### 4.1 Throw model (src/core/physics.js, collision)
- Relative velocity of the two contact points in **3D**: `vrel = (v1 + w1 × r1) − (v2 + w2 × r2)`, r1 = +R·n, r2 = −R·n
  (n from ball 1 to 2, linear velocities have z = 0). Tangential part `vt = vrel − (vrel·n)n` (3D, includes the vertical
  component produced by top/back spin).
- Speed-dependent ball–ball friction: `μ(|vt|) = a + b·exp(−c·|vt|)` with |vt| in m/s; defaults a = 0.01, b = 0.108,
  c = 1.088 **[Unverified — estimate of a published fit; expose a, b, c in TableProfile as ballFrictionA/B/C, keep the
  old `ballFriction` slider as a multiplier]**.
- Friction impulse `Jt = min(μ·Jn, m·|vt|/7)` along −v̂t (3D). Apply only the **horizontal** part to linear velocities
  (vertical part is absorbed by the table — no hop); apply the full 3D impulse to angular velocities:
  `w1 += (r1 × (−Jt·v̂t))/I`, `w2 += (r2 × (+Jt·v̂t))/I`.
- Expected consequences (audit): throw drops at high speed (B11), drops when cue ball is rolling or drawn (B12, because
  the vertical slip tilts v̂t and the horizontal share of the impulse shrinks), SIT still opposite to english (B10).
- Aim solver needs no change (uses the engine); re-check its convergence + timing.

### 4.2 Panel breakdown (no misleading sum)
- Replace row "Squirt · cong · throw" by two always-present rows:
  "Lệch bi cái (squirt · cong)": signed degrees at the cue ball;
  "Throw bi mục tiêu": signed degrees of object-ball heading vs line of centres.
  Keep "Ngắm bù effet" = the actual aim rotation (that is the only number the player applies).
  Tooltip/hint: "Ngắm bù là kết quả tổng hợp, không phải tổng cộng các góc".

### 4.3 Audit
- Update `scripts/physics-audit.mjs` to the criteria v2 in `docs/physics-criteria.md` (B3/B4/B5/B6/B11/B12/D2/D4
  changed). Compute e-dependent expectations from the active table profile. Same honesty rule: never tune code to
  pass. Regenerate `docs/physics-audit-report.md`.
- Tests: add B11/B12-style unit tests; keep all existing tests green. Bump sw.js CACHE_VERSION to 'bida9-v5'.

## PHASE 5 — Keyboard control for PC (user request) + UX polish
User wants: ←/→ rotate cue, ↑/↓ power, hold Ctrl to adjust english, Space to shoot. Make it friendly.

### 5.1 Key map (new module src/ui/keyboard.js, wired in app.js)
| Keys | Action | Step |
|---|---|---|
| ← / → | rotate aim (switches to "Tự do", starting from current auto direction) | 0.1° ; Shift = 1° ; Alt = 0.02° |
| ↑ / ↓ | power | ±1 % ; Shift = ±5 % |
| Ctrl + ←/→/↑/↓ | move tip on spin pad (← = left english, ↑ = high/follow, ↓ = low/draw) | 0.05 R ; Shift = 0.1 R |
| W/A/S/D | same as Ctrl+arrows (alternative; macOS uses Ctrl+arrows for Spaces) | same |
| C | tip back to centre | |
| Space | shoot; while balls move: fast-forward (×4) | |
| PageUp / PageDown | cue elevation ±1° (only where elevation is editable) | |
| Tab / Shift+Tab | next / previous target ball (auto aim) | |
| P | next pocket for current target | |
| 1–9 | select that ball as target if on table | |
| M | toggle aim mode Tự động / Tự do | |
| R | Đặt lại (restore pre-shot) ; N = Ngẫu nhiên ; F = toggle prediction | |
| H or ? | show/hide key help overlay | |
| Esc | close sheet / help overlay | |
Rules:
- Listen on window keydown in capture phase; `preventDefault` for every handled key (no page scroll, no slider double-handling).
  Ignore when focus is in a text input/textarea/contenteditable or when the Thiết bị sheet is open (except Esc).
  If a range slider has focus, our handler wins for arrows (preventDefault) so the same key never does two things.
- Ctrl modifier only affects arrows; never block Ctrl+R / Ctrl+C / Ctrl+Z etc. (don't preventDefault Ctrl+letters).
- Hold-to-repeat with acceleration: use our own repeat timer started on keydown and stopped on keyup/blur
  (ignore native auto-repeat events): first step immediately, repeat after 250 ms every 40 ms; after 1 s of holding,
  step ×5 (aim) / ×3 (power). Stop all repeats on window blur / visibilitychange.
- During shot animation only Space (fast-forward), H, Esc work.
- Every change goes through the same state setters as the touch UI (sync sliders, spin pad, info, prediction throttle).

### 5.2 Feedback / discoverability (desktop only: `matchMedia('(hover: hover) and (pointer: fine)')`)
- HUD drawn on the table canvas corner (not over the play area): power bar, aim angle (°), tip mini-pad, elevation,
  aim mode. Updates live so the player never has to look at the side panel.
- Transient value badge near the HUD when a key changes something ("Lực 45 %", "Phê phải 30 %", "Ngắm 12,3°"),
  fades after 800 ms.
- Key hint strip under the table: "←/→ ngắm · ↑/↓ lực · Ctrl+mũi tên phê · Space đánh · H trợ giúp"; dismiss "×",
  remembered in localStorage (try/catch). Help overlay lists the full table above (Vietnamese).
- Spin pad shows keyboard-moved tip immediately; the miscue ring stays visible; a step that would cross the miscue
  limit stops at the ring first (one extra press goes beyond) so players don't miscue by accident.
- Mouse wheel over the table: rotate aim 0.1° per notch (Shift = 1°); preventDefault only over the canvas.
- Touch devices: no HUD/hint changes (phone UI must stay exactly as is).

### 5.3 Tests & done
- Pure helpers (key → action mapping, step/acceleration calculation, tip clamping with miscue stop) live in
  src/ui/keyboard.js as exported pure functions and get unit tests in tests/core/keyboard.test.mjs.
- `npm test` green, `node --check` clean, sw.js CACHE_VERSION 'bida9-v6', README section "Điều khiển bằng bàn phím".

## PHASE 6 — Realistic 3D "player's eye" view (user chose: Mắt người cầm cơ + Three.js)
three.js r164 (MIT) is vendored at `assets/vendor/three/three.module.min.js` (+ LICENSE). Do not use a CDN.

### 6.1 Structure
- `src/ui/render3d.js`: lazily loaded with dynamic `import()` the first time the 3D view opens (show "Đang tải 3D…");
  it imports three from the vendored file. If WebGL is unavailable → toast "Thiết bị không hỗ trợ 3D", stay in 2D.
- `src/ui/view3d-math.js`: PURE helpers (no three import) for: physics→3D coordinate mapping, camera pose, cue-stick
  pose, paths→3D polylines. Unit-tested in tests/core/view3d.test.mjs.
- View toggle button in the header area / aim bar: "Góc nhìn: 2D | 3D", key **V**. The 3D canvas occupies the same
  stage area as the 2D canvas (2D canvas hidden, not destroyed). Choice remembered in localStorage (try/catch).

### 6.2 Coordinates & scale
- Physics frame: x right, y down (table plane), z down; mm. three frame: metres, y up.
  `three.x = (x − W/2)/1000`, `three.z = (y − H/2)/1000`, `three.y = −z/1000` (ball centre at y = R/1000).
- Ball orientation: convert physics quaternion to three quaternion consistently with this axis map (y↔z swap with
  sign flip = a reflection, so derive via rotation matrix basis mapping and test that a ball rolling +x shows its
  number moving the right way).

### 6.3 Scene (realistic but light)
- Table from the active TableProfile (7/8/9 ft): cloth plane (colour #0b6e4f, MeshStandard roughness ~0.9, subtle
  procedural noise canvas texture), cushions as extruded profiles with a nose at ball-centre height with gaps at the
  pocket mouths derived from the same table geometry used by physics, wooden rails (warm brown, roughness ~0.5),
  6 pockets as dark holes/cylinders with leather-ish rim, diamonds as small pearl inlays, head string optional faint.
- Balls: SphereGeometry(R, 48, 32), MeshPhysicalMaterial (clearcoat 1, roughness ~0.15) with a per-ball canvas
  texture: solid colour + white number circle; 9-ball = white with yellow stripe; cue ball white with 2 red dots
  (same features as 2D). Orientation from physics quaternion every frame.
- Lighting: billiard lamp look — 3 SpotLights (or 1 DirectionalLight + 2 point lights) above the table, warm white,
  HemisphereLight fill, dark room background (#0b0f0d) with soft fog. Shadows: one shadow-casting light, PCFSoft,
  1024 map; disabled on `pointer: coarse` or when setting "Chất lượng 3D: Thấp". Renderer: antialias, sRGB output,
  ACESFilmic tone mapping, pixelRatio = min(devicePixelRatio, 2) (1.5 on phones).
- Cue stick: tapered cylinder (tip Ø = cue.tipDiameterMm, butt Ø 30 mm, length 1470 mm), blue tip, white ferrule,
  maple shaft, dark wrap section, darker butt. Pose: along aim direction (squirt NOT applied — the stick shows where the
  player aims), raised by elevation angle, tip touching the ball surface at the chosen english offset (so the hit
  point is visible), pulled back by power (5–25 cm). On shoot: quick forward stroke animation (120 ms) then hide the
  stick until balls stop.
- Aids (follow existing overlay toggles): aim line on cloth, semi-transparent ghost ball, prediction paths as thin
  lines 1 mm above cloth with slide=orange / roll=white colouring and natural-roll marker.

### 6.4 Camera "Mắt cơ thủ"
- Default pose: behind the cue ball along −aimDir, distance 0.55 m (horizontal), eye height 0.20 m above cloth,
  looking at a point 1.2 m ahead along the aim line at cloth height + R; FOV 50°.
- Adjust: mouse wheel / pinch = distance (0.25–2.0 m); keys **[ / ]** = eye height (0.06–0.8 m); **- / =** = distance;
  vertical drag with right mouse button or two-finger vertical drag = height.
  Horizontal drag (left mouse / one finger) on the 3D view rotates aim (same as free-aim drag in 2D, switches to Tự do).
  Arrow keys, Ctrl+arrows, Space etc. work unchanged (phase 5); in 3D the mouse wheel zooms instead of aiming.
- During a shot: camera stays at the shot pose (realistic) unless toggle "Camera theo bi cái" is on (then it follows
  smoothly from behind the cue ball's velocity). After balls stop: lerp (600 ms, ease) to the new behind-cue-ball pose.
- Minimap: small top-down 2D map in a corner of the 3D view (reuse the 2D renderer drawing on a small canvas,
  ~28 % width, rotated to match the camera heading optional = no, keep north-up). Tap/click minimap → switch to 2D
  (ball placement stays a 2D-view feature).

### 6.5 Performance & robustness
- Render on demand: only when balls move, camera lerps, or inputs change; pause when document hidden.
- Dispose GPU resources when the table size changes (rebuild table meshes) and when leaving 3D isn't needed (keep
  scene cached).
- Must not affect 2D/phone performance when 3D is never opened (no three download until first open).

### 6.6 Tests & done
- view3d-math tests: mapping round-trip, camera pose behind ball for several aims (dot(camera→ball, aim) > 0, height
  correct), stick tip touches ball surface at the english offset (distance to ball centre = R ± 0.5 mm before
  pull-back), pull-back monotone with power, quaternion mapping sanity (rolling +x rotates feature toward +x at top).
- All existing tests green; sw.js CACHE_VERSION 'bida9-v7' with render3d.js, view3d-math.js and the vendor file in
  the precache list; README "Góc nhìn 3D" + three.js MIT notice; help overlay/hint strip list V, [ ], - =.

### 6.7 Situational camera (user request, added during phase 6)
- Camera mode select "Camera: Tự động | Cố định | Theo bi cái" (replaces the single "Camera theo bi cái" toggle);
  key **K** cycles; default **Tự động**; remembered in localStorage.
- Tự động (director):
  1. Aiming → player-eye pose (6.4).
  2. Shot fired → keep player-eye during the stroke + ~250 ms, then ease (≈600 ms, ease-in-out, interpolate position
     and look-at, FOV) to an overhead "top-down" 3D pose: above table centre, high enough that the whole table +
     rails fit the viewport aspect (compute from FOV and aspect; rotate camera yaw so the table's long axis matches the
     screen's long side), looking straight down (tiny tilt ≤ 5° allowed for depth).
  3. All balls stopped → hold 300 ms, then ease back to the player-eye pose behind the cue ball for the next shot
     (if cue ball was potted: go to top-down and stay until it is re-spotted, then player-eye).
  4. Any user input during the move (aim key, drag) skips the transition and snaps to the target pose.
- Cố định: camera never moves automatically (stays at shot pose). Theo bi cái: behaviour from 6.4.
- Pure helper in view3d-math.js: `topDownPose(tableW, tableH, fovDeg, aspect)` and a `cameraDirector` state machine
  (input: phase events aim/shot/moving/stopped/scratch + time; output: target pose + blend factor) — unit-tested.

## PHASE 7 — Realistic jump shot & massé (user request: "làm lại logic Massé và nhảy bi cho hợp lý với ngoài đời")

### Why
Measured on the current engine (see `src/core/physics.js`):
- `computeLaunch` keeps the **horizontal** ball speed independent of elevation (`jm = full / c`). At 72° / 30 % power the
  cue ball still leaves at 4058 mm/s, so a massé needs ~2 m to bend 165 mm. A brute-force search (10 000+ shots) found
  no shot that curves round a fully blocking ball. Real massé: steep cue, soft stroke, slow forward speed, tight curve.
- The jump is a special case bolted on (`shot.jump`, fade-in thresholds, `JUMP_REBOUND`, `JUMP_MAX_VZ`, `speed * 0.72`).
  Real jump and real massé are the **same physics**: the cue drives the ball into the slate, the slate returns part of
  the vertical impulse, and only the horizontal part of the impulse moves the ball forward.
- Ball–ball contacts use a 2D normal even when one ball is airborne; airborne balls bounce off cushions as if on the
  cloth and can never leave the table.

### Model (all in `src/core/physics.js`, pure, units mm / s)
One unified launch, no opt-in flag, no elevation/power thresholds.

1. **Launch** (`computeLaunch`). Let `J = ballSpeed(cue, stickSpeed(power))` (impulse per unit ball mass along the cue,
   the same value that is today's level-cue speed), `θ` = elevation, cue direction `dc = (cosθ·d, −sinθ)`.
   - horizontal speed `speed = J·cosθ` along `dir` (squirt unchanged). **This replaces `jm = full / c`: use `jm = J`.**
   - spin `w = (p × J·dc) / I · spinEfficiency` — same formula as now, with `jm = J`.
   - vertical: the ball is driven into the slate at `J·sinθ` and rebounds:
     `vz = max(0, TABLE_BOUNCE_E · J·sinθ − HOP_ABSORB)` with `TABLE_BOUNCE_E = 0.5`, `HOP_ABSORB = 600` mm/s
     (cloth + tip dwell swallow small hops; a 5° cue never hops, even on the break: 0.5·11974·sin5° = 522 < 600).
   - Remove the `jump` parameter everywhere (`computeLaunch`, `strike`, `Sim.strike`, `aim-solver.js`, `bot.js`,
     `app.js: jumpOn`), and remove `JUMP_MIN_ELEVATION_DEG`, `JUMP_MIN_POWER`, `JUMP_MAX_VZ`, `JUMP_REBOUND`, the
     `ty >= -0.35` rule and the `* 0.72` factor. Keep `vz` in the returned launch object. Miscue: `vz = 0`.
   - `MAX_ELEVATION_DEG` stays 72.

   Expected numbers (default cue, used by the tests below, ±15 %):

   | shot | J | speed | vz | hop height vz²/2g | air time | air range |
   |---|---|---|---|---|---|---|
   | 45°, 40 % | ≈5190 | ≈3670 | ≈1235 | ≈78 mm | ≈0.25 s | ≈920 mm |
   | 60°, 30 % | ≈4058 | ≈2029 | ≈1157 | ≈68 mm | ≈0.24 s | ≈480 mm |
   | 72°, 15 % (massé) | ≈2361 | ≈730 | ≈523 | ≈14 mm | ≈0.11 s | ≈80 mm |
   | 39°, 30 % (jacked up over a ball) | ≈4058 | ≈3154 | ≈677 | ≈23 mm | | |

2. **Flight** (`_move`). While `b.z > 0`: no cloth friction, `vel` and `w` unchanged, `z += vz·dt`, `vz −= G·dt`
   (already implemented; keep).

3. **Landing** (in `_move`, when `z` reaches 0 with `vz < 0`). Let `vin = |vz|`.
   - bounce: `vz = TABLE_BOUNCE_E · vin` if that is `> 150` mm/s, else `vz = 0` (replaces the 0.28 / −250 constants).
   - impact friction: the normal impulse `(1 + e)·vin` gives a friction impulse of at most `muSlide·(1 + e)·vin` on the
     contact-point slip `u = (v.x + R·w.y, v.y − R·w.x)`; apply `Δv = −û·min(muSlide·(1+e)·vin, (2/7)·|u|)` and the
     matching spin change `Δw.x = −2.5·Δv.y/R`, `Δw.y = 2.5·Δv.x/R` (same relations as the sliding branch).
   - A grounded ball that receives a downward `vz` from a collision is handled by the same code path.

4. **Ball–ball in 3D** (`_collide`). Use the 3D centre offset `(dx, dy, dz)`, `dz = b.z − a.z`.
   - Both balls on the cloth (`a.z === 0 && b.z === 0 && !a.vz && !b.vz`): **exactly the existing 2D code path**
     (throw / friction model untouched — the Phase 4 tests must stay green without edits).
   - Otherwise: recompute `dz` after the `tau` rewind, normalise the 3D normal `n`, apply the frictionless normal
     impulse `jn = (1 + E_BALL)/2 · vn` to `(vel.x, vel.y, vz)` of both balls, and separate the overlap along `n`
     (clamp `z ≥ 0`). No instantaneous horizontal push larger than the 3D overlap. Record the contact event as today.

5. **Cushions, pockets, leaving the table** (`_walls` / `_jaws`), with `RAIL_TOP_H = 46` (export it from
   `geometry.js`, it is already defined there) and `POT_MAX_Z = 20`:
   - `z < RAIL_TOP_H`: cushions and jaws act as today.
   - `z ≥ RAIL_TOP_H`: cushions and jaws are ignored; when the ball centre is outside the playing rectangle
     (`depth < 0` for any wall, pocket gap or not) the ball has **left the table**: set `b.potted = true`,
     `b.offTable = true`, zero its motion, push its id to `events.potted` **and** to a new `events.offTable` array
     (do **not** push to `events.drops`).
   - pockets capture only when `z < POT_MAX_Z`.
   - `cloneBall` / `createBall` carry `offTable: false`.

### Rules (`src/features/bot.js`)
- `evaluateNineBallTurn` / `evaluateEightBallTurn`: any id in `events.offTable` is a foul with reason
  `'Bi bay khỏi bàn'` (checked right after the scratch check). Existing consequences then apply unchanged: cue ball →
  ball in hand; 9 → respot; 8 → rack lost (on the break: respot); other object balls stay off the table.
- Return `offTable` (array) in the result.

### Bot trick shots (`src/features/bot.js`)
Both solvers simulate with the real model and must accept a shot only when the cue ball reaches the legal target
**directly**: `events.firstContact === target`, no cue-ball cushion hit before that contact, the blocker does not
appear in any contact event before it, cue ball not potted, `events.offTable` empty.
- `findJumpShot`: directions = straight at the target + ghost-ball lines to open pockets (cut ≤ 60°), each ±1.2°;
  elevations `[40, 46, 52, 58]`; powers `[0.30, 0.36, 0.42, 0.50]`; tip `{x: 0, y: 0.1}`.
- `findMasseShot`: for each side (curve left / right) aim offsets `8…60°` in 4° steps to the side the ball must pass,
  english on the side that brings it back (right english curves right — see the Phase 3 swerve test for the sign),
  elevations `[60, 66, 72]`, powers `[0.12, 0.16, 0.20, 0.26, 0.32]`, tips `x = ±0.42`, `y ∈ {−0.15, 0, 0.15}`.
  Stop at the first potting solution; cap the search at 400 simulations per target with `maxTime: 4`.
- Returned shots: `{targetId, pocketIdx, aimDir, power, tip, elevationDeg, kind}`; `pocketIdx` = the pocket id of the
  target in `events.drops` when it is potted, else `−1` (fixes the hard-coded `0`).
- `chooseBotShot`: unchanged order (pot → jump/massé for `canJump`/`canMasse` → kick/safe); prefer a potting trick
  shot, otherwise the first one found (remove the `rng() < 0.5` coin flip).
- `probeOutcome` / kick search: treat `events.offTable.length > 0` like a scratch.

### App (`src/app.js`, `src/ui/panel.js`, `index.html` only if needed)
- Delete `jumpOn`, `state.botJump` and every `jump:` argument.
- The player may raise the cue in a match: `elevationLocked` only in the three drills (`thickness`, `position`,
  `squirt`); in `bot` mode on the player's turn `baseElevation()` = `state.elevation`; on a bot turn it stays
  `state.botElevation`. Reset `state.elevation` to `DEFAULT_ELEVATION_DEG` in `finishShot` (with the existing
  power / tip reset) and in `startBotRack`.
- `finishShot`: if `ev.offTable.length`, practice modes toast `Bi bay khỏi bàn!` (`'bad'`); no drop animation or
  pocket sound for those ids (they are not in `events.drops`), but the potted-tray bookkeeping (`state.pottedIds`)
  must include them.
- Renderers already draw `b.z` (`render.js:367`, `render3d.js:416`) — verify, do not rewrite.

### Tests (`node --test`, add to `tests/core/physics.test.mjs` and `tests/core/bot.test.mjs`)
Replace the test "jump shot: opt-in only…" and the jump / massé part of "Hero skills…" with:
1. launch: `speed ≈ J·cosθ` for θ = 0, 30, 60 (±0.5 %); spin magnitude at θ = 0 unchanged vs. today.
2. no hop: θ = 5°, power 1.0 → `vz === 0`; θ = 0 any power → `vz === 0`.
3. jump: 45°, 40 %, centre tip → max `z` in 50…120 mm; lands (first `z === 0` after take-off) 500…1300 mm away.
4. jump clears: cue (500,600), blocker (700,600), target (1300,600), 50°, 38 %, aim straight → `firstContact === 1`
   and no contact event involving the blocker.
5. massé: 72°, 15 %, tip `{x: 0.42, y: 0}`, aim +x on an empty table → after the ball stops sliding its travel
   direction is turned ≥ 25° to the right (+y); lateral offset ≥ 60 mm after 400 mm of forward travel; max `z` ≤ 30 mm.
   Mirror with left english.
6. airborne: `vel` and `w` constant while `z > 0`; landing with back-spin slip changes `vel` (impact friction).
7. off table: 45°, power 1.0 aimed at a long rail from 600 mm → `events.offTable` includes 0, ball `potted`;
   `evaluateNineBallTurn` returns `foul` with reason `'Bi bay khỏi bàn'`.
8. 3D contact: a ball dropped (`z = 80`, `vz = −800`) onto the edge of a resting ball → no NaN, both end at `z = 0`,
   no single-step displacement > 15 mm, horizontal momentum conserved within 1 %.
9. bot jump: the existing layout (cue (500,600), blocker 2 at (680,600), target 1 at (1050,600)) → `findJumpShot`
   returns a shot, `elevationDeg ≥ 40`, simulation hits 1 first with no cushion before and no blocker contact.
10. bot massé: cue (500,600), blocker 2 at (760,600), target 1 at (1200,600) → `findMasseShot` returns a shot with
    `|tip.x| ≥ 0.4`, `elevationDeg ≥ 58`, simulation hits 1 first, no cushion before, **max cue-ball `z` ≤ 30 mm**
    (it curves, it does not hop over). If the model cannot produce this, **do not weaken the test**: report the
    measured trajectories instead.
11. All previously passing tests stay green. Where an old expectation encodes the removed behaviour (horizontal speed
    independent of elevation at θ > 0), update the expected value to `J·cosθ` and list every such edit in the report.
    `npm run test:cases` 20/20; `npm run audit` must not get worse than
    `ĐẠT 26 · MỘT PHẦN 4 · KHÔNG ĐẠT 1 · CHƯA HỖ TRỢ 3` (restore `docs/physics-audit-report.md` with
    `git checkout -- docs/physics-audit-report.md` after running it unless a row legitimately changed).

### Docs
- `docs/physics-notes.md`: short section "Nhảy bi & massé (Giai đoạn 7)" with the formulas and constants above.
- `scripts/physics-audit.mjs` row E1: jump / massé are supported from Phase 7 (remove from the E list).

### Definition of done
`npm test`, `npm run test:cases` green; audit not worse; no `jump` flag left (`grep -rn "jumpOn\|shot.jump\|JUMP_" src`
is empty); bump `CACHE_VERSION` in `sw.js`; no git commit.
