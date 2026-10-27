// Morning Brief behaviour: range switches, chart tooltips, copy buttons, filters, news archive. No dependencies.
// Runs in two places: the standalone page (/brief/, which also has its own tabs and theme button) and the
// CRM's Market tab, which calls MarketUI.init(container) after loading the sections.
(() => {
  const root = document.documentElement;

  function init(scope) {
    // Segmented controls: each group swaps only its own panels (data-group).
    scope.querySelectorAll("[data-range-group]").forEach((group) => {
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
    scope.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.classList.add("copied"); b.querySelector(".copy").textContent = "Copied"; } catch (e) { /* no clipboard */ }
    }));

    // Pipeline filters.
    const pipef = scope.querySelector("#pipef");
    pipef?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-f]");
      if (!btn) return;
      pipef.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      const f = btn.dataset.f;
      scope.querySelectorAll(".pipe").forEach((c) => { c.hidden = !(f === "all" || c.dataset.region === f || c.dataset.kind === f); });
    });

    // News archive: loaded on first view, filtered on the phone.
    let archive = null, cat = "";
    const list = scope.querySelector("#arch-list");
    const q = scope.querySelector("#q");
    function renderArchive() {
      const term = (q?.value || "").toLowerCase();
      const rows = (archive || []).filter((i) => (!cat || i.category === cat) && (!term || i.headline.toLowerCase().includes(term))).slice(0, 60);
      list.replaceChildren(...rows.map((i) => {
        const div = document.createElement("div"); div.className = "arch";
        const a = document.createElement("a"); a.href = i.link; a.target = "_blank"; a.rel = "noopener"; a.textContent = i.headline;
        const s = document.createElement("small"); s.textContent = `${i.impact} · ${i.category} · ${i.source} · ${i.published.slice(0, 10)}`;
        div.append(a, s); return div;
      }));
      if (!rows.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "Nothing matches."; list.replaceChildren(p); }
    }
    async function loadArchive() {
      if (archive || !list) return;
      try { archive = await (await fetch("/news-archive.json", { credentials: "same-origin" })).json(); } catch (e) { archive = []; }
      renderArchive();
    }
    q?.addEventListener("input", () => archive && renderArchive());
    scope.querySelector("#catf")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cat]");
      if (!btn) return;
      scope.querySelectorAll("#catf button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      cat = btn.dataset.cat; if (archive) renderArchive();
    });

    // Line charts: a crosshair snaps to the nearest point.
    scope.querySelectorAll("svg.chart.line").forEach((svg) => {
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
    scope.querySelectorAll("svg.chart.bars .bar").forEach((g) => {
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
    return { loadArchive };
  }

  // One tooltip for every chart: value first, label second.
  let tip;
  function show(label, value, x, y) {
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "tip";
      tip.setAttribute("role", "status");
      document.body.appendChild(tip);
      addEventListener("scroll", hide, { passive: true });
    }
    const strong = document.createElement("b");
    strong.textContent = value;
    tip.replaceChildren(strong, document.createTextNode(label));
    tip.style.left = `${Math.min(Math.max(x, 70), innerWidth - 70)}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("on");
  }
  function hide() { tip?.classList.remove("on"); }

  window.MarketUI = { init, hideTip: hide };
  if (document.body.classList.contains("crm")) return; // inside the CRM: it drives tabs and theme itself

  // ---------- standalone page only ----------
  // Dark is the default; the choice is remembered on this device.
  document.getElementById("theme")?.addEventListener("click", () => {
    const light = root.dataset.theme !== "light";
    if (light) root.dataset.theme = "light"; else delete root.dataset.theme;
    try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) { /* private mode */ }
  });
  const ui = init(document);
  // Tabs: Brief / Market / Rent / News / More (the hash keeps the tab on reload).
  const showTab = (tab) => {
    if (tab === "villas") tab = "more";  // old links: the villa facts now sit under More
    if (!/^(brief|market|rent|news|more)$/.test(tab)) tab = "brief";
    root.dataset.tab = tab;
    if (tab === "news") ui.loadArchive();
  };
  addEventListener("hashchange", () => { showTab(location.hash.slice(1)); scrollTo(0, 0); });
  document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", () => setTimeout(() => scrollTo(0, 0))));
  // On a PC, keys 1-5 jump between sections (ignored while typing in the search box).
  addEventListener("keydown", (e) => {
    const tab = ["brief", "market", "rent", "news", "more"][Number(e.key) - 1];
    if (!tab || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    location.hash = tab;
  });
  showTab(root.dataset.tab);
})();
