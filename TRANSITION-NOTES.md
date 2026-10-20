# Cinematic Bridge: Hero Section → Clinical Suite

Seamless, scroll-reversible camera transition connecting the two animated
sections so they read as **one continuous cinematic journey** instead of two
separate sequences with a hard wipe between them.

## What the investigation found

The site is **not** Three.js — it is a scroll-driven *image-sequence* player:

| | Hero | Clinical Suite |
|---|---|---|
| Frames | 285 (`ezgif-87eb4f2fc51a57fe-jpg`) | 276 (`ezgif-4a7fad58a20dd84f-jpg`) |
| Section | `#hero-section` (sticky viewport) | `#clinic-section` (sticky viewport) |
| Canvas | `#hero-canvas` (2D, cover-fit) | `#clinic-canvas` (2D, cover-fit) |
| Old behavior | scrub 0→520vh | scrub 520vh→940vh |

Each section pins a full-screen canvas and scrubs frames from scroll position
(with LERP smoothing). **The camera paths are baked into the rendered frames.**

The key visual finding: the two sequences are *two halves of one camera
journey* that meet on the same beat:

- **Hero tail (frames ~270→285):** forward dolly *into* a hand-held tooth
  (hologram resolves into the real tooth, glow pulses). Final frame: bare
  hand holding the tooth center-frame in a blurred green operatory (surgical
  lamp upper-right, instrument tray lower-right).
- **Clinic head (frames 1→14):** the same beat from the other side — gloved
  hands hold the tooth in the *same* operatory, then the camera pulls back to
  reveal the room.

Despite that designed match-cut, the old implementation played the boundary as
a **vertical wipe**: the hero viewport scrolled up while the clinic viewport
slid in from below — an abrupt cut between two environments.

## The bridge (implementation)

Instead of a wipe, the two pinned viewports now **share the screen for one
viewport-height of scroll** and cross-dissolve a *matched dolly* between them:

```
scroll:   0 ─────────── 420vh ──────── 520vh ─────────────────── 940vh
hero:     scrub 0→284    [held frame 284, dolly-in scale 1→1.055]
clinic:   (below fold)   [frame 0 settles 1.09→1.0]  scrub 0→275
bridge:                 ╰────── 100vh dissolve ──────╯
```

- Outgoing hero frame **holds** its final frame and keeps pushing in
  (`scale 1→1.055`, ease-in) — the camera never stops moving forward.
- Incoming clinic frame **settles** from a slight push
  (`scale 1.09→1.0`, ease-out cubic) — the camera arrives and decelerates.
- A smoothstep **cross-dissolve** blends the two; both canvases pivot on
  `transform-origin: 50% 45%` — the shared position of the tooth in both
  boundary frames — so the dolly stays anchored on the subject.
- A soft green **light bloom** (`.handoff-bloom`) peaks at the dissolve
  midpoint (≈0.17 effective opacity) to carry the eye across the match-cut
  where the bare hand becomes gloved hands.
- Clinic overlay UI (top bar, headline) fades in slightly *after* the scene
  settles (delayed smoothstep), so text never pops.

### Why it is seamless

Both layers are pinned at the top of the screen during the bridge (no sliding,
no layout motion), the subject (tooth) stays center-frame in both shots, both
sequences share palette/lighting/set, and every animated value is a **pure
function of scroll position** — so the bridge is fully deterministic and
**reversible** when scrolling up, with no animation resets (the existing frame
LERP smooths both directions).

## Files changed

### `index.html`
- Added `<div id="clinic-bloom" class="handoff-bloom">` to the clinic sticky
  viewport (between the canvas and the overlay).
- Cache versions bumped: `style.css?v=16`, `script.js?v=13`.

### `style.css`
- `#hero-section { height: 620vh }` — +100vh of *hold* past the hero's scrub
  range.
- `#clinic-section { height: 620vh; margin-top: -200vh; z-index: 2 }` — the
  clinic section is pulled up so its viewport pins *exactly* while the hero
  viewport is still pinned (the overlap = bridge window). Total page height is
  **unchanged** (1040vh) and each sequence keeps its original scrub pacing
  (420vh each).
- `.handoff-bloom` styles (radial green-white light, opacity driven by JS).
- `.sequence-canvas { transform-origin: 50% 45%; will-change: transform }`.

### `script.js`
- `measureBridge()` — derives the bridge window and both scrub ranges from the
  **live layout** (`offsetTop` / `offsetHeight` / `innerHeight`), never from
  hard-coded vh, so the bridge always aligns with the native sticky pinning
  ranges (incl. mobile URL-bar resizes). Re-run on `resize`.
- `updateSectionBridge(scrollTop)` — applies the dissolve opacity, dolly
  scales, bloom and overlay fade. Also keeps the clinic viewport
  `pointer-events: none` until it is ~92% opaque, so the pinned layer can
  never swallow clicks meant for the hero UI.
- `handleScroll()` — hero progress now completes exactly at the bridge start
  (then holds); clinic progress holds on frame 0 through the bridge, then
  scrubs its original range at the original pace.

No new libraries; no changes to the frame sequences, colors, lighting,
overlays, navbar, or either section's animation content.

## Testing

- `node --check` on `script.js` / `server.js` — clean.
- Scroll-math simulation at 5 viewport configurations (1080p, 900, mobile
  with URL-bar `innerHeight ≠ vh`, short landscape, tablet): bridge opens
  exactly when the clinic viewport pins, closes exactly when the hero unpins,
  hero reaches frame 284 at bridge start, clinic holds frame 0 through the
  bridge and reaches frame 275 at max scroll — **all pass**; scrub pacing and
  total page height identical to before.
- Continuity: per-pixel deltas of every animated value are continuous; the
  only formal step (incoming scale at the very first bridge pixel, opacity
  0.0004%) contributes ~3×10⁻⁷ of frame contrast — ~12,000× below one 8-bit
  pixel step, i.e. physically imperceptible.
- Live server (`node server.js`) verified: HTML/CSS/JS and boundary frames
  serve correctly with the new markup and code.
- Reverse scrolling / repeated transitions: guaranteed by construction (all
  styles are pure functions of scroll; frame LERP is symmetric).

## Remaining limitations

- The camera paths themselves are pre-rendered, so the bridge synthesizes
  motion via transform (dolly + dissolve) rather than moving a real 3D camera;
  re-rendering a true connecting shot would require the source 3D scene.
- The tooth in the two boundary shots is held by a bare hand vs. gloved hands;
  the bloom masks this morph, but a trace of the "double exposure" is visible
  at the exact midpoint on very large displays if you look for it.
- On browsers that fire `resize` when the mobile URL bar collapses, the bridge
  re-measures and re-applies instantly — aligned by design, but the window can
  be slightly taller than 100vh there (by the toolbar height).

---

# Phase 3: Dental Services Section (Clinic → Services hand-off)

A third, **light content section** (`#services-section`) added directly after
`#clinic-section`, cinematically connected to the existing journey so
**Hero → Clinic → Services reads as one continuous camera move** — no cuts,
no camera resets, no scroll hijacking.

## Geometry (the −200vh overlap)

```
scroll:  … 7560 ────────────── 8460 ──────── 9748 (page end, 1440×900)
clinic:     [scrub … frame 275] │ unpins & slides away (opacity 0, inert)
services:   top ══ hand-off window (900px = 100vh) ══╗ reading phase (43vh)
                                                     ╲
clinic scene:  full ── push-in 1→1.055 + smoothstep fade ──▶ 0
white bloom:   0 ────── 0.45·sin(π·t) peak ──▶ 0
header:        hidden ── staggered reveal (label → heading → description) ──▶ 1
cards:         IntersectionObserver stagger (0/90/180ms by column)
```

- `#services-section { margin-top: -200vh }` — the services top crosses the
  fold exactly during the **last 100vh of the clinic scrub**, which is also
  where the clinic viewport unpins. Measured live (`measureServicesTransition`)
  from `offsetTop`/`offsetHeight`/`innerHeight`, re-run on `resize` and once
  on `load`; the window equals exactly 100vh at 1440×900, 768×1024, 1100×800,
  1024×800 and 390×844 in testing.
- The clinic keeps scrubbing its **final frames (≈253→275)** through the
  hand-off — the camera never stops while the scene dissolves.
- `#svc-bloom` (white radial bloom, fixed inside `#clinic-section`'s z-index:2
  stacking context) composites above both the fading scene and the rising
  services page, peaking mid-window and returning to **exactly 0** at the end.
- The outgoing values that live on bridge-owned elements (`opacity`,
  `pointer-events`, canvas `transform`) are **re-composed after the bridge in
  `handleScroll`**; values the new code owns alone (bloom, header) are
  **memoised on window progress** — outside the hand-off window the Phase-3
  code performs **zero style writes**.

## Section (additive, scoped)

- Header: `OUR SPECIALTIES` pill → `Comprehensive Dental Services` →
  description; reveals in sync with the camera arrival (smoothstep, staggered
  label 0.30 / heading 0.40 / description 0.50 of window progress).
- Six cards (exact copy from the reference screens): Cosmetic Dentistry &
  Veneers, Dental Implants & Restorations, Invisalign & Clear Aligners, Laser
  Teeth Whitening, Preventive Care & Cleaning, Root Canal & Ceramic Crowns —
  each with a **inline SVG icon**, title, description, 3 benefits and an
  accessible `Book Treatment →` link (→ `#clinic-section`, the site's only
  conversion target — there is no booking/contact page).
- Grid: 3 cols desktop → 2 (≤1024px) → 1 (≤640px); `grid-auto-rows: 1fr` +
  flex cards keep heights equal (measured 364/364/364/364/364/364 px) and
  bottom-align every link.
- Elevation: hover/focus-within animates **shadow + border + accent colour**
  (plus a gentle icon nudge) — `transform` is reserved for the one-shot
  entrance so the entrance stagger delay (`--d`) can never lag the hover.
- Entrance: `html.js-anim` gate (set only when JS runs *and*
  `prefers-reduced-motion` is not `reduce`), one-shot IntersectionObserver
  (threshold 0.12, −6% rootMargin) adds `.is-visible` per card and
  **disconnects when all six are revealed** — no replay on reverse scroll.

## Files changed

| File | Change |
|---|---|
| `index.html` | `#svc-bloom` div inside `#clinic-section`; new `#services-section` (header + 6 cards, inline SVGs) after it; `style.css?v=17`, `script.js?v=14` |
| `style.css` | One appended, self-contained block: overlap/padding, header, grid + breakpoints, cards, entrance states (js-anim-gated), bloom, reduced-motion overrides. **No existing rule touched.** |
| `script.js` | Additive: service refs + `js-anim` flag, `measureServicesTransition()`, `setSvcHeader/clearSvcHeader`, `updateServicesTransition()`, `initServicesReveal()`; integrated as step 3 of `handleScroll` (after the bridge), one measure call in the resize listener, init + `load` + motion-preference listeners. **`measureBridge`/`updateSectionBridge` untouched.** |
| `TRANSITION-NOTES.md` | This section. |

## Testing (headless Chrome 155, CDP — 71/71 checks pass)

- **Geometry:** hand-off window = exactly 100vh, closes at clinic unpin,
  reading budget after the transition = 43vh (desktop) / 60vh (tablet),
  no overlap with the hero bridge.
- **Transition values** at t = 0 / 0.5 / 1: scene opacity, pointer-events,
  canvas push, bloom envelope and header stagger all match the formulas;
  row-1 cards reveal inside the window, row-2 just after.
