"""Inline SVG charts, drawn server-side so the page needs no chart library.

Mark specs follow the house data-viz rules: 2px lines with a 10% area wash,
end-dot with a 2px surface ring, hairline solid grid, bars <= 24px thick with a
4px rounded data-end, text in ink colours only. Colours come from CSS variables,
so light and dark mode both work without re-rendering.
"""
from __future__ import annotations

import html
import math


def _fmt(n: float) -> str:
    return f"{round(n):,}"


def _nice_ticks(lo: float, hi: float, count: int = 3) -> list[float]:
    span = (hi - lo) or abs(hi) or 1
    raw = span / count
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    start = math.floor(lo / step) * step
    stop = math.ceil(hi / step) * step
    ticks, v = [], start
    while v <= stop + 1e-9:
        ticks.append(v)
        v += step
    return ticks


def line_chart(values: list[float], labels: list[str], x_ticks: list[int], *, width: int = 358,
               height: int = 170, label: str, unit: str = "", tip_labels: list[str] | None = None) -> str:
    """Single-series line with area wash. `x_ticks` are indexes to label on the x-axis."""
    if len(values) < 2:
        return f'<p class="empty">Not enough data yet for "{html.escape(label)}".</p>'
    pad_l, pad_r, pad_t, pad_b = 44, 56, 10, 24
    ticks = _nice_ticks(min(values), max(values))
    y0, y1 = ticks[0], ticks[-1]
    iw, ih = width - pad_l - pad_r, height - pad_t - pad_b
    x = lambda i: pad_l + i / (len(values) - 1) * iw  # noqa: E731
    y = lambda v: pad_t + (1 - (v - y0) / ((y1 - y0) or 1)) * ih  # noqa: E731
    pts = " L".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(values))
    line = f"M{pts}"
    area = f"{line} L{x(len(values) - 1):.1f},{y(y0):.1f} L{x(0):.1f},{y(y0):.1f} Z"
    grid = "".join(
        f'<line x1="{pad_l}" x2="{width - pad_r}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
        f'<text x="{pad_l - 8}" y="{y(t) + 4:.1f}" text-anchor="end" class="axis num">{_fmt(t)}</text>'
        for t in ticks)
    xl = "".join(
        f'<text x="{x(i):.1f}" y="{height - 6}" text-anchor="{"start" if i == 0 else "end" if i == len(values) - 1 else "middle"}" '
        f'class="axis">{html.escape(labels[i])}</text>' for i in x_ticks)
    ex, ey = x(len(values) - 1), y(values[-1])
    tips = tip_labels or labels
    data = "|".join(f"{html.escape(tips[i])}~{_fmt(v)}{unit}" for i, v in enumerate(values))
    return (
        f'<svg class="chart line" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(label)}" '
        f'data-points="{data}" data-x0="{pad_l}" data-x1="{width - pad_r}" data-top="{pad_t}" data-bottom="{height - pad_b}">'
        f"{grid}"
        f'<path d="{area}" class="wash"/>'
        f'<path d="{line}" class="stroke"/>'
        f'<line class="cross" x1="0" x2="0" y1="{pad_t}" y2="{height - pad_b}"/>'
        f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="6" class="ring"/><circle cx="{ex:.1f}" cy="{ey:.1f}" r="4" class="dot"/>'
        f'<text x="{ex + 9:.1f}" y="{ey + 4:.1f}" class="endlabel num">{_fmt(values[-1])}{unit}</text>'
        f"{xl}</svg>")


def bar_list(items: list[tuple[str, float, str]], *, width: int = 358, label: str, label_w: int = 142) -> str:
    """Horizontal bars, one colour. items = (name, value, value_label)."""
    if not items:
        return f'<p class="empty">No data for "{html.escape(label)}".</p>'
    row_h, thick, r = 32, 10, 4
    top = max(v for _, v, _ in items) or 1
    bar_max = width - label_w - 64
    out = []
    for i, (name, v, vlabel) in enumerate(items):
        w = max(6.0, v / top * bar_max)
        cy = i * row_h + row_h / 2
        x0, y0 = label_w, cy - thick / 2
        path = (f"M{x0},{y0} H{x0 + w - r:.1f} Q{x0 + w:.1f},{y0} {x0 + w:.1f},{y0 + r} "
                f"V{y0 + thick - r} Q{x0 + w:.1f},{y0 + thick} {x0 + w - r:.1f},{y0 + thick} H{x0} Z")
        name_s = html.escape(name if len(name) <= 20 else name[:19] + "…")
        out.append(
            f'<g class="bar" data-tip="{html.escape(name)}~{html.escape(vlabel)}" tabindex="0">'
            f'<rect x="0" y="{i * row_h}" width="{width}" height="{row_h}" class="hit"/>'
            f'<text x="0" y="{cy + 4:.1f}" class="blabel">{name_s}</text>'
            f'<path d="{path}" class="fill"/>'
            f'<text x="{x0 + w + 6:.1f}" y="{cy + 4:.1f}" class="bvalue num">{html.escape(vlabel)}</text></g>')
    return (f'<svg class="chart bars" viewBox="0 0 {width} {len(items) * row_h}" role="img" '
            f'aria-label="{html.escape(label)}">{"".join(out)}</svg>')


def sparkline(values: list[float], *, width: int = 64, height: int = 22) -> str:
    if len(values) < 2:
        return ""
    lo, hi = min(values), max(values)
    x = lambda i: 2 + i / (len(values) - 1) * (width - 8)  # noqa: E731
    y = lambda v: 3 + (1 - (v - lo) / ((hi - lo) or 1)) * (height - 6)  # noqa: E731
    d = "M" + " L".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(values))
    ex, ey = x(len(values) - 1), y(values[-1])
    return (f'<svg class="spark" viewBox="0 0 {width} {height}" width="{width}" height="{height}" aria-hidden="true">'
            f'<path d="{d}" class="sline"/><circle cx="{ex:.1f}" cy="{ey:.1f}" r="4" class="ring"/>'
            f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="2.5" class="dot"/></svg>')
