// Theme toggle, range switches and chart tooltips. No dependencies.
(() => {
  const root = document.documentElement;

  // Dark is the default; the choice is remembered on this device.
  document.getElementById("theme")?.addEventListener("click", () => {
    const light = root.dataset.theme !== "light";
    if (light) root.dataset.theme = "light"; else delete root.dataset.theme;
    try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) { /* private mode */ }
  });

  // Segmented controls swap the panels inside the same card.
  document.querySelectorAll("[data-range-group]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      group.closest(".card").querySelectorAll("[data-panel]").forEach((p) => {
        p.hidden = p.dataset.panel !== btn.dataset.range;
      });
    });
  });

  // One tooltip for every chart: value first, label second.
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "status");
  document.body.appendChild(tip);
  const show = (label, value, x, y) => {
    const strong = document.createElement("b");
    strong.textContent = value;
    tip.replaceChildren(strong, document.createTextNode(label));
    tip.style.left = `${Math.min(Math.max(x, 70), innerWidth - 70)}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("on");
  };
  const hide = () => tip.classList.remove("on");

  // Line charts: a crosshair snaps to the nearest point.
  document.querySelectorAll("svg.chart.line").forEach((svg) => {
    const pts = svg.dataset.points.split("|").map((p) => p.split("~"));
    const x0 = +svg.dataset.x0, x1 = +svg.dataset.x1;
    const cross = svg.querySelector(".cross");
    const move = (e) => {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = ((e.clientX - box.left) / box.width) * vb.width;
      const i = Math.round(((Math.min(Math.max(sx, x0), x1) - x0) / (x1 - x0)) * (pts.length - 1));
      const px = x0 + (i / (pts.length - 1)) * (x1 - x0);
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      svg.classList.add("hovering");
      show(pts[i][0], pts[i][1], box.left + (px / vb.width) * box.width, box.top + 8);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", () => { svg.classList.remove("hovering"); hide(); });
  });

  // Bars: each bar row is its own target (also reachable by keyboard).
  document.querySelectorAll("svg.chart.bars .bar").forEach((g) => {
    const [label, value] = g.dataset.tip.split("~");
    const on = () => {
      const r = g.querySelector(".fill").getBoundingClientRect();
      show(label, value, r.right, r.top);
    };
    g.addEventListener("pointerenter", on);
    g.addEventListener("focus", on);
    g.addEventListener("pointerleave", hide);
    g.addEventListener("blur", hide);
  });
  addEventListener("scroll", hide, { passive: true });
})();