- **Full forward + reverse scrub** (16 marks incl. instant jumps down/up):
  every value reversible, no stale state, **zero page/console errors**.
- **Existing bridge unchanged:** crossfade 0.5, bloom 0.34, settle scale
  1.0113 at the hero→clinic midpoint.
- **Accessibility:** `Book Treatment` reachable by keyboard Tab, visible
  3px focus ring, `focus-within` elevation + accent title confirmed.
- **Responsive:** 3/2/1 columns at 1440/1100, 1024/768, 390 — window stays
  100vh after every resize; screenshots verified desktop/tablet/mobile.
- **Reduced motion:** no `js-anim`, cards/header at opacity 1, bloom 0,
  no camera push — the essential scene fade still runs (else the page
  would stay hidden); normal motion restored when emulation is removed.
- **Progressive enhancement:** with the enhancement class removed (simulated
  no-JS), all cards + header render visible, six links present.
- Visual captures at hand-off end / mid-transition / arrival match the
  reference screens (pill label, heading, description, card layout).

## Remaining limitations

- `Book Treatment` scrolls to `#clinic-section` — the site has no booking or
  contact destination yet; point these links at `#book`/a form when one exists.
- One pre-existing `favicon.ico` 404 (the page declares no icon) — unrelated
  to this change and present before it.
- The clinic's final frames are pre-rendered, so the "camera push" is a
  transform on the frame (as in the hero bridge), not a real 3D move — by
  design, per the existing architecture.

---

# Phase 4: Visit Our Clinic Section

> **Superseded (Phase 9).** The section was redesigned — the palette, the card
> treatment and the hours content below are historical. See
> *Phase 9: Visit Our Clinic, redesigned + the footer* at the end of this file for
> what the section does now.

A fourth, fully additive section (`#location-section`) added in plain flow
directly after `#services-section`. No overlap, no scroll driver, no pinned
viewport — two **light** content sections meet naturally, so the transition is
continuous background (`#f8fafb` → `#f8fafb`) plus a one-shot entrance in the
services section's own language. The completed hero, clinic, services and
bridge animations are untouched.

## Layout

- **Two columns** on desktop (`minmax(0, 1fr) minmax(0, 1.08fr)`, gap
  clamp 28–48px, content width 1240px like the services section); **stacks to
  one column at ≤1024px** (tablet + mobile), verified at 1440/768/390.
- **Left — information card** (white, same border/radius/shadow language as
  the service cards): `Location & Hours` pill (reuses `.services-eyebrow`
  verbatim) → `Visit Our Clinic` h2 → three icon rows —
  **Clinic Address** / **Working Hours** (+ "Continuous emergency assistance"
  note) / **Direct Phone** (`tel:+923348289596`, visible
  "+92 334 8289596") — then the prominent `Get Directions on Google Maps`
  pill button (`target="_blank" rel="noopener noreferrer"`, exact supplied
  URL). `margin-top: auto` pins the button to the card bottom while the grid
  row stretches.
- **Right — embedded map**: `<figure>` with a `.location-map-frame`
  (position:relative, min-height 480/380/300px desktop/tablet/mobile) and an
  absolutely filling iframe — the map always fills its column regardless of
  the row height. `figcaption` repeats the clinic's full address.
- Keyless embed: `https://www.google.com/maps?q=<full clinic address>
  &output=embed` (the standard embed, no API key). `loading="lazy"`,
  descriptive `title`, `referrerpolicy="no-referrer-when-downgrade"`,
  `allowfullscreen`. **No coordinates invented** — the query is the supplied
  address string; screenshots confirm Google resolves the labelled marker
  "Dr. Syed Hashim Jamshed Bukhari…" at KDA Gate 2, Kohat.

## Entrance (progressive enhancement only)

- One-shot IntersectionObserver (threshold 0.08, −10% rootMargin) adds
  `.is-visible` to the section once and disconnects — the info card and map
  stagger in via CSS `--d` (0 / 120ms), never replaying on reverse scroll.
- Hidden states exist only under `html.js-anim`; reduced motion or no
  `IntersectionObserver` → section shown immediately (motion-change listener
  covered by the existing `js-anim` toggle).
- Without JavaScript the whole section — links, `tel:`, map iframe — renders
  and functions normally.

## Files changed

| File | Change |
|---|---|
| `index.html` | New `#location-section` (card + map figure, inline SVGs) after `#services-section`; version bumps `style.css?v=18`, `script.js?v=15`. |
| `style.css` | One appended, self-contained block (columns + stack, card, rows, phone, button, map frame, js-anim entrance, reduced-motion). **No existing rule touched.** |
| `script.js` | Additive only: `locationSection` ref + `initLocationReveal()` + one init call. **No scroll handler, measure or bridge/services code changed.** |
| `TRANSITION-NOTES.md` | This section. |

## Testing (headless Chrome 155, CDP — 87/87 checks pass)

- Full previous suite (geometry, t=0/0.5/1 values, forward+reverse scrub,
  keyboard, responsive, reduced motion, no-JS) **still green** — nothing
  regressed; page grows 10468px, services reading budget unchanged at 43vh.
- **Content:** heading, labels, address, hours, note, phone text + `tel:`
  href, directions text + exact URL + `_blank`/`noopener`, iframe
  title/src/`loading=lazy` — all exact.
- **Layout:** 2 columns side by side at 1440×900 (map ≥460px tall, iframe
  matches frame); 1 column stacked at 768×1024 and 390×844 (map ≥290px).
- **Behaviour:** entrance fires once on scroll into view (computed opacity 1);
  phone + directions button reachable by keyboard with visible 3px focus
  rings; simulated no-JS renders card + map fully visible.
- **Console:** zero page errors across the whole run (only the pre-existing
  `favicon.ico` 404, ignored); map embed loads and renders (screenshots
  desktop/tablet/mobile verified).

## Phase 6 (revised) - Services artwork swap + layer parallax

The Services stage now uses the supplied
**`Glossy Tooth with Aqua Splash and Tools.png`** (1024x1536, transparent:
48% of pixels fully transparent, content box 33,143..997,1456) as the real
asset. The previous keyed `services-tooth-glow.png` is retired: moved out
of the site, backed up in the temp dir, no reference left in the markup.

- **One picture, never re-drawn.** The flat PNG is the base layer (an
  `<img>` with `width`/`height` 1024/1536, 100% of its box). No card,
  border, background or container is drawn behind it, so its transparency,
  gloss and proportions survive untouched at every size.
- **Five bubbles / droplets move on their own layers.** Each is a copy of
  the same file masked with a `radial-gradient`, and every mask's outer
  stop was pixel-verified to land in fully empty background (0.00-0.01%
  busy, max alpha <= 60). The base layer carries the exact inverse of each
  mask (`mask-composite: intersect`), so base + floats recompose into the
  original file: at rest the stage shows the artwork itself, hole-free.
- **All motion is a pure function of scroll progress.** Each bubble is a
  sine of progress with its own frequency, phase and amplitude (6-9px in
  X, 11-19px in Y, up to 2.6deg, 3.5-5.5% scale); the halo trails at
  another rate; the scene drifts on Y with a fractional roll. Reverse
  scrolling rewinds every value exactly, and the element's
  `transform-origin` sits on the tooth, so the splash and the tools around
  the edges drift ~3-4px further than the tooth - a single-layer
  differential parallax.
- **Stated limitation.** The mirror, probe, toothbrush and pick are fused
  to the splash and the tooth in this flat file: every candidate mask band
  crossed their high-contrast edges (measured 30-45% busy), so lifting
  them onto their own layers would visibly tear the artwork. They
  therefore keep the scene's differential drift instead of an independent
  float. True per-tool motion needs a layered source file (or an inpainted
  base), not a different CSS trick.
- **Palette / geometry.** The stage gradient is the hero frames' own tones
  (`#0d332c -> #0a2a26 -> #061a18`, with the hero's `#184838` modal tone and
  a soft aqua bloom), so the clinic-to-services hand-off still dissolves into
  the same environment. The artwork is portrait (`min(76vh, 740px, 64vw)`
  tall, aspect 1024/1536) and sits on the stage's centre line for the whole
  sequence: it falls in, lands, and is lifted away from there. Mobile,
  reduced motion and no-JS keep the plain stacked layout with all layers at
  rest (the ambient keyframes are switched off under
  `prefers-reduced-motion`).

## Phase 6b - the scroll-driven sequence (fall -> land -> lift)

One pinned stage, one scroll timeline, everything a pure function of progress
`p` (`clamp01((scrollY - trackTop) / (trackHeight - vh))`), memoised on the
last value written. The track is **460vh**: a 100vh stage plus **360vh of
travel**, so one progress unit is 3.6vh of scroll - about **50vh of scroll per
service** (its `0.14` window, with the cross-fade inside it spanning ~20vh) and
~76vh for the drop and the bounce. That is the runway the timeline actually
uses: the fourth card settles at `p = 0.93` and its reveal completes at `p = 1`,
exactly when the pin releases, so no part of the track is left with nothing to
drive. It used to be 560vh - the extra 100vh was travel past the end of the
timeline that only served to keep scrolling after the last card had finished.
Do not shorten it much further: below ~50vh per service the cross-fade starts
to read as a jump cut. `index.html` carries a
cache-buster on `style.css`/`script.js` - bump it after every edit round or
the browser (and every headless probe) reads stale code.

### The beats

| p | what happens |
|---|---|
| `0` | composition waits at `-94vh`, translated clear of the stage and clipped by it; no panel on screen |
| `0 -> 0.145` | the fall: cubic acceleration with a soft cushion over the last 15%, so it decelerates into the landing |
| `0.145` | **contact**: squash peaks (aspect 1.0464 = wider than tall), water erupts (droplet spray + ripple rings + impact bloom) |
| `0.145 -> 0.21` | the damped bounce (`3.4vh` first hop, `exp(-2.3t)·|sin(2.6πt)|`), the squash is released over the first hop |
| `0.21` | the lift takes over; deformation is **exactly** back to the artwork's own shape |
| `0.44 -> 1.0` | the four services arrive one at a time while the tooth rises and shrinks gently |

Reveal stations are `SVC_SCENE_LEAD + (i + 0.5) * SVC_SCENE_SPAN` = **0.51,
0.65, 0.79, 0.93**, with the composition always on the centre line (`x = 0`,
|roll| <= 0.22deg) and monotonic lift after the bounce.

### The panels are overlays on the tooth

Each card is positioned over the artwork rather than parked in the band beneath
it, and both halves of that are measured: the card **crosses** the artwork's ink
box (227px of overlap at 1440x900 - the full height of the card) while still
leaving the crown and the water above it and the roots and the basin below it in
view. At the four stations on a 1440x900 stage that reads 141 / 136 / 134 / 131px
of tooth above the card and 141 / 129 / 121 / 114px below it, tightening as the
composition rises and shrinks. The panels were already painted above the artwork
(`.services-scenes` z-index 4 over `.services-tooth` z-index 2); the tooth is
never hidden, only seen **through** the glass, which is why the pinned card's
own tint drops to 0.66/0.40/0.14 over a 0.52/0.42 base with a 22px
`backdrop-filter` blur - the artwork behind the copy becomes a soft glow instead
of a hard edge (`backdrop-filter` samples the tooth: it is painted beneath the
panels in the same stacking context).

