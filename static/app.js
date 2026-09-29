// Theme toggle, range switches and chart tooltips. No dependencies.
(() => {
  const root = document.documentElement;

  // Dark is the default; the choice is remembered on this device.
  document.getElementById("theme")?.addEventListener("click", () => {
    const light = root.dataset.theme !== "light";
    if (light) root.dataset.theme = "light"; else delete root.dataset.theme;
    try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) { /* private mode */ }
  });

  // Tabs: Brief / Market / Rent / News / More (the hash keeps the tab on reload).
  const showTab = (tab) => {
    if (!/^(brief|market|rent|news|more)$/.test(tab)) tab = "brief";
    root.dataset.tab = tab;
    if (tab === "news") loadArchive();
  };
  addEventListener("hashchange", () => { showTab(location.hash.slice(1)); scrollTo(0, 0); });
  document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", () => setTimeout(() => scrollTo(0, 0))));
  // On a PC, keys 1-5 jump between sections (ignored while typing in the search box).
  addEventListener("keydown", (e) => {
    const tab = ["brief", "market", "rent", "news", "more"][Number(e.key) - 1];
    if (!tab || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    location.hash = tab;
  });

  // Segmented controls: each group swaps only its own panels (data-group).
  document.querySelectorAll("[data-range-group]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      group.closest(".card").querySelectorAll(`[data-group="${group.dataset.rangeGroup}"]`).forEach((p) => {
        p.hidden = p.dataset.panel !== btn.dataset.range;
      });
    });
  });

  // Talking points: tap to copy (for WhatsApp etc.).
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.classList.add("copied"); b.querySelector(".copy").textContent = "Copied"; } catch (e) { /* no clipboard */ }
  }));

  // Pipeline filters.
  const pipef = document.getElementById("pipef");
  pipef?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-f]");
    if (!btn) return;
    pipef.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    const f = btn.dataset.f;
    document.querySelectorAll(".pipe").forEach((c) => { c.hidden = !(f === "all" || c.dataset.region === f || c.dataset.kind === f); });
  });

  // News archive: loaded on first visit to the News tab, filtered on the phone.
  let archive = null;
  async function loadArchive() {
    if (archive || !document.getElementById("arch-list")) return;
    try { archive = await (await fetch("news-archive.json", { credentials: "same-origin" })).json(); } catch (e) { archive = []; }
    renderArchive();
  }
  let cat = "";
  function renderArchive() {
    const list = document.getElementById("arch-list");
    const q = (document.getElementById("q").value || "").toLowerCase();
    const rows = (archive || []).filter((i) => (!cat || i.category === cat) && (!q || i.headline.toLowerCase().includes(q))).slice(0, 60);
    list.replaceChildren(...rows.map((i) => {
      const div = document.createElement("div"); div.className = "arch";
      const a = document.createElement("a"); a.href = i.link; a.target = "_blank"; a.rel = "noopener"; a.textContent = i.headline;
      const s = document.createElement("small"); s.textContent = `${i.impact} · ${i.category} · ${i.source} · ${i.published.slice(0, 10)}`;
      div.append(a, s); return div;
    }));
    if (!rows.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "Nothing matches."; list.replaceChildren(p); }
  }
  document.getElementById("q")?.addEventListener("input", () => archive && renderArchive());
  document.getElementById("catf")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    document.querySelectorAll("#catf button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    cat = btn.dataset.cat; if (archive) renderArchive();
  });
  showTab(root.dataset.tab);

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

  // Home-screen app: keep the last dashboard available offline.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
