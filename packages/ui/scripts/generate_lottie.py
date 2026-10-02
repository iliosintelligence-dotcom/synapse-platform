#!/usr/bin/env python3
"""
Generates the 14 Synapse Lottie animations (see docs: Synapse Lottie Motion
System v1.0). Pure shape-layer Lottie JSON, brand palette, layer names
'primary-stroke' / 'accent-fill' kept stable for runtime colorFilters.

Outputs to src/motion/lottie/animations/. Re-run any time; deterministic.
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'motion', 'lottie', 'animations')
os.makedirs(OUT, exist_ok=True)

TERRA = [0.7569, 0.3843, 0.1647, 1]   # #C1622A
GOLD  = [0.7882, 0.6588, 0.2980, 1]   # #C9A84C
GREEN = [0.1804, 0.4902, 0.3333, 1]   # #2E7D55
WHITE = [1, 1, 1, 1]
DIM   = [0.5333, 0.5333, 0.5333, 1]   # #888888
OFF   = [0.9725, 0.9647, 0.9490, 1]   # #F8F6F2

EASE = {"i": {"x": [0.3], "y": [1]}, "o": {"x": [0.7], "y": [0]}}
EASE3 = {"i": {"x": 0.3, "y": 1}, "o": {"x": 0.7, "y": 0}}

def st(v):  # static value
    return {"a": 0, "k": v}

def kfs(frames):
    """frames: list of (t, value); eased keyframes, last is terminal."""
    out = []
    for idx, (t, v) in enumerate(frames):
        if idx == len(frames) - 1:
            out.append({"t": t, "s": v if isinstance(v, list) else [v]})
        else:
            k = {"t": t, "s": v if isinstance(v, list) else [v]}
            k.update(copy.deepcopy(EASE))
            out.append(k)
    return {"a": 1, "k": out}

def kfp(frames):
    """position keyframes (3-component)."""
    out = []
    for idx, (t, v) in enumerate(frames):
        if idx == len(frames) - 1:
            out.append({"t": t, "s": v})
        else:
            k = {"t": t, "s": v}
            k.update(copy.deepcopy(EASE3))
            out.append(k)
    return {"a": 1, "k": out}

def transform(p=None, s=None, o=None, r=None, a=None):
    return {
        "o": o if o is not None else st(100),
        "r": r if r is not None else st(0),
        "p": p if p is not None else st([0, 0, 0]),
        "a": a if a is not None else st([0, 0, 0]),
        "s": s if s is not None else st([100, 100, 100]),
    }

def ellipse(size, pos=(0, 0)):
    return {"ty": "el", "p": st(list(pos)), "s": st([size, size] if isinstance(size, (int, float)) else list(size))}

def rect(w, h, r=0, pos=(0, 0)):
    return {"ty": "rc", "p": st(list(pos)), "s": st([w, h]), "r": st(r)}

def fill(color, name="accent-fill", opacity=None):
    return {"ty": "fl", "nm": name, "c": st(color), "o": opacity if opacity is not None else st(100)}

def stroke(color, width, name="primary-stroke", opacity=None):
    return {"ty": "st", "nm": name, "c": st(color), "o": opacity if opacity is not None else st(100),
            "w": st(width), "lc": 2, "lj": 2}

def trim(s, e, o=None):
    return {"ty": "tm", "s": s, "e": e, "o": o if o is not None else st(0), "m": 1}

def group(items, tr=None):
    g = {"ty": "gr", "it": items + [dict({"ty": "tr"}, **(tr or transform()))]}
    return g

def path(verts, closed=False):
    n = len(verts)
    return {"ty": "sh", "ks": st({"c": closed, "v": verts,
            "i": [[0, 0]] * n, "o": [[0, 0]] * n})}

def layer(name, shapes, op, ks=None, ip=0):
    return {"ddd": 0, "ind": 1, "ty": 4, "nm": name, "sr": 1,
            "ks": ks or transform(p=st([0, 0, 0])),
            "ao": 0, "shapes": shapes, "ip": ip, "op": op, "st": 0, "bm": 0}

def anim(name, w, h, op, layers, fr=30):
    for i, l in enumerate(layers):
        l["ind"] = i + 1
    doc = {"v": "5.9.0", "fr": fr, "ip": 0, "op": op, "w": w, "h": h,
           "nm": name, "ddd": 0, "assets": [], "layers": layers}
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    return name

names = []

# 1 ── toju-typing: three 8px terracotta dots, sequential 6px rise, 900ms loop
dots = []
for i, x in enumerate([12, 30, 48]):
    d = i * 2  # 60ms stagger at 30fps
    dots.append(layer(f"dot{i+1}", [group([ellipse(8), fill(TERRA)])], 27,
        ks=transform(p=kfp([(0 + d, [x, 16, 0]), (7 + d, [x, 10, 0]), (14 + d, [x, 16, 0]), (27, [x, 16, 0])]))))
names.append(anim("toju-typing", 60, 24, 27, dots))

# 2 ── toju-thinking: 240° terracotta arc rotating 360°, 1200ms loop
ring = layer("arc", [group([ellipse(18), trim(st(0), st(66.7)), stroke(TERRA, 3)])], 36,
    ks=transform(p=st([12, 12, 0]), r=kfs([(0, 0), (36, 360)])))
ring["ks"]["r"]["k"][0].update({"i": {"x": [0.5], "y": [0.5]}, "o": {"x": [0.5], "y": [0.5]}})  # linear spin
names.append(anim("toju-thinking", 24, 24, 36, [ring]))

# 3 ── toju-success: circle traces, then white check draws inside. 600ms once
circle = layer("circle", [group([ellipse(26), trim(st(0), kfs([(0, 0), (9, 100)])), stroke(TERRA, 3)])], 18,
    ks=transform(p=st([16, 16, 0])))
fillbg = layer("fill", [group([ellipse(26), fill(TERRA)])], 18,
    ks=transform(p=st([16, 16, 0]), o=kfs([(7, 0), (11, 100)])))
check = layer("check", [group([path([[-5, 0.5], [-1.5, 4], [5, -3.5]]),
    trim(st(0), kfs([(10, 0), (17, 100)])), stroke(WHITE, 2.6, name="check-stroke")])], 18,
    ks=transform(p=st([16, 16.5, 0])))
names.append(anim("toju-success", 32, 32, 18, [check, fillbg, circle]))

# 4 ── orb-pulse: ambient ring expands+fades, core breathes. 2400ms loop
halo = layer("halo", [group([ellipse(56), fill(TERRA, name="accent-fill")])], 72,
    ks=transform(p=st([60, 60, 0]), s=kfs([(0, [100, 100, 100]), (72, [140, 140, 100])]),
                 o=kfs([(0, 15), (72, 0)])))
core = layer("core", [group([ellipse(40), fill(TERRA)])], 72,
    ks=transform(p=st([60, 60, 0]),
                 s=kfs([(0, [100, 100, 100]), (36, [105, 105, 100]), (72, [100, 100, 100])])))
names.append(anim("orb-pulse", 120, 120, 72, [halo, core]))

# 5 ── verified-badge: gold shield draws, washes, white check. 800ms once
shield_pts = [[0, -13], [11, -8.5], [11, 1], [0, 13], [-11, 1], [-11, -8.5]]
sh_stroke = layer("shield-stroke", [group([path(shield_pts, closed=True),
    trim(st(0), kfs([(0, 0), (11, 100)])), stroke(GOLD, 2.4)])], 24,
    ks=transform(p=st([32, 30, 0])))
sh_fill = layer("shield-fill", [group([path(shield_pts, closed=True), fill(GOLD)])], 24,
    ks=transform(p=st([32, 30, 0]), o=kfs([(9, 0), (14, 28)])))
v_check = layer("check", [group([path([[-4.5, 0], [-1.5, 3.5], [5, -4]]),
    trim(st(0), kfs([(13, 0), (21, 100)])), stroke(WHITE, 2.4, name="check-stroke")])], 24,
    ks=transform(p=st([32, 29, 0])))
names.append(anim("verified-badge", 64, 64, 24, [v_check, sh_fill, sh_stroke]))

def breathing(name, shapes_static, pulse_layer, w=200, h=160, op=90):
    """empty-state scaffold: static scene + one pulsing element, gentle loop."""
    return anim(name, w, h, op, pulse_layer + shapes_static)

# 6 ── empty-saved: house outline + heart pulsing above
house = layer("house", [group([path([[-34, 34], [-34, -6], [0, -34], [34, -6], [34, 34]], closed=True),
    stroke(TERRA, 3)]), group([rect(16, 22, 2, (0, 23)), stroke(TERRA, 2.4, name="door-stroke")])], 90,
    ks=transform(p=st([100, 96, 0])))
heart = layer("heart", [group([
    path([[0, 6], [-8, -2], [-4, -9], [0, -4], [4, -9], [8, -2]], closed=True), fill(TERRA)])], 90,
    ks=transform(p=st([100, 30, 0]),
                 s=kfs([(0, [100, 100, 100]), (30, [108, 108, 100]), (60, [100, 100, 100]), (90, [100, 100, 100])])))
names.append(breathing("empty-saved", [house], [heart]))

# 7 ── empty-leads: phone + green chat bubble fading in/out
phone = layer("phone", [group([rect(44, 76, 10), stroke(TERRA, 3)]),
    group([rect(14, 3, 1.5, (0, -30)), fill(TERRA, name="speaker-fill")])], 90,
    ks=transform(p=st([100, 84, 0])))
bubble = layer("bubble", [group([rect(34, 22, 8), fill([0.1451, 0.8275, 0.4000, 1], name="wa-fill")]),
    group([ellipse(3, (-8, 0)), fill(WHITE, name="d1")]), group([ellipse(3, (0, 0)), fill(WHITE, name="d2")]),
    group([ellipse(3, (8, 0)), fill(WHITE, name="d3")])], 90,
    ks=transform(p=st([138, 46, 0]), o=kfs([(0, 0), (15, 100), (45, 100), (66, 0), (90, 0)])))
names.append(breathing("empty-leads", [phone], [bubble]))

# 8 ── empty-listings: building outline + pulsing plus
bld = layer("building", [group([rect(56, 72, 4, (0, 8)), stroke(TERRA, 3)]),
    group([rect(10, 10, 1, (-12, -12)), stroke(TERRA, 2, name="w1")]),
    group([rect(10, 10, 1, (12, -12)), stroke(TERRA, 2, name="w2")]),
    group([rect(10, 10, 1, (-12, 10)), stroke(TERRA, 2, name="w3")]),
    group([rect(10, 10, 1, (12, 10)), stroke(TERRA, 2, name="w4")])], 75,
    ks=transform(p=st([88, 84, 0])))
plus = layer("plus", [group([path([[-8, 0], [8, 0]]), stroke(TERRA, 4, name="plus-h")]),
    group([path([[0, -8], [0, 8]]), stroke(TERRA, 4, name="plus-v")]),
    group([ellipse(30), fill(OFF, name="plus-bg")])], 75,
    ks=transform(p=st([142, 46, 0]),
                 s=kfs([(0, [100, 100, 100]), (25, [112, 112, 100]), (50, [100, 100, 100]), (75, [100, 100, 100])])))
names.append(breathing("empty-listings", [bld], [plus], op=75))

# 9 ── empty-search: magnifier + chat bubble fading (ask Toju instead)
mag = layer("magnifier", [group([ellipse(44), stroke(TERRA, 3.4)]),
    group([path([[16, 16], [30, 30]]), stroke(TERRA, 3.4, name="handle-stroke")])], 60,
    ks=transform(p=st([92, 74, 0])))
hint = layer("hint-bubble", [group([rect(26, 18, 7), fill(TERRA)]),
    group([ellipse(2.6, (-6, 0)), fill(WHITE, name="hd1")]), group([ellipse(2.6, (0, 0)), fill(WHITE, name="hd2")]),
    group([ellipse(2.6, (6, 0)), fill(WHITE, name="hd3")])], 60,
    ks=transform(p=st([92, 72, 0]), o=kfs([(0, 0), (12, 100), (40, 100), (52, 0), (60, 0)])))
names.append(breathing("empty-search", [mag], [hint], op=60))

# 10 ── empty-chat: Toju avatar circle + three dots appearing above
avatar = layer("avatar", [group([ellipse(52), fill(TERRA)]),
    group([path([[-4, -1], [-1, 2.5], [5, -3.5]]), stroke(WHITE, 2.4, name="spark-stroke")])], 90,
    ks=transform(p=st([100, 96, 0]),
                 s=kfs([(0, [100, 100, 100]), (45, [104, 104, 100]), (90, [100, 100, 100])])))
cdots = []
for i, x in enumerate([84, 100, 116]):
    d = i * 6
    cdots.append(layer(f"cdot{i+1}", [group([ellipse(7), fill(TERRA)])], 90,
        ks=transform(p=st([x, 44, 0]),
                     o=kfs([(0 + d, 0), (12 + d, 100), (54, 100), (72, 0), (90, 0)]))))
names.append(breathing("empty-chat", [avatar], cdots))

# 11 ── proximity-ripple: terracotta pin + 3 expanding staggered rings, 1800ms
pin = layer("pin", [group([ellipse(16, (0, -10)), fill(TERRA)]),
    group([path([[-7, -6], [0, 8], [7, -6]], closed=True), fill(TERRA, name="pin-tip")]),
    group([ellipse(6, (0, -10)), fill(WHITE, name="pin-hole")])], 54,
    ks=transform(p=st([70, 66, 0])))
rings = []
for i in range(3):
    d = i * 12  # 400ms stagger
    rings.append(layer(f"ring{i+1}", [group([ellipse(30), stroke(TERRA, 2.6)])], 54,
        ks=transform(p=st([70, 60, 0]),
                     s=kfs([(0 + d, [0, 0, 100]), (42 + d if 42 + d <= 54 else 54, [200, 200, 100])]),
                     o=kfs([(0 + d, 60), (42 + d if 42 + d <= 54 else 54, 0)]))))
names.append(anim("proximity-ripple", 140, 120, 54, rings + [pin]))

# 12 ── lead-arrived: envelope slides down + one pulse. 700ms once
env = layer("envelope", [group([rect(40, 28, 4), stroke(TERRA, 3)]),
    group([path([[-20, -14], [0, 2], [20, -14]]), stroke(TERRA, 2.6, name="flap-stroke")])], 21,
    ks=transform(p=kfp([(0, [50, 6, 0]), (10, [50, 40, 0]), (12, [50, 36, 0]), (21, [50, 38, 0])]),
                 o=kfs([(0, 0), (4, 100), (21, 100)])))
pulse = layer("pulse", [group([ellipse(44), stroke(TERRA, 2)])], 21,
    ks=transform(p=st([50, 38, 0]), s=kfs([(11, [70, 70, 100]), (21, [160, 160, 100])]),
                 o=kfs([(11, 50), (21, 0)])), ip=11)
names.append(anim("lead-arrived", 100, 80, 21, [pulse, env]))

# 13 ── upload-success: rising line becomes a checkmark. 500ms once
rise = layer("rise", [group([path([[0, 12], [0, -8]]), trim(st(0), kfs([(0, 0), (6, 100)])),
    stroke(TERRA, 3.2)])], 15, ks=transform(p=st([20, 20, 0]), o=kfs([(0, 100), (6, 100), (9, 0)])))
uchk = layer("check", [group([path([[-7, 0], [-2, 5], [8, -6]]),
    trim(st(0), kfs([(6, 0), (14, 100)])), stroke(TERRA, 3.2, name="check-stroke")])], 15,
    ks=transform(p=st([20, 21, 0])))
names.append(anim("upload-success", 40, 40, 15, [uchk, rise]))

# 14 ── property-verified: 7 node chips pop grey→green in sequence, gold shield. 1200ms
chips = []
for i in range(7):
    x = 22 + i * 24
    t0 = i * 3
    chips.append(layer(f"node{i+1}", [group([ellipse(14),
        {"ty": "fl", "nm": "node-fill", "o": st(100),
         "c": {"a": 1, "k": [dict({"t": t0, "s": DIM[:3] + [1]}, **copy.deepcopy(EASE3)),
                              {"t": t0 + 4, "s": GREEN[:3] + [1]}]}}]),
        group([path([[-3.4, 0], [-1, 2.6], [3.8, -2.6]]), stroke(WHITE, 1.8, name=f"nchk{i+1}")])], 36,
        ks=transform(p=st([x, 26, 0]),
                     s=kfs([(t0, [80, 80, 100]), (t0 + 3, [110, 110, 100]), (t0 + 6, [100, 100, 100]), (36, [100, 100, 100])]))))
pshield = layer("shield", [group([path(shield_pts, closed=True), fill(GOLD)]),
    group([path([[-4.5, 0], [-1.5, 3.5], [5, -4]]), stroke(WHITE, 2.2, name="shield-check")])], 36,
    ks=transform(p=st([95, 62, 0]), o=kfs([(22, 0), (28, 100), (36, 100)]),
                 s=kfs([(22, [70, 70, 100]), (28, [110, 110, 100]), (32, [100, 100, 100]), (36, [100, 100, 100])])), ip=22)
names.append(anim("property-verified", 190, 84, 36, [pshield] + chips))

print(f"wrote {len(names)} animations to {os.path.relpath(OUT, HERE)}")
for n in names:
    size = os.path.getsize(os.path.join(OUT, n + '.json'))
    print(f"  {n}.json  {size/1024:.1f} KB")