The copy still has to win against that glow. It does it two ways that were
measured rather than eyeballed: the left-weighted scrim stays the anchor for
legibility, and the pinned copy carries a tight dark `text-shadow` on top of the
wide one. Perceived contrast was taken from three frames at the same station -
normal, glyph fill transparent (glass + shadow), and copy hidden - so the
backdrop measured under the glyph pixels is the one the eye gets, with no credit
taken for the glyph colour: **4.8-5.8:1** for the body copy and **10-14:1** for
the titles and links at 1440x900, 1366x768 and 641x900 (WCAG AA normal text is
4.5:1). No copy colour was changed.

The mobile stacked layout is untouched: below the pin threshold the cards sit in
flow under the artwork as they always have, because four cards cannot overlay a
281px-wide tooth without covering it completely.

### The hand-off between panels

A staggered cross-fade, never a plain one: the outgoing panel falls over
`SVC_SCENE_FADE` starting at its station, the incoming one rises over the last
half of that window, so the stage is never empty and never double-exposed -
measured `alphaSum` is 1.00 at every station and 0.65 mid-hand-off
(0.16 outgoing / 0.48 incoming), and the active panel is `max(alpha)`. Over the
tooth that drift reads as one glass slate sliding up across the artwork and
swapping its copy as it goes, rather than a second card appearing. The
drift flips sign at each scene's centre, where it is already ~0, so scrolling
back rewinds every value byte-identically. Panels are **never**
`visibility: hidden`: all four "Book Treatment" links stay in the tab order at
all times, interaction is gated by `pointer-events`, and the focus bridge
scrolls `svcPinStart + station * svcPinDist` when a link is focused - verified
for all four (p = 0.51 / 0.65 / 0.79 / 0.93, active scene tracks focus).

### The impact deformation

Three beats, all resolving to exactly 1.0 so every settled pose is the
artwork's own shape (`sx = sy = s`, checked at p = 0.21 / 0.4 / 0.7 / 1.0):

- while falling it elongates (peaks ~1% taller around p = 0.10);
- the elongation is **spent by** the moment of contact, and contact then
  flattens it (4.6% wider), so the two never fight on the same frame;
- the rebound stretches it again (~2% at p = 0.177) and everything is back to
  exactly 1.0 at the lift.

`svcShape` (width 0.016) is a deliberately tighter pulse than the water's
`svcShock` (0.030): the rigid tooth's own deform is a sharp contact event
while the water keeps reacting over a wider window. Continuity was checked
numerically - the largest step between samples shrinks ~10x when the step
shrinks 10x, i.e. no jumps anywhere, including the lift handover frame.

### Living water

41 droplets on two emitters (a basin fan of 18 half-behind the artwork, a
crown eruption of 14 all in front with 2 hero drops, plus 9 trail drops),
every one a true parabola (`g = 2·|vy|`) anchored at
`svcToothState(d.t0)`, seeded by a deterministic LCG so the whole splash is
reproducible. 30 ambient CSS animations run underneath (two caustic sweeps,
the flowing splash, 16 sparkle twinkles, 11 rising bubbles), all on the
two-layer rule: the outer `<span>` gets the scroll-driven transform, the
inner `<i>` carries the ambient keyframes. Peak spray is 33 droplets at
p = 0.21, retracted to 0 by p = 0.44.

### Anchor, indicator and bridges

- **Panel anchor.** `--svc-panel-top` is measured, not hand-tuned: the pose at
  the first reveal (`svcToothState(SVC_SCENE_LEAD)`) plus `0.0205 * h * s`, and
  it is the card's **centre** - the scene transform carries the `-50%` that
  makes it so. `0.0205` is the artwork's ink centre as a fraction of its box
  (the ink spans 0.0931-0.9479 of the PNG's height, so its centre is 0.5205),
  measured from the artwork itself rather than eyeballed. Taking the *first*
  reveal's pose matters: anchored on the settled pose the card would sit 8px
  high at the first station (296px -> 288px at 1440x900). The card then never
  moves with the tooth, so the crown margin only opens up as the composition
  rises while the roots margin tightens as it shrinks.
- **Progress indicator.** Four dashes at the stage's **bottom** centre, not
  the top: the fixed navbar owns the top 67-91px of the stage and the
  artwork's own jet rises through the top centre. With the cards moved up onto
  the tooth that band is deeper than it has ever been - measured minimum
  **299px** of clearance across the pinned viewports, including while a panel
  drifts in, so the indicator can never be touched.
- **Keyboard bridge** (above) and a **nav bridge**: the navbar's "Services"
  link still points at `#services-section`, but that box starts at the top of
  the section's 124vh lead-in, where the clinic scene is still cross-fading
  out and no services are on screen yet. A delegated click handler moves only
  the destination, to the section header (measured: scrollY 8424, header
  252-401, stage begins at 450) while keeping the same href, the same hash
  (`history.pushState`), the same history entry and full no-JS behaviour;
  modifier clicks are left to the browser.

- **Section length.** The section is sized to the timeline, not padded out: the
  pin runway is 360vh of travel (the fourth card's reveal completes exactly as
  the pin releases) and the only space after the cards is
  `clamp(40px, 5vh, 60px)` of section bottom padding - the breath between the
  dark stage and the dentist section. The bottom padding used to be
  `clamp(96px, 13vh, 132px)` on top of a 560vh track, which left ~1300px of
  scroll (a viewport and a half) after the last card had finished and made the
  page read as trailing off. Nothing moves: the top padding (the 124vh clinic
  lead-in) is untouched. On the stacked layout the artwork's own trailing
  inset is deliberately smaller underneath (`clamp(12px, 2vw, 24px)`) than
  above, so the section ends shortly after the last card there too - measured
  **+53px** from the last card to the section's end at 390x844. Note the
  ~491px of teal below the card inside the pinned stage is *not* spare
  padding: the stage fills the viewport and the cards sit on the tooth's ink
  centre near the top third, so that band is the composition. The 100vh of
  scroll after the pin is the full-viewport sticky stage leaving the screen -
  a sticky pin always needs its own height to clear, and shortening the track
  does not change it.

Verified: **176/176 harness checks**, including 13 viewports (1920x1080 down
to 360x800), reduced motion (no pin, no particles, no ambient loops, all four
cards readable), blocked JS (all four readable, copy intact, no overflow),
reverse scroll (byte-identical state), keyboard journey through all four
links, the nav jump, and the impact frames. Zero horizontal overflow and zero
console errors in every configuration. Worst-case clearances across 12 pinned
viewports, sweeping every 1% of the pin while a panel is legible (alpha >= 0.35,
which is what catches the ±34px drift rather than only the stations):
**crown + water >= 20px and roots + basin >= 14px around the card, 641x900 and
up >= 40 / 31px**, and the progress dots >= 299px clear of it.

The one tight tier is 1440x630 - a wide, very short window, where the artwork's
ink is only 262px tall against a ~200px card, so ~30px a side is all the
geometry has to give and the crossfade drift eats into it. It lands at ~57%
panel opacity, i.e. while the card's edge is soft; no anchor can do better,
because biasing the card just trades crown for roots. Fixing it properly would
mean either a smaller card (more type changes, worse readability) or a larger
artwork box on short viewports (`--svc-tooth-h`'s `max(220px, 190vh - 840px)`
cap existed to reserve the band beneath the tooth that the overlay no longer
needs), and both are outside this change.

## Remaining limitations

- The Google Maps iframe requires network access; offline it shows the
  browser's load-error state — the `figcaption` + directions link still give
  the full address and a working fallback.
- Map tiles/styling are Google's; the embed shows Google's own "Open in Maps"
  affordance and attribution inside the frame.
- Reading budget after the pinned services track is measured to the dentist
  section top (the pin itself holds the four services on screen for 360vh of
  travel, ~50vh each) — the dentist and location sections continue below, so
  the page never ends on empty space.

# Phase 8: Meet Your Dentist - dark cinematic glass stage

Scope: `#dentist-section` only, plus the seam it shares with the services
section above it. Hero, services artwork, clinic, location and navbar were not
touched.

## Why the stage is dark

The brief asked for a cinematic, reference-style stage with visible smoke. Two
constraints decided the palette: the section sits between two `#f8fafb`
neighbours (services above, location below), and white/aqua smoke is invisible
on a near-white surface by construction. A dark stage was chosen, built from the
site's own hero/clinic colours - `#061a18` / `#071913` / `#0a2a26` depth, aqua
`#2dd4bf` / `#5eead4` / `#7cecc9`, mint `#a7f3d0`, sky `#38bdf8`. No new colour
was introduced and no green was copied from the reference image. A 52px gradient
fade at the top and bottom of the section carries the page in and out of the dark
stage; the strip of light that remains on the left edge belongs to the services
section's own padding and is outside this section's box.

## No portrait assets exist - nothing was invented

The reference shows fictional dentists with stock portraits. This project has no
photographs of either doctor - only the hero/clinic frames, the tooth artwork and
the user's reference PNG - so both cards keep a typographic monogram (`SHB`,
`AK`), `aria-hidden` with the name given as text beside it. A female portrait,
an AI face or a placeholder for Dr. Aleena Khan would all have been an invention,
so both profiles are deliberately consistent: monogram, name, designation, copy.
`.dentist-avatar` is the single element to swap if photos arrive later.

## Owner copy: moved, never deleted

The old light section carried real owner content. All of it survives verbatim
inside the two `<dialog class="dentist-dialog">` profiles, which is also where the
brief asked the "View Profile" button to lead:

- "B.D.S &middot; Dental Surgeon &amp; Orthodontist" and the "(Ex-MS LMH Kohat)"
  credential on the primary card;
- "Dedicated to Gentle, High-Precision Family Dentistry" and the Kohat bio
  ("...state-of-the-art dental procedures using digital diagnostic scanners and
  hospital-grade sterilization...");
- the "Sterilization First" panel ("Multi-stage autoclave sanitation for patient
  safety."), the "Wheelchair-accessible clinic" chip and the "Expert Dental
  Solutions in Kohat City" chip;
- `tel:+923348289596` (+92 334 8289596) - the call CTA and the number, on both
  profiles. The links live in the closed dialogs too, so the section still
  exposes all four `tel:` links to crawlers and to `querySelectorAll`.

The prominent "call to book" CTA now sits behind the "View Profile" click. That
ordering was the user's explicit choice (clean reference-style cards first).

## The glass

Dark frosted panes: a base scrim of the stage's own deep teal
(`rgba(5, 22, 20, 0.74)`), a thin translucent white gradient over it, a 1px aqua
rim, an inset top highlight, an inset aqua floor wash inside the pane, a depth
shadow and an outer aqua halo - `backdrop-filter: blur() saturate()` for real
frosting. The scrim is not decoration: the beams and the bloom behind a pane can
otherwise push the blurred backdrop bright enough to cost the copy its contrast,
and the reference's panes are dark glass anyway.

The base rule *is* the front pane (bright rim, strong glow, sharp). `.is-away`
dials every one of those values down - dimmer rim, weaker halo, deeper scrim,
`opacity: 0.94`, `blur(1.3px)` - so whichever doctor is in front automatically
wears the prominent glass and the other automatically becomes the companion.
There is no separate "primary card" style any more.

## The two-profile carousel

`.dentist-carousel > .dentist-track` is a one-column grid and **both panes sit
in `grid-area: 1 / 1`**, so the track's height comes from its content (no JS
measuring) and the panes stretch to equal height. `perspective: 1700px` with
`perspective-origin: 50% 46%` sits on the track - the panes' direct parent -
rather than using `transform-style: preserve-3d`, so the painting order is
explicit (`z-index` 3 for the front pane, 1 for the companion) and the panes'
`backdrop-filter` is never nested inside a shared 3D context.

Each pane reads its pose from custom properties: `--tx/--ty/--tz/--ry/--sc/--op/--bl`.
The front pane is all zeros; `.is-away` is
`--tx: var(--away-x, 520px)`, `--ty: -8px`, `--tz: -260px`, `--ry: -7deg`,
`--sc: 0.9`, `--op: 0.94`, `--bl: 1.3px` - real depth (a Z push under a real
perspective, a small Y rotation) rather than a flat offset. The 1700px
perspective scales the away pane's `translateX` by about 0.867, so 520px lands
≈451px on screen and clears the 480px front pane with a 22px gap at 1440px:
measured away pane 982..1366 against a front pane ending at 960, and
`scrollWidth == innerWidth`.

Switching the front pane happens four ways: a click on the pane behind (ignoring
the "View Profile" button and links), the indicator dots, ←/→ when focus is in
the dots, and a single-finger horizontal swipe (more than 40px and more than
1.4x the vertical delta, passive listeners, `touch-action: pan-y`). The two dots
are plain buttons with `aria-label` and `aria-current` - not a `role="tablist"`,
because panel-switching semantics would imply tabs while both doctors stay in
the DOM and readable - and each carries an invisible 30x50 hit area so a hairline
pill is still a touch target. Both panes stay in the DOM at all times, so no
content is ever hidden behind a selector.

## The stage: beams, fog, floor

Behind the panes (all `aria-hidden`, all clipped by the section's
`overflow: hidden`): three soft light shafts, two blurred fog blooms, and a floor
- a wide aqua light pool plus a sheen and light-pool pair painted on
`.dentist-track::before/::after` so the reflection always sits exactly under the
panes. Everything is a gradient, opacity and blur; there is no canvas, no shader
and no animation loop anywhere in this section.

## The Z arrival (one shot, no replay)

Gated on `html.js-anim` only, so reduced-motion and no-JS visitors get the
finished layout. Under `#dentist-section:not(.is-visible)` the front pane sits at
`translate3d(0, 40px, -560px) scale(0.86) blur(12px) opacity 0` and the companion
deeper still (`translate3d(var(--away-x), 32px, -780px) rotateY(-7deg) scale(0.8)`).
The two rule sets are structurally identical, so the browser interpolates them
and the pane flies forward along Z instead of snapping. The arrival timing (with
the `--d` stagger) applies only while `#dentist-section.is-visible:not(.is-settled)`;
once both panes have landed, JS adds `.is-settled` to swap in the quicker
switch transition. `dentSettle` re-declares the full pose transform from the
pane's own custom properties, so the settle can never jump a pane back to the
origin, and `.is-landed` removes it on `animationend` (900ms fallback). The
reveal is one-shot: the observer disconnects, `.is-visible` is never removed, and
reverse scrolling cannot replay it.

## The one-shot burst

Fires exactly when a pane's transform transition ends (`transitionend`, property
`transform`, target === pane), never on a guessed timer - so it can only ever
happen as a pane lands, and each pane fires its own as it lands (about 150ms
apart, so both bursts coexist for two seconds). `script.js` builds 11 soft puffs
plus 3 motes per pane from a fixed table: low corners and sides carry the burst,
plus one thin haze below the bottom edge. Geometry is pane-relative percentages,
so the burst hugs the real pane box at every width. Each puff is a radial
gradient blurred on its own element (per-puff `--bl`), animated only through
`transform` and `opacity`, so nothing repaints and nothing clips on the way out.
Tints are brand only: white glass, aqua `rgba(94,234,212,..)`, sky
`rgba(125,211,252,..)`, mint `rgba(167,243,208,..)`, ice `rgba(203,238,255,..)`.
The host sits at `z-index: -1` inside the pane's own stacking context, so mist is
painted above the glass and below every word - it can never cross the names,
roles, copy or buttons. The burst is torn down 2400ms after it starts (host
emptied, `.is-smoking` removed, a per-host timer cancels any earlier teardown)
and can never replay. Switching the front pane fires a smaller accent burst on
the arriving pane.

Measured with every puff frozen at its bloom (1440x900): host opacity 1, max puff
opacity 0.62, 22/22 puffs above 0.25, bounds reaching 228px past the left pane
edge, 842px across the pair to the right, 183px below the panes, widest puff
289px (soft and diffused - not a solid cloud), and 0 puffs / 0 motes / empty
hosts once the real 2.4s teardown ran.

## The continuous drift

Eight slow plumes per pane (durations 19-28s, eight distinct values, negative
delays so they start mid-cycle) at 0.24-0.74 peak opacity, blurred 10-20px. Each
one is a chain of lobes with a lit crest, given an initial tilt so its ellipse
reads as a diagonal curl, and the keyframes grow, lift, curl and fade it along
its own vector - a four-stop breath rather than a loop that visibly restarts.

The cores sit outside the pane, so the smoke hugs the glass without ever sitting
between a reader and the words. The three plumes on the *right* of the front pane
are deliberately small and dim (0.24-0.34 opacity): the companion is only 22px
away, so a full-strength curl there would be painted over the companion's glass
(the front pane has the higher `z-index`) and cost the companion its contrast
while being barely visible anyway. The left edge and the floor line carry the
look, exactly as the reference does.

Measured contribution, front pane with the drift hidden versus shown (0-765
scale, summed over RGB): left strip max delta 221, right strip 204 - the smoke is
clearly there and clearly still soft.

## Performance

Both the drift and the beam sweeps run only while the section is a live
IntersectionObserver target (`.is-awake`). Off screen the drift is
`display: none`, the beams are `animation-play-state: paused`, and
`document.getAnimations()` reports **0 running animations inside the section** -
verified. Particles are a small fixed count, all motion is
`transform`/`opacity`/blur, and there is no rAF loop, no canvas and no filter on
an animating ancestor.

## Responsive / reduced motion / no JS

Phones (<=640px): a shallower flight (`-300px` / `-420px`, blur 7px), 9 puffs
instead of 11 with no motes, 6 plumes per pane, no second fog bloom and no
sweeping shafts. Tablets (<=1024px): the front pane stays centred and the
companion tucks in *behind* it (`--away-x: 22px`, a 1300px perspective), so the
pair reads as a deck instead of risking a row that cannot fit.
`prefers-reduced-motion`: no flight, no settle, no drift, no burst - smoke, drift,
beams, fog and pool are all removed, both panes stack as full-width cards at
opacity 1 with no blur and no transform, and the dots go with the motion. No JS:
the whole section renders finished, both full profiles are shown inline
(`html:not(.js) .dentist-dialog { display: block }`), the inert "View Profile" /
close buttons and the dots are hidden, all four `tel:` links are present and there
is no horizontal overflow.

## The services → dentist seam (the gap fix)

> **Revised (Phase 10).** The overlap and the top padding were retuned - 260px to
> 120px, and the padding's constant from `clamp(96px, 12vh, 148px)` to
> `clamp(48px, 6vh, 72px)` - because opening the section left the label 368px down
> an empty dark stage. The mechanism described below is otherwise exactly as built;
> see *Phase 10: the top of "Meet Your Dentist", retuned* at the end of this file.

The services slot ends in a 100vh sticky stage, so the last ~300px of its 460vh
track are empty air below the fourth card - a dead stretch of dark between the
two sections that the brief asked to close. Two changes, both scoped:

- `#services-section` loses its `padding-bottom` (it was 40-60px of nothing after
  the pinned track). Nothing inside the section moves; the page below simply
  starts 45px higher.
- `#dentist-section` gains `--dent-overlap`: `0px` normally, `260px` under
  `html.svc-cinematic`. The section then uses
  `margin-top: calc(var(--dent-overlap) * -1)` with
  `padding-top: calc(clamp(...) + var(--dent-overlap))`, so the *stage* reaches up
  over the slab's empty tail while the header and panes keep exactly the document
  position they had - measured stage top 12754 against a slab bottom of 13014,
  header still at 13122, i.e. 108px below the slab. `z-index: 2` puts it over the
  slab, and the white top fade is replaced (under `svc-cinematic`) by a 168px
  dark band painted from `#061a18`, the slab's own bottom colour, which hides the
  top bloom and blocks light spilling up over the services stage. Slab and band
  are the same colour, so the hand-off has no visible seam.

`--dent-overlap` is 0 on mobile, under reduced motion and without JS, because
`html.svc-cinematic` only ever applies to the pinned layout above 640px with
motion allowed - so no other configuration pays for this.

## Readability (measured: screenshot decoded in-page, sampled *behind* the type)

The earlier pass sampled 12px beside each block of copy, which reads the clear
glass next to the words rather than what they sit on - it would never catch a lit
plume washing behind the type. This pass hides the glyphs instead (an injected
rule blanks their colour, their gradient text fills and any decorative
pseudo-element, while the boxes, the glass and the smoke all stay) and samples a
grid of points inside each block, with the smoke running and again with the burst
frozen at its bloom.

Worst case at 1440x900:

- settled header: eyebrow 7.65:1, title 9.05:1, intro 6.98:1
- settled panes: front name 8.97:1, front role 8.61:1, front description 8.82:1,
  View Profile 8.71:1, companion name 11.55:1, companion role 6.72:1,
  companion description 8.91:1
- burst at its brightest: front description 7.81:1, companion description 6.78:1,
  View Profile 5.33:1
- profile dialog: name 11.74:1, role 9.43:1, bio 10.97:1, feature title 12.02:1

Re-measured independently at 1440x900, 1024x800 and 390x844 with the drift
running: every text block in the section clears AA (4.5:1) at all three widths.
The base scrim and the companion's deeper scrim are what buy that margin - the
stage behind a pane carries light beams, and without them the blurred backdrop
alone could reach ~2.6:1 under the dimmer companion copy.

## Verified

- `dent-qc2.js`: **100/100** - structure and verbatim copy (names, designations,
  credentials, tagline, bio, sterilization panel, chips, four `tel:` links, no
  `img` and no photographic `background-image` anywhere in the section), the
  pre-flight/mid-flight/landed states of the Z arrival, that the front pane lands
  at rest and the companion lands smaller/dimmer/blurred/offset with the front
  pane centred on the track, the burst's one-shot animation, palette-only tints,
  `z-index: -1` layering behind every word, geometry, the real teardown, no
  replay, the continuous drift, zero running animations off screen, dot and
  pane-click switching, the seam invariants, dialog open/ESC/backdrop/focus-return,
  contrast (behind the type), reduced motion, no JS and the 768x1024 and 390x844
  layouts.
- `cdp-dental-test.js`: **180/180** - the full site suite (hero bridge, services
  scroller, clinic, location, navbar) still passes, including the rewritten T17
  carousel invariants at 1440, 768 and 390.
- One real bug was found and fixed during this pass: the site's global
  `* { margin: 0 }` reset removes the UA's `margin: auto` on `<dialog>`, which
  pinned the profile modal to the top-left corner. `.dentist-dialog` now
  re-asserts `position: fixed; inset: 0; margin: auto`, and the probe checks that
  the modal is centred to within 2px on both axes.
- One real legibility bug was found by the behind-the-type measurement: the glass
  was transparent enough that light beams behind a pane pushed the copy down to
  ~2.6:1. The base scrim and the companion's deeper scrim fixed it; the companion's
  right-hand plumes were also pulled in, because the front pane's `z-index` paints
  its smoke *over* the companion, not behind it.
- Zero console errors in every configuration.
- No new dependency: bespoke vanilla JS + CSS only (all inside the existing
  `initDentistReveal`).

## Remaining limitations

- No portrait asset was supplied, so both cards keep a typographic monogram; if a
  photo appears later, `.dentist-avatar` is the single element to swap (same
  circle size, `object-fit: cover`).
- The doctor's call CTA and the qualification / sterilization / wheelchair /
  Kohat copy now sit behind "View Profile" (user-approved). The `tel:` links stay
  in the DOM while the dialogs are closed, but they are no longer visible at a
  glance on the card.
- The stage is dark between two light sections. The 52px edge fades soften the
  handoff; on the services side the pinned slab's own bottom edge (`#061a18`)
  meets a band of the same colour, so the seam itself is invisible - but during
  the services stage's exit the arriving dentist stage does cover the services
  section's decorative `aria-hidden` progress dots for that last stretch. The
  alternative was leaving ~300px of empty dark between the sections, which is what
  the brief asked to remove.
- The front pane is centred on the carousel rather than the pair being centred,
  which is what the brief asked for; the composition therefore reads slightly
  right-heavy, exactly as the reference does.
- On phones the companion sits behind the front pane rather than beside it: a
  second readable column at 390px would have been a column of very small type, and
  the dots plus swipe keep both doctors reachable.

---

# Phase 9: Visit Our Clinic, redesigned, + the premium footer

Scope: `#location-section` only, one new `<footer>` after it, plus the one
padding and the one gradient stop that form the seam between that section and the
dentist stage above it. The navbar, hero, clinic, services and dentist sections are
otherwise untouched.

## The page now reads as three deliberate voices

1. **Teal glass** — services and Meet Your Dentist (dark emerald stages,
   `backdrop-filter`, glow, smoke).
2. **Light paper** — Visit Our Clinic (soft ivory, one solid white panel, hairline
   borders, navy type, a single teal accent). Deliberately shares *nothing* with
   the two glass stages: no translucency, no `backdrop-filter`, no glow, no
   particles, no decorative animation.
3. **Solid navy** — the footer.

The progression only works if step 2 really is a different language, so the
section was rebuilt rather than retinted. The old design reused the services
section's exact card language (white card, 18px radius, sky-blue `#0ea5e9`
accents, the same `.services-eyebrow` pill, the same soft shadow); that is what
made the page feel like one repeated block.

## The light panel

| Token | Value | Used for |
|---|---|---|
| `--loc-ivory` | `#f5f8f7` | section ground |
| `--loc-panel` | `#ffffff` | the one solid surface |
| `--loc-navy` | `#183047` | heading + figures |
| `--loc-slate` | `#526477` | supporting copy |
| `--loc-teal` | `#079eaa` | the signature rule, focus rings, shadow tint |
| `--loc-teal-deep` | `#087e88` | the accent when it carries text |
| `--loc-teal-darker` | `#056a74` | hover |
| `--loc-line` | `#e1e9e8` | hairlines |
| `--loc-chip` | `#eaf7f8` | pale-teal icon ground |

Every token is declared **on `#location-section`**, so nothing here can leak into
the glass sections above.

- **One ornamental mark:** a solid 4px `#079eaa` rule across the panel's top edge
  (`::before`, inside the 14px radius). Solid — not a gradient — and it does not
  glow. It replaces the glow-bordered glass card as the section's signature.
- **Radius 14px**, one step tighter than the glass cards, with a hairline
  `#e1e9e8` border and a restrained neutral shadow
  (`0 1px 2px rgba(24,48,71,.05), 0 22px 44px -34px rgba(24,48,71,.35)`) —
  measured to contain no teal/aqua hue, so there is no "glowing card border".
- **Row icons** sit on 38px pale-teal rounded squares (`--loc-chip`, 10px radius)
  with `#087e88` strokes. Redrawn as line icons (the pin and handset used to be
  solid fills) to match the brief's "simple, modern line icons".
- **The label** is now flat letterspaced capitals with a short teal dash instead of
  the glass sections' pill.
- **Contrast** (measured against the real flat surface behind each run of text,
  not beside it): heading 13.5:1, address/labels 6.1:1, eyebrow / hours accent /
  phone / button label 4.83:1, map caption 5.7:1. Worst in the section: **4.83:1**.

## Working hours: the content had to change, and one claim was dropped

The brief supplied a day-by-day week and asked for it to be displayed
accurately, so `Open 24 Hours / 7 Days a Week` is gone and the section now renders
a seven-row `<dl>`:

`Monday 2 PM – 11 PM · Tuesday 2 PM – 11 PM · Wednesday 2 PM – 11 PM ·
Thursday 3 PM – 11 PM · Friday 2 PM – 11 PM · Saturday 9 AM – 11 PM ·
Sunday 2 PM – 11 PM`

The two days that do not start at 2 PM (Thu 3 PM, Sat 9 AM) are the only teal
figures in the table. The owner's existing "Continuous emergency assistance" line
is kept verbatim, prefixed with the now-verifiable "Open 7 days a week".

**Deliberate deviation:** the footer brief also listed `Open 24 Hours / 7 Days a
Week`. Since the same page now states the clinic closes at 11 PM, that line would
have contradicted the section directly above it, so the footer says
`Open 7 days a week` + the real daily ranges instead. Half of the requested string
is kept; the factually wrong half is not. Say the word and it can go back.

## The button, and why it is `#087e88` and not `#079eaa`

White on `#079eaa` is **3.24:1** — under AA for a label, and the label is not
large enough to qualify for the large-text exemption. White on the palette's own
"deeper teal" `#087e88` is **4.83:1**, and hovering to `#056a74` only improves it.
So the button surface is `#087e88` (still unmistakably the teal button the brief
asked for, and still the brief's own colour — it is listed as the hover accent).
`#079eaa` has not gone anywhere: it is the top rule, the eyebrow dash, the icon
chips' border, the focus rings and the button's shadow tint.

## The map

Unchanged and still live, keyless and labelled — the same `output=embed` URL (a
real Maps query naming the clinic and the KDA Gate 2 address), the same title, the
same `loading="lazy"`, the original controls, attribution and marker. What changed
is only the container: solid white with a hairline `#e1e9e8` border and a neutral
shadow (previously a teal-glow border), 14px radius, and the iframe filling it.
It **stretches with the panel** (`align-items: stretch` on the grid), so at 1440
it measures **634 × 629px** beside a 563 × 678px panel; the frame and the panel
start on exactly the same pixel row and the understated address caption sits
beneath the frame. 440px tall at 768, 384px at 1024, 300px on a phone.

## The footer

Four columns on desktop (measured `297 / 205 / 205 / 267px` inside the same 1240px
content width as every section above), two at ≤1024px, one at ≤640px. Solid
`#183047`, no gradient, no glass.

- **Brand:** the navbar's own tooth mark, `Dr. Syed Hashim Jamshed` /
  `Bukhari Dental Clinic · Kohat`, and the brief's description verbatim.
  **No social row** — the clinic has no verified account URLs, and inventing them
  would ship dead links. The omission is commented in the markup so it is not
  mistaken for an oversight.
- **Quick Links:** Home / About Us / Services / Meet Your Dentist / Contact Us →
  `#hero-section`, `#clinic-section`, `#services-section`, `#dentist-section`,
  `#location-section`. Every one is an anchor that already existed; the probe
  asserts every in-page `href` in the section and footer resolves to a real
  element.
- **Dental Services:** exactly the four services the page actually presents
  (Orthodontic Braces, Scaling & Whitening, Root Canal Therapy, Dental Implants),
  each linking to `#services-section`. Nothing invented.
- **Contact:** the address, `tel:+923348289596`, the hours, and `Get Directions`
  pointing at the same verified Maps URL as the section button, in a safe new tab.
- **Contrast on navy:** white headings 13.5:1, body `#c6d4e0` 8.9:1, muted
  `#9fb4c4` 6.3:1, links/icons `#4fd1da` 7.4:1. The accent here is a **tint** of
  the section teal because `#079eaa` itself is only 4.2:1 on navy — fine for a
  rule, not for 14px link text. Same hue, readable weight.
- Divider + copyright row: `© <year> Dr. Syed Hashim Jamshed Bukhari Dental
  Clinic — Kohat, Khyber Pakhtunkhwa. All rights reserved.` The year is written
  into the markup **and** refreshed by `initFooterYear()`, so it is correct
  without JS and can never go stale with it. No legal links: no privacy/terms
  pages exist to point at.

## The dentist → location seam (the spacing fix, second pass)

Phase 8 tightened the services → dentist seam. This pass tightens the dentist →
location hand-off, which was still carrying 322px from the last doctor pane to the
first line of the location panel (207px of it pure section padding):

| | before | after |
|---|---|---|
| `#dentist-section` padding-bottom | `clamp(104px, 14vh, 168px)` → 126px @900 | `clamp(72px, 9vh, 104px)` → 81px |
| `#location-section` padding-top | `clamp(64px, 9vh, 104px)` → 81px | `clamp(56px, 6.5vh, 82px)` → 58.5px |
| `#location-section` padding-bottom | `clamp(88px, 12vh, 130px)` → 108px | `clamp(56px, 7vh, 88px)` → 63px |
| last pane → first panel pixel @1440 | 322px | **274px** |

The 52px bottom fade inside the dentist stage still fits inside its new 81px
padding, so the dark stage still dissolves into the light section instead of
ending on a hard edge. The fade's own end colour moved from the old `#f8fafb` to
the new ivory `#f5f8f7` — **only the bottom stop**; `--dent-top-fade` stays
`#f8fafb` because the section above it (services) is still that colour. Without
that one-line change there would have been a faint two-value band exactly at the
hand-off.

Nothing else reserves space: `#services-section`'s padding-bottom is already 0
(Phase 8), and the pinned services stage's reserved height is the deliberate
`460vh` scroll driver, not dead margin.

The footer then begins exactly where the location section ends —
`footTop === locBottom` to the pixel, asserted by the probe — so the last thing on
the page is a real element with a real height, not blank space.

## Accessibility, motion and performance

- The one-shot entrance is unchanged in behaviour (`.location-anim` +
  `.is-visible` from the existing `IntersectionObserver`): hidden pre-flight only
  under `html.js-anim`, fires once, never replays, and the observer disconnects.
- **Reduced motion:** the panel and map are at `opacity: 1` with no transform from
  the first frame and the button's hover transition is disabled.
- **No JS:** the section and the footer render complete and visible; the footer
  keeps a valid hard-coded year.
- The footer adds no animation beyond a 180–220ms colour transition on hover, all
  of it disabled under reduced motion. No new dependency, no script beyond
  `initFooterYear()` (11 lines, no listener, nothing to clean up).
- The `<dl>` for the week is a definition list rather than styled paragraphs, the
  two `<nav>` columns are labelled by their own `<h3>` headings, and footer links
  carry padding so every tap target measures ≥25px (the brief's button measures
  45px tall, full-width on phones).
- The page still has **zero horizontal overflow** at 1440/1024/768/390.

## Verified

- `loc-qc.js` (new): **59/59** — the absence of glass and of any gradient surface
  in the section and footer, the ivory/white/#e1e9e8 palette and the 14px radius,
  the 4px `#079eaa` rule, the button and every text colour measured against its
  real flat background (worst 4.83:1, all AA), the seven hours rows and the two
  highlighted starts, the eyebrow/heading/address/note/phone strings verbatim, the
  preserved map embed, the panel+map alignment and the map's size at every
  breakpoint, stacking at 1024/768/390, the full-width button on phones, hour rows
  that never wrap, the one-shot entrance (pre-flight → visible → no replay),
  reduced motion, no JS, the footer's last-child position, navy/no-gradient/
  4-column grid, brand and description verbatim, the exact quick links, the four
  real services, the contact block and both its links, the headings, the live
  copyright year, the deliberate absence of social/legal links, the divider, the
  tap targets, that every in-page link resolves, and zero page errors.
- `cdp-dental-test.js`: **181/181** — the whole site suite, with two checks
  updated for the new reality: **T9** now asserts the page *ends on the footer*
  (`footBottom === viewport bottom`, `footTop === location section bottom`,
  `section bottom = content bottom + its own padding`, footer > 200px tall) instead
  of the old "no blank tail below the location content", which the footer's
  arrival made meaningless; and **T16** now asserts the seven-row hours table and
  the eyebrow label in place of the retired `Open 24 Hours / 7 Days a Week`.
  T16's layout, map, phone, directions, keyboard and 768/390 checks all still pass
  unmodified, as do T11–T18.
- T11/T15 now also ignore `fonts.googleapis.com` / `fonts.gstatic.com` network
  errors. That request intermittently returns `ERR_CONNECTION_CLOSED` in this
  headless environment (the same run reports clean a minute later), and it is
  external CDN availability, not page behaviour — every other error class still
  fails the suite.
- Evidence: `loc-1440/1024/390-section.png` and `-footer.png` (the section and the
  footer at each width), `seam2-1440/1024/390.png` (the dark stage dissolving into
  the ivory), `foot2-*.png` (the footer grid).
- Rollback copies of all three files as they were before this phase:
  `C:\Users\Waqas-PC\AppData\Local\Temp\opencode\loc-backup\`.

## Remaining limitations and decisions to be aware of

- **`Open 24 Hours / 7 Days a Week` is gone** from both the section and the
  footer, replaced by the supplied day-by-day hours (see above). If the clinic
  really is open around the clock, the supplied table and that line need
  reconciling — the page currently states one or the other, not both.
- The footer's teal is `#4fd1da` (a tint) rather than `#079eaa`, purely so link
  text clears AA on navy. Visually it reads as the same family.
- The map is 629px tall at 1440 because it stretches to match the panel, which is
  itself tall because seven hours rows are now on the page. It is prominent, as
  asked; if a shorter map is preferred, capping `.location-map-frame` with a
  `max-height` is a one-line change, at the cost of the two columns no longer
  matching in height.
- The old `.dentivo-footer` CSS block (lines ~1172–1230) is left in place as dead
  code from an earlier design. The new footer uses a fresh `.site-footer` prefix,
  so the two cannot collide — but the dead block is still worth removing whenever
  someone next touches the stylesheet.
- Pre-existing and still out of scope: no-JS never gets the navbar's
  `.nav-scrolled` state; no `<main>`, skip link, JSON-LD or favicon; only one
  footer-level legal page exists (none).

# Phase 10: the top of "Meet Your Dentist", retuned

## What the reader saw

Opening the section - clicking **Doctor Profile** in the navbar, or scrolling down
to it - put the label 368px down a 1440×900 viewport (356px at 1024×800), with
nothing above it but empty dark stage. That is what "excessive vertical whitespace
at the beginning of the section" is here: not a stray spacer element, but the two
numbers that make up the section's top padding.

## Where it actually came from

`#dentist-section` pairs `margin-top: calc(var(--dent-overlap) * -1)` with
`padding-top: calc(<constant> + var(--dent-overlap))`. The overlap therefore
cancels itself out of the copy's position: the header always lands exactly
`<constant>` below the bottom of the services slab, whatever the overlap is. The
overlap only decides how far the section's own dark box reaches up over the slab's
dead tail - it never moves the label.

So the 368px a reader met was `260px of overlap + 108px of constant`, and only the
second number decided where the copy started relative to the services section.

## The change (three numbers)

| | before | after |
| --- | --- | --- |
| `--dent-overlap` under `html.svc-cinematic` | 260px | **120px** |
| the padding's constant, > 640px | `clamp(96px, 12vh, 148px)` | **`clamp(48px, 6vh, 72px)`** |
| the padding's constant, ≤ 640px | `clamp(80px, 11vh, 104px)` | unchanged |

Measured at 1440×900: the label moves from **368px to 174px** below the section's
top, and from 108px to **54px** below the end of the services slab. At 1024×800:
356px → **168px**. Phones are untouched - the overlap is 0 there and the ≤ 640px
rule still reads `clamp(80px, 11vh, 104px)` - so 390×844 stays at 92.84px, exactly
as before; it was never the excessive end of the range.

120px is not arbitrary: the band that covers the lifted top of the stage is 168px
tall, and the overlap has to stay under it or the section's top bloom would show
over the services slab. A new `dent-qc2.js` assertion records that relationship
(`0 < --dent-overlap < band height`) so a future retune cannot quietly break the
seam, and a second one (`90px ≤ padding-top ≤ 200px`) guards the thing the reader
actually reported.

## What was deliberately *not* changed

The dark stretch that remains between the last service card and the label is not
the dentist section's padding - it is inside the Services section. Its 100vh sticky
stage carries the fourth card and its artwork in the upper half and the indicator
dots at the bottom, so the last ~400px of that stage is empty by construction. The
dentist's box may only reach up over that tail, never over the stage's artwork
(which ends ~340px above the slab's bottom edge), and the copy cannot be pulled
above the box that paints it. Closing that gap means changing the services stage's
own layout or its pinned travel, both explicitly out of scope ("do not modify the
Services section design ... card animations"). The dentist side of the seam is now
as tight as it can be without touching it.

Nothing else in the section moved: same side and bottom padding, same background,
same seam band, same smoke, same arrival, same copy, same card layout.

## Also in this pass (found while verifying)

- **A 404, fixed.** `ezgif-4a7fad58a20dd84f-jpg\ezgif-frame-006 .jpg` - a stray
  space before the extension - meant the clinic scroll sequence's sixth frame was
  requested as `ezgif-frame-006.jpg` and 404'd. Renamed to `ezgif-frame-006.jpg`.
  T15 (console/page errors) went from failing on it to clean. Pre-existing,
  unrelated to spacing, one-character fix.
- **Two frame-timing races made deterministic.** This CDP-driven headless window
  only advances animations on compositor frames, so probes that sample after a
  fixed sleep can catch a transition a hair short of its end:
  - `dent-qc2.js` read the profile dialog mid-entrance, catching `dentDialogIn`'s
    `from` keyframe (`translateY(14px)`, opacity 0) - "modal not centred", plus a
    bogus 1.01:1 on `.dentist-role`. It now finishes the finite animations before
    reading the dialog. The one-shot arrival and the smoke burst are left alone,
    because the checks below exist to observe them mid-flight.
  - `cdp-dental-test.js` T16 read the location entrance mid-transition
    (`ops=1,0.999994`) after a fixed sleep; it now polls for the settled opacity,
    so it still fails if the entrance never fires.
  - **Disclosed, not fixed:** `dent-qc2.js`'s "burst at bloom: legible ...
    `.dentist-view`" reads anywhere between 3.1:1 and 6.9:1 depending on the phase
    of the animated smoke and burst behind that button. It failed *before* this
    phase's CSS existed (4.88 and 3.14 on two runs of identical CSS), so it is not
    a regression - it is a transient decorative-motion artefact on a control whose
    resting contrast is 5.5-6.9:1 (AA). Fixing it properly means changing the
    card's animations, which this pass must not do.

## Verified

- `cdp-dental-test.js`: **181/181** (T15 clean; T16's race removed).
- `loc-qc.js`: **59/59**, unchanged.
- `dent-qc2.js`: **100/101** - the one failure is the disclosed burst-phase probe
  above. Its two seam checks now read the overlap from `--dent-overlap` instead of
  a hard-coded 260px, and the two new guards are in place.
- Geometry probe at 1440×900 / 1024×800 / 390×844: padding-top 368 → 174 / 356 →
  168 / 92.84 unchanged; the label 108 → 54px below the services slab; the
  section's top 12754 → 12894 (slab bottom 13014 minus the new 120px overlap).
- Evidence: `shots\anchor-before-1440/1024/390.png` against
  `anchor-after-1440/1024/390.png` (the section opened on its anchor, before and
  after) and `handover-before/after-*.png` (the moment the label reaches the fold).
- `style.css?v=63` → **`?v=64`**; `index.html` markup and `script.js` untouched;
  CSS braces 571/571; `node --check script.js` OK.

## Remaining limitations

- The services stage's own dead tail (above) is unchanged and still reads as empty
  dark while scrolling through the hand-off. Only a change to the services section
  can close it.
- On phones the label still sits close under the navbar (93px), as it did before
  this pass. It is tight rather than broken, and `--dent-overlap` is 0 there, so
  the overlap has nothing to give back.

---

# Phase 11: the "Book Appointment" dialog

## What the investigation found

There was nothing to restyle: the project had **no appointment popup, no booking
form and no WhatsApp integration anywhere**. The only booking-ish controls were

- the navbar's "Book Visit" — a `<button onclick>` that scrolled to
  `#clinic-section`, and
- "Call to Book an Appointment" — the same `tel:+923348289596` link repeated in
  both doctor profiles (the navbar pill, the clinic card, the footer phone and the
  two `tel:` links inside each profile all dial that number).

`.booking-banner`'s CSS (style.css ~1101, 1266) is dead code — the element it
styles was replaced by the pinned clinic canvas several phases ago, and
`#clinic-section` has no booking markup at all. So this pass is a build, not a
restyle.

The reference screenshot mentioned in the brief never arrived, so the build
follows the written spec.

## What was built

One native `<dialog id="appointment-dialog">`, placed at the end of
`#location-section` — on purpose, exactly as `.dentist-dialog` lives inside
`#dentist-section`: a dialog belongs to the section it speaks for, and nesting it
there means it inherits that section's own `--loc-*` tokens instead of restating
them. There is **one** modal implementation on the page; the browser supplies the
top layer, the focus trap, ESC, focus restore and inertness.

Content is the brief, verbatim: heading **Book Appointment**; subtitle
**Dr. Syed Hashim Jamshed Bukhari Dental Clinic · Kohat**; **Patient Name**
(`e.g. Muhammad Ali`), **Phone Number** (`e.g. 0334 1234567`), **Select
Procedure** — offering exactly the site's four services (Orthodontic Braces,
Scaling & Whitening, Root Canal Therapy, Dental Implants) — and the primary
button **Confirm & Redirect to WhatsApp**.

### The look: the light voice, not the glass

The popup deliberately does **not** repeat the Services / Meet Your Dentist
glass, and it is not the reference's dark navy card with a bright cyan gradient
button either. It takes the *light editorial* identity of "Visit Our Clinic",
which is where it lives:

| | |
|---|---|
| panel | `--loc-panel` solid white, 1px `--loc-line` hairline, radius **14px** (the clinic card's, not the glass sections' 24px) |
| type | `Outfit`; heading `--loc-navy` 700 `clamp(22px, 2.5vw, 27px)`; body `--loc-slate` |
| accent | `--loc-teal` — the same 4px solid rule that sits on the clinic card's top edge, carried onto the panel's top edge |
| fields | `--loc-ivory` ground, hairline border, radius **10px**, min-height **48px**, teal focus ring |
| button | `--loc-teal-deep` `#087e88` with a white label (4.83:1, the Phase 9-vetted surface), radius **10px**, `.directions-btn`'s exact shadow and hover |
| shadow | one restrained neutral `rgba(24,48,71,…)` pair — no teal glow |
| scrim | flat `rgba(7,25,19,.72)` — the page's own near-black teal, **no** blur |

No glass, no translucency, no glow and no gradient anywhere inside the dialog, so
`loc-qc.js`'s existing "no glass / no gradient surfaces in `#location-section`"
checks still pass with it in the DOM. The dropdown's arrow is a real inline SVG
rather than a `background-image`, for the same reason.

### The trigger set (and the one behaviour change)

All five booking controls now open the same dialog via `data-book-open`:

1. the navbar **Book Visit** — previously an inline `onclick` scroll;
2. the four service cards' **Book Treatment** links.

"Book Treatment" used to point at `#clinic-section` — a pinned animation with no
booking UI on it, i.e. a dead end — so it now opens the booking form instead. The
navbar CTA became an `<a href="#location-section">` and the service links **keep**
`href="#clinic-section"`: both hrefs are the no-JS and modifier-click fallback, so
nothing leads nowhere with scripting off, and the old behaviour survives as the
fallback rather than being deleted.

"Call to Book an Appointment" in the doctor profiles stays a `tel:` link — it is a
call action, not a form action.

### The WhatsApp hand-off

The number is **read off the site's own first `tel:` link at runtime**
(`tel:+923348289596` → `923348289596`) rather than retyped, so the dial links and
the message target can never drift apart, and no number is invented. The message
is the clinic greeting plus the patient's name, phone and procedure, URL-encoded
into `https://wa.me/<number>?text=…`.

Submitting shows a real loading state (label → "Opening WhatsApp…", spinner,
`aria-busy`) for ~650ms, then hands over. The tab is opened *synchronously inside
the click* — before any delay — so a popup blocker cannot fire, and it is pointed
at WhatsApp once the state has been seen; if the browser refused the tab the same
URL is followed in the current one, so the visitor always ends up in WhatsApp. The
button returns to its resting label afterwards.

Validation is custom (`novalidate`): each empty/invalid field gets a
`role="alert"` message and `aria-invalid`, focus moves to the first offender, and
editing a field clears only that field's error. Phone numbers are normalised, so
`0334 1234567`, `03341234567`, `+92 334 1234567` and `0092 334 1234567` are all
accepted and all become `+92 334 1234567`; anything else is refused before
WhatsApp is opened.

### Motion, keyboard, and the page behind

Open/close is a CSS-only discrete `display`/`overlay` transition with
`@starting-style`, so ESC, a scrim click and the close button all animate
identically — no JS timers and no second code path. Where `allow-discrete` is
unsupported the dialog still opens and closes correctly; it simply does so
instantly. `prefers-reduced-motion: reduce` removes the transitions and stops the
spinner.

Focus lands on the first field on open (`autofocus`) and returns to the trigger on
close (native). While open the page behind is inert and scroll-locked
(`html.appt-open { overflow: hidden }`), and `html` carries
`scrollbar-gutter: stable` so the lock cannot shift the layout by the width of the
scrollbar it hides.

Responsive: a 520px panel at desktop (measured 512px tall at 1440×900, centred to
the pixel), fitting at 1024, 768 and 390 (`calc(100vw - 24px)`), with
`.appointment-body` as the only scrolling region on a short screen.

### One new colour

`#b42318` for the error text and invalid borders (5.4:1 on white). The site's
palette has no danger tone, so this is the only invented token.

## Untouched

`index.html`'s section structure, the services stage, the dentist carousel and its
profiles, the location section and the footer are all unchanged; `script.js` only
gains one `initAppointmentDialog()` and its call; the CSS is a new block at the
end of the file plus two declarations. Busters: `style.css?v=64 → 65`,
`script.js?v=45 → 46`.

## Verified

- `appt-qc.js` (new): **56/56** — content verbatim, light identity with no glass or
  gradient, centring, all three close paths (including the close animation
  actually completing), the frozen page behind, validation, the exact WhatsApp URL
  and its prefilled message, the loading state and its release, responsiveness at
  1440/1024/768/390, reduced motion, the no-JS fallback and a clean console.
- `cdp-dental-test.js`: **181/181** — T18 rewritten for the CTA's new behaviour.
- `loc-qc.js`: **59/59** — including its no-glass, no-gradient and no-JS checks,
  which now also cover the dialog in the DOM.
- `dent-qc2.js`: **99/101** — the two failures are the disclosed smoke/burst
  phase probes (see Phase 10), not this pass.
- `index.html` 51047 B, `style.css` 137652 B, `script.js` 88645 B; CSS braces
  627/627; `node --check script.js` OK.
- Evidence: `shots\appt-01-section-closed-1440.png`, `appt-02-open-1440.png`,
  `appt-03-validation-1440.png`, `appt-04-loading-1440.png`,
  `appt-05-field-focus-1440.png`, `appt-06-open-768.png`, `appt-07-open-390.png`,
  `appt-08-validation-390.png`.

## Disclosed

- **The QC browser had been measuring the wrong viewport.** Three suites assert
  `documentElement.scrollWidth - clientWidth === 0`, and `dent-qc2` asserted the
  dentist modal's centre against a hard-coded `1440 / 2`. Both only hold in a
  browser whose scrollbars take no space: the site styles a 6px
  `::-webkit-scrollbar` and its full-bleed stages use `100vw`, so on any browser
  that reserves that space the page has the few px of overflow style.css 2115–2116
  already documents, and the modal centres 3px left of `innerWidth / 2`. The QC
  browser was relaunched with `--hide-scrollbars` to match how earlier phases were
  measured, and `dent-qc2`'s centring probe now measures the layout viewport
  (`document.body.clientWidth`) instead of the window, so it is correct on real
  browsers too. No product code changed for this.
- `wa.me/923348289596` is derived from the site's existing dial link; whether that
  number can receive WhatsApp messages cannot be verified from here.
- The line under the button ("Opens WhatsApp with these details filled in.") is
  new copy, added so the hand-off is not a surprise.
- Not added, to avoid inventing UI the brief did not ask for: a dedicated "Book
  Appointment" button in the location section or the footer. Say the word and it
  is a two-line change now that the dialog exists.

# Phase 12: the services stage gets a footage backdrop

## What was asked, and what was found

The brief: use the supplied clip as the **services section** background, muted and
looping, and change nothing in any other section. No popup, no restyle, no new
dependencies.

The clip is a 1280×720, 8s, 1.14 MB H.264 file — a teal studio shot of three
dentists working on an oversized molar. Its own palette (deep teal-green walls,
soft light pooling behind the subject) sits almost exactly on the stage's existing
gradient, which is why it needed no treatment to belong: sampling the whole loop in
a canvas gave a mean luminance of 87–88/255 with only ~1 step of variation across
the eight seconds, i.e. a dark, near-static scene. It is used as supplied, untouched
and unfiltered.

## Why it is a local file

The file is downloaded next to the other assets (`services-backdrop.mp4`, byte
identical to Cloudinary's 1,141,436 B) rather than hot-linked. The rest of the site
is self-contained — every frame and illustration is local — and the section is a
primary surface, so it should not break if a third-party account or URL changes.
Swapping back to the Cloudinary URL is a one-attribute change.

## Layering: same rung, earlier in the DOM

The stage already publishes a z-index ladder: `.svc-caustics` 0, `.svc-fx--back` 1,
`.services-tooth` 2, `.svc-fx--front` 3, `.services-scenes` 4. The `<video>` takes
z-index **0** — the caustics' own rung — and simply comes first in the DOM, so the
ambient water glow from Phase 6 still paints over the footage and every other layer
keeps its exact order. Nothing about the tooth, the spray, the panels or their
transforms was touched.

The stage's painted gradient is left in place *underneath* the clip rather than
replaced. That is deliberate: it is the fallback. A blocked request, an unsupported
codec, a stalled buffer or a still-loading file simply leaves the stage looking
exactly as it did before this phase — verified by renaming the file away and
re-running the whole dentist suite against the broken state.

`object-fit: cover` fills the pinned 100vh stage from the 16:9 source at any
viewport, and because the layer is absolutely positioned it cannot affect the pin's
measurements or the page's scroll width (measured 0 px of horizontal overflow at
1440, 390 and under reduced motion).

## Motion, and what happens without it

The element carries `muted loop playsinline autoplay preload="auto"` in the markup,
so with JS switched off the browser loops it on its own. `script.js` only adds the
two things the markup cannot do:

- **Start it.** Chrome defers autoplay for a video that is still screens below the
  fold — measured: with the attributes alone the clip sat at `currentTime 0`,
  `paused: true` until it was visible. An `IntersectionObserver` calls `play()` the
  first time the stage is actually on screen, and a rejected promise (data not
  ready, policy block) is swallowed on purpose.
- **Stop it when nobody is looking.** On the way out the clip is paused, so a
  decoding video never competes with the scroll-linked timeline.

Reduced motion never plays it at all: the stylesheet drops the layer outright
(`display: none`), so the stage shows its original painted background with no new
motion and no JS needed, and the JS refuses to start it either. A visitor who
switches motion back on while the stage is already in view gets playback resumed
from the stored intersection state, which the observer would never re-report.

Decorative throughout: `aria-hidden="true"`, no `controls`, not focusable,
`pointer-events: none`, so every panel and booking link stays exactly as clickable
as before.

## Untouched

Only the services stage gained an element. The hero, clinic hand-off, services
header, the four panels and their copy, the dentist stage, the location section,
the footer and the appointment dialog are byte-for-byte as they were; the caustics
comment lost its now-inaccurate "only thing drawn behind the artwork" clause and
nothing else. `style.css` gains one block in the services area (base rule plus its
reduced-motion opt-out); `script.js` gains one `initServicesFootage()` and its call.
Busters: `style.css?v=65 → 66`, `script.js?v=46 → 47`.

## Verified

- `svc-video-qc.js` (new): **24/24** — element present and first in the stage, all
  four attributes, decorative treatment, pointer-events, ladder intact
  (0/0/2/4), exact cover-fit of the stage (1440×900 and 342×1739 measured), decoded
  1280×720/8s, no overflow at 1440/390/reduced motion, media actually playing in
  view (`currentTime` advancing 2.45 → 4.07), not decoding while off screen,
  paused again on exit, reduced-motion layer dropped with the gradient still
  painted, and the mobile stacked fallback playing where it is visible.
- `cdp-dental-test.js`: **181/181** — including the services layer, pin-runway and
  scroll-timeline checks.
- `appt-qc.js`: **56/56**; `loc-qc.js`: **59/59**.
- `dent-qc2.js`: **98/101** — the three failures are the disclosed smoke/burst and
  `.dentist-view` phase probes, and they fail **identically with the video file
  renamed away**, so they are independent of this change (see the A/B above).
- `index.html` 51741 B, `style.css` 139370 B, `script.js` 90996 B,
  `services-backdrop.mp4` 1141436 B; CSS braces 630/630; `node --check script.js`
  OK.
- Evidence: `shots\svc-video-01-arrival-1440.png`, `-02-card-1440.png`,
  `-03-fourth-1440.png`, `-04-reduced-motion-1440.png`, `-05-mobile-390.png`.

## Disclosed

- The dev server serves the `.mp4` as `application/octet-stream`, not `video/mp4`.
  Chrome plays it anyway (verified: `videoWidth` 1280, `currentTime` advancing), and
  a production host will send the correct type; nothing was worked around for this.
- `preload="auto"` means the 1.14 MB is fetched at page load rather than when the
  section approaches. The loop is paused the entire time it is off screen, so this
  costs bandwidth, not frames. Say the word and it becomes `metadata` plus a
  buffering hint.
- `script.js` contains 979 pre-existing mojibake sequences (`â”€`, `â†'`) from an
  earlier cp1252 round-trip. Every one of them is inside a comment, so nothing
  user-visible is affected, and this phase added none (its additions are ASCII).
  Fixing the file's encoding is a separate, mechanical job.
- Not offered before doing it, because it is invisible when it works: cropping a
  16:9 clip into the 390px stacked stage shows only its middle fifth. It reads
  fine there, but a portrait crop or a second `<source>` is possible if you would
  rather it framed tighter.


# Phase 13: the services section becomes the footage

## What was asked

Replace the pinned tooth-drop cinematic with the supplied clip as a full-section
background, keep the four service cards, and take the whitespace out of the
section.

## What changed

- The whole `#services-section` scroll timeline was removed from both files: the
  `services-cinematic` stage, the `.service-scene` panels, the artwork layers, the
  water FX, the one-scene-at-a-time cross-fades and the `svc-cinematic` html class.
  All four services, their copy, their benefit lines and their booking links are
  byte-identical to before.
- `.services-surface` (absolute, `z-index: 0`, `pointer-events: none`,
  `overflow: hidden`) holds the `<video class="services-footage">` plus a single
  `.services-veil` gradient. `.services-inner` (`z-index: 1`) holds the header and
  the grid. A short `::before` fade softened the surface's top edge.
- The poster was extracted from the clip itself with a headless-Chrome canvas at
  t=0 (`services-backdrop-poster.jpg`, 1280×720), so poster and video crop
  identically under `cover` — nothing jumps when the first frame arrives.
- Cards: honest dark-green surfaces (`rgba(6,26,24,.74)`), aqua hairline, radius
  14, no frosted glass, one shared row height (`grid-auto-rows: 1fr`), 4 → 2 → 1
  columns. The old slab's overflowing card mock-ups and the extra pinned heights
  went with the timeline.

## Verified

- `svc13-contrast.js`: every copy element ≥ 4.5:1 over all 14 sampled frames of the
  loop, measured on the rendered pixels with the glyphs hidden.
- Reduced motion (video dropped, poster carries), no-video (poster carries), no-JS
  (everything visible and clickable) all measured.
- `cdp-dental-test.js` rewritten for the new stage; `svc13-shots.js`,
  `svc13-novideo.js`, `svc13-seam.js` capture the evidence set.

## Disclosed

- The section was still pulled up `-200vh` with a `124vh` lead-in, so the clip
  started above the fold while the copy sat much lower. That was carried into
  Phase 13 unchanged; Phase 14 removes it.

Busters: `style.css?v=66 → 67`, `script.js?v=47 → 48`.

---

# Phase 14: the services panel — normal flow, copy on the clip, drifting cards

## What was wrong

Measured at the arrival scroll on the Phase 13 build:

| | 1440×900 | 1920×1080 |
|---|---|---|
| video surface | `-18 … 790` | `-22 … 864` |
| header | `252 … 401` | `302 … 451` |
| card grid | `438 … 718` | `496 … 778` |
| dentist's top | `790` | `864` |

Two things were true at once: roughly 240 px of dead dark panel above the copy
(the clip's top had already scrolled past, so the copy looked "too low" on an
empty band), and 216–240 px of the bright dentist section stealing the bottom of
the screen. Root causes were structural, not padding:

- `margin-top: -200vh` pulled the section up over the clinic — a 200vh overlap
  between two sections, which the brief explicitly rules out now;
- `padding-top: 124vh` (a hand-off lead-in) plus `--svc-bleed: 30vh` above the
  copy meant the copy began more than a screen below the section's own top;
- a 24vh `::before` top fade made that gap read as empty dark space;
- the nav landing was pinned to `headerTop − 0.28 × vh`, i.e. deliberately 28vh
  above the header.

## The change

**Layout — normal flow, one screen, copy on top.**
`#services-section` lost the pull-up and the lead-in entirely. It now sits
immediately after `#clinic-section` with no margin, `min-height: 100vh` (then
`100svh`), and top-weighted padding (`clamp(88px, 12vh, 136px)` — just clear of
the fixed navbar). The clip's surface is `inset: 0`, so the footage starts exactly
at the section's first pixel and the copy is an overlay on it, ~12vh down. The
`::before` fade and the `--svc-lead` / `--svc-bleed` tokens are gone.

Measured after the change, at the panel's arrival (its top at the fold):

| | 1440×900 | 1920×1080 |
|---|---|---|
| section | `9360 … 10260` (`= clinicBottom … + 900`) | `11232 … 12312` |
| surface | `0 … 900` | `0 … 1080` |
| header | `108 … 257` | `130 … 278` |
| card grid | `294 … 574` | `323 … 605` |
| dentist's top | `900` (exactly the fold) | `1080` |

No overlap, no gap, no dead band, no next-section sliver. The height still
grows with the content when it has to: on a 390 px phone the panel measures
1502 px and the footage grows with it.

**Veil, re-tuned for the new geometry.** The content now lives in the top ~65 % of
the panel, not at 64–90 %, so the gradient was rebuilt around it: `0.86 → 0.82 →
0.76 → 0.58 → 0.84 → --svc-edge`, darkest behind the header and the cards, lifted
through the open lower half so the molar and the dentists read clearly. It still
settles on `#08201d`, the exact colour the dentist stage opens with, so the edge
below stays invisible.

**The clinic → services hand-off is retired, not broken.** `measureServicesTransition`
now sets `svcHandoff = svcDist > 0`; with the sections side by side `svcDist` is
negative, `updateServicesTransition` returns before touching anything, and the
clinic keeps the opacity `updateSectionBridge` gives it (it simply unpins and
scrolls away). The white bloom stays at `opacity: 0` for good. If a future layout
ever pulls the panel back up, the hand-off arms itself automatically — the code
path is intact.

**Header reveal moved to the header itself.** It used to be a pure function of the
hand-off progress. It is now an IntersectionObserver on the three `.services-anim`
items (same observer as the cards, `is-in` class, 90/180 ms stagger, 0.7 s lift),
one-shot and self-disconnecting, with the hidden initial state still gated behind
`html.js-anim`.

**Cards drift horizontally while the panel crosses the viewport.** `handleScroll`
calls `updateServicesDrift()`, which converts the panel's position into `p ∈ [0,1]`
(0 with the panel's top at the fold, 1 with its last pixel there), maps that to
`u ∈ [-1,1]` and writes a small sideways offset per card to the standalone CSS
`translate` property — never `transform`, so it composes with the entrance
translate instead of fighting it. Travel comes from `--svc-drift` (64 px desktop,
40 px ≤1023, 24 px ≤640) with weights `[0.7, 1, 1, 0.7]`, so the inner pair moves
further and the row reads as one gesture; the motion is symmetric and reversible,
memoised to the fourth decimal so idle frames write nothing, skipped entirely
under reduced motion (with the inline value removed if the preference flips
mid-session), and absent without JS.

**Video source.** The `<video>` keeps its attributes (`muted loop playsinline
autoplay preload="metadata"`) and the local poster; the clip itself is now the
Cloudinary original as the first `<source>`, with the existing local
`services-backdrop.mp4` as the second — byte-for-byte the same file
(1,141,436 B, `content-length` matches), so an offline or blocked CDN falls back
without a code change.

**Nav landing.** The "Services" bridge now lands on the section's own top
(`servicesSection.offsetTop`) instead of 28vh above the header, which puts the
copy 108 px below the fixed navbar on arrival. Same href, hash, history entry and
no-JS behaviour; only the scroll target moved.

## Untouched

The hero, the hero → clinic bridge, the clinic scrub and pinned scene, the dentist
section (content, card animations, smoke), the location section, the footer, the
appointment dialog and every word of copy. `index.html` changed only inside
`#services-section` (comment, video sources, cache buster). No new dependencies,
no new colours outside the section's existing token set.

Busters: `style.css?v=67 → 68`, `script.js?v=48 → 49`.

## Verified

- **Geometry** at 1440×900, 1920×1080, 832×1180, 390×844: section flush under the
  clinic, exactly one screen tall on desktop/tablet, dentist starting exactly at
  the panel's end, no horizontal overflow (`scrollWidth − clientWidth = 0`).
- **Contrast** (`svc14-contrast.js`, rendered-pixel WCAG audit, 7 elements × 14
  frames of the loop): 1440 — heading 9.56:1, description 7.21:1, eyebrow 8.71:1,
  cards 11.6–16.1:1; 832 and 390×1502 — heading ≥ 9.98:1, description ≥ 7.68:1,
  cards ≥ 10.5:1. Every element passes AA normal.
- **Behaviour**: nav click lands at 9360 with the header at 108; a card link opens
  the appointment dialog with focus in the name field; cards and links are the
  topmost elements at their own coordinates (the clinic no longer swallows
  clicks); hover/focus still elevate the card.
- **Motion**: drift measured at −22.4/−32/−32/−22.4 px mid-pass, symmetric on the
  way back; reduced motion shows the poster with `translate` empty and everything
  at opacity 1; blocking every `.mp4` leaves the poster covering the panel.
- `cdp-dental-test.js`: **164/164**, with T4–T6, T9, T10, T12, T13, T14 and T19
  rewritten for the no-overlap geometry and the footer/copy assertions repaired
  (the suite's own expected strings had been double-encoded by a PowerShell
  round-trip).
- `node --check script.js` OK; CSS braces 518/518.
- Evidence: `shots\svc14-01-desktop.png`, `-02-desktop-mid.png`, `-03-wide.png`,
  `-04-tablet.png`, `-05-mobile.png`, `-06-reduced-motion.png`, `-07-no-video.png`,
  `-08-seam-clinic.png`, `-09-seam-dentist.png`.

## Disclosed

- **The clinic → services cross-fade is gone.** It only existed because the two
  sections overlapped; the brief rules that out. The boundary is now a straight
  section edge: the clinic's last frame above, the panel's footage below. It reads
  as a normal section break, but it is a cut, not a dissolve.
- **The lower part of the panel is footage only.** One screen of panel with the
  copy in its upper ~65 % leaves ~250–330 px of moving clip under the cards. That
  is deliberate (the brief asks for the video to be visible, and for the section to
  be a panel), and it is what keeps the copy high; if you would rather the panel
  end just under the cards, say so and it becomes a content-height section.
- **"Services" and "Specialties" are one section** on this page — `#services-section`
  is headed "Comprehensive Dental Services" with an "Our Specialties" eyebrow. Only
  that one section was repositioned.
- The card motion is a scroll-linked drift inside the section, not a pinned
  horizontal rail: no extra scroll length, no pinning, and it reverses exactly.
  Say the word if you want a longer, pinned travel instead.
- On a 390 px phone the panel is taller than the viewport (four stacked cards,
  1502 px), and the 16:9 clip is cropped to a narrow central slice under them. It
  reads fine (the molar stays centred) but it is a heavy crop.
- `script.js` still carries its pre-existing mojibake in comments only; this phase
  added none. `style.css` contains no mojibake.
- The services nav click is still a JS-smoothed bridge; the native hash jump (no
  JS, middle-click) lands on the same section top, so behaviour matches.
