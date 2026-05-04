/* ============================================================
   THE COUNTING-NIGHT GAZETTE — front-end
   Vanilla JS. Renders broadsheet headlines + custom Margin Pyramid SVG.
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* -------- State / config -------- */

const PARTY_ABBREV = {
  "Tamilaga Vettri Kazhagam": "TVK",
  "All India Anna Dravida Munnetra Kazhagam": "AIADMK",
  "Dravida Munnetra Kazhagam": "DMK",
  "Indian National Congress": "INC",
  "Bharatiya Janata Party": "BJP",
  "Pattali Makkal Katchi": "PMK",
  "Communist Party of India": "CPI",
  "Communist Party of India  (Marxist)": "CPI(M)",
  "Communist Party of India (Marxist)": "CPI(M)",
  "Bahujan Samaj Party": "BSP",
  "Samajwadi Party": "SP",
  "Aam Aadmi Party": "AAP",
  "All India Trinamool Congress": "AITC",
  "Indian Union Muslim League": "IUML",
  "Yuvajana Sramika Rythu Congress Party": "YSRCP",
  "Bharat Rashtra Samithi": "BRS",
  "Telugu Desam Party": "TDP",
  "Independent": "IND",
  "Naam Tamilar Katchi": "NTK",
  "Marumalarchi Dravida Munnetra Kazhagam": "MDMK",
  "Desiya Murpokku Dravida Kazhagam": "DMDK",
  "Viduthalai Chiruthaigal Katchi": "VCK",
  "Nationalist Congress Party": "NCP",
  "Shiv Sena": "SHS",
  "Janata Dal  (Secular)": "JD(S)",
  "Janata Dal (Secular)": "JD(S)",
  "Janata Dal  (United)": "JD(U)",
  "Janata Dal (United)": "JD(U)",
  "Rashtriya Janata Dal": "RJD",
  "Lok Janshakti Party": "LJP",
  "Indian National Lok Dal": "INLD",
  "Jharkhand Mukti Morcha": "JMM",
  "Biju Janata Dal": "BJD",
  "None of the Above": "NOTA",
  "Unknown": "—",
};

const BAND_COLORS = [
  "var(--band-0)","var(--band-1)","var(--band-2)","var(--band-3)",
  "var(--band-4)","var(--band-5)","var(--band-6)","var(--band-7)","var(--band-8)",
];

const STATUS_LABELS = {
  ok: "On the wire",
  loading: "Receiving wire",
  error: "Wire error",
};

const POLL_INTERVAL_MS = 30_000;

const cache = {
  state: "S22",
  bucketsData: null,
  contests: null,
  summary: null,
  mode: "lead",       // bucket-table mode
  watch: "close",     // watchlist mode: 'close' | 'landslide'
  detail: null,       // current detail context, persisted across reloads
  states: [],         // [{code, name}, ...] from /api/states
  stateMap: {},       // code -> name
};

const BAND_RANGES = {
  "0-1k":   [0, 1000],
  "1-2k":   [1000, 2000],
  "2-3k":   [2000, 3000],
  "3-4k":   [3000, 4000],
  "4-5k":   [4000, 5000],
  "5-10k":  [5000, 10000],
  "10-20k": [10000, 20000],
  "20-50k": [20000, 50000],
  "50k+":   [50000, Infinity],
};
const BAND_ORDER = Object.keys(BAND_RANGES);

function bandFor(margin) {
  if (margin === null || margin === undefined) return null;
  const m = Math.abs(margin);
  for (const b of BAND_ORDER) {
    const [lo, hi] = BAND_RANGES[b];
    if (m >= lo && m < hi) return b;
  }
  return null;
}

function bandColor(label) {
  const i = BAND_ORDER.indexOf(label);
  return i >= 0 ? BAND_COLORS[i] : "var(--ink)";
}

/* -------- helpers -------- */

function abbreviate(name) {
  if (!name) return "—";
  const trimmed = name.trim();
  if (PARTY_ABBREV[trimmed]) return PARTY_ABBREV[trimmed];
  // Auto-abbreviate: take initials of capitalised words, max 7
  const words = trimmed.replace(/\(/g, " (").split(/\s+/).filter(Boolean);
  const initials = words
    .filter(w => /^[A-Z]/.test(w) || /^\(/.test(w))
    .map(w => w.replace(/[()]/g, "")[0])
    .filter(Boolean)
    .join("");
  return (initials || trimmed.slice(0, 4)).toUpperCase().slice(0, 7);
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(n);
}

function fmtShort(n) {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}

function fmtTimeIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function fmtClock(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtClockSeconds(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function api(path, opts = {}) {
  const r = await fetch(path, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status";
  if (kind === "error") el.classList.add("is-error");
  else if (kind === "ok") el.classList.add("is-ok");
}

function svgEl(name, attrs = {}, parent) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}

/* -------- masthead clock -------- */

function renderClock() {
  const now = new Date();
  $("todayDate").textContent = fmtDate(now);
  $("todayTime").textContent = fmtClockSeconds(now);
  // Edition no = day-of-year mod 999, padded
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  $("editionNo").textContent = String(day % 999).padStart(3, "0");
}
renderClock();
setInterval(renderClock, 1000);

/* -------- legend -------- */

function renderLegend(bucketLabels) {
  const el = $("legend");
  const chips = bucketLabels.map((b, i) => `
    <button class="legend__chip" data-band="${b}" type="button" title="See all ${b} contests">
      <span class="legend__sw" style="background:${BAND_COLORS[i]}"></span>${b}
    </button>
  `).join("");
  el.innerHTML = chips + `<span class="legend__caption">Tighter ←  margin band  → landslide. Click any band for the full list.</span>`;
  el.querySelectorAll(".legend__chip").forEach(btn => {
    btn.addEventListener("click", () => {
      showDetail({ type: "band", band: btn.dataset.band });
    });
  });
}

/* -------- pyramid -------- */

function renderPyramid(bucketsData) {
  const host = $("pyramid");
  const empty = $("pyramidEmpty");
  host.innerHTML = "";

  const entries = Object.entries(bucketsData.parties)
    .filter(([, v]) => (v.lead_total + v.trail_total) > 0)
    .sort((a, b) => {
      const ka = a[1].lead_total + a[1].trail_total * 0.6;
      const kb = b[1].lead_total + b[1].trail_total * 0.6;
      return kb - ka;
    });

  if (!entries.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const buckets = bucketsData.buckets;
  const W       = 1200;
  const NAME_W  = 230;
  const NUM_W   = 64;
  const SIDE_W  = 380;
  const ROW_H   = 56;
  const HEAD_H  = 44;
  const FOOT_H  = 38;
  const AXIS_X  = NAME_W + NUM_W + SIDE_W;          // 230+64+380 = 674
  const RIGHT_END = AXIS_X + SIDE_W;                // 1054
  const NUM_RIGHT_X = RIGHT_END + 8;                // 1062
  const H = HEAD_H + entries.length * ROW_H + FOOT_H;

  // Pixel scale: largest single side count across parties
  const globalMax = entries.reduce((m, [, v]) =>
    Math.max(m, v.lead_total, v.trail_total), 0) || 1;
  const scale = SIDE_W / globalMax;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Margin pyramid: leading and trailing seats per party by margin band",
  });

  /* defs: hatched patterns for trail segments */
  const defs = svgEl("defs", {}, svg);
  buckets.forEach((b, i) => {
    const p = svgEl("pattern", {
      id: `hatch-${i}`,
      width: 6, height: 6,
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    }, defs);
    svgEl("rect", {
      width: 6, height: 6, fill: "var(--paper)",
    }, p);
    svgEl("rect", {
      width: 2.4, height: 6, fill: BAND_COLORS[i],
    }, p);
    // edge accent for stronger contrast on dense bands
    if (i >= 5) {
      svgEl("rect", {
        x: 3, width: 1, height: 6, fill: BAND_COLORS[i], opacity: .55,
      }, p);
    }
  });

  /* Head: axis labels */
  const head = svgEl("g", { transform: `translate(0, ${HEAD_H - 14})` }, svg);
  svgEl("text", {
    x: AXIS_X - 10, y: 0,
    "text-anchor": "end",
    class: "axis-label axis-label--accent",
  }, head).textContent = "← Trailing";
  svgEl("text", {
    x: AXIS_X + 10, y: 0,
    "text-anchor": "start",
    class: "axis-label axis-label--accent",
  }, head).textContent = "Leading →";
  svgEl("text", {
    x: NAME_W - 8, y: 0,
    "text-anchor": "end",
    class: "axis-label",
  }, head).textContent = "Party";
  svgEl("text", {
    x: NUM_RIGHT_X, y: 0,
    "text-anchor": "start",
    class: "axis-label",
  }, head).textContent = "Lead";
  svgEl("text", {
    x: NAME_W + NUM_W - 8, y: 0,
    "text-anchor": "end",
    class: "axis-label",
  }, head).textContent = "Trail";

  /* Center axis */
  const axisTopY = HEAD_H - 6;
  const axisBotY = HEAD_H + entries.length * ROW_H + 10;
  svgEl("line", {
    x1: AXIS_X, x2: AXIS_X, y1: axisTopY, y2: axisBotY,
    class: "axis-line",
  }, svg);

  /* Tick marks at intervals of 5 seats */
  const tickStep = globalMax >= 40 ? 10 : (globalMax >= 20 ? 5 : 2);
  for (let t = tickStep; t <= globalMax; t += tickStep) {
    const dx = t * scale;
    [AXIS_X - dx, AXIS_X + dx].forEach((x) => {
      svgEl("line", {
        x1: x, x2: x,
        y1: axisBotY, y2: axisBotY + 5,
        class: "axis-tick",
      }, svg);
      svgEl("text", {
        x, y: axisBotY + 18,
        "text-anchor": "middle",
        class: "axis-label",
      }, svg).textContent = String(t);
    });
  }

  /* Rows */
  let delayBase = 240;
  entries.forEach(([party, v], rowIdx) => {
    const rowY = HEAD_H + rowIdx * ROW_H;
    const midY = rowY + ROW_H / 2;
    const barH = 28;
    const barTop = midY - barH / 2;

    const g = svgEl("g", { transform: `translate(0, 0)` }, svg);

    // Party name + abbrev + full
    svgEl("text", {
      x: NAME_W - 10, y: midY - 2,
      "text-anchor": "end",
      class: "row-name",
    }, g).textContent = abbreviate(party);

    const fullName = svgEl("text", {
      x: NAME_W - 10, y: midY + 12,
      "text-anchor": "end",
      class: "row-name--full",
    }, g);
    fullName.textContent = party.length > 36 ? party.slice(0, 33) + "…" : party;

    // Lead total numeral on right
    svgEl("text", {
      x: NUM_RIGHT_X, y: midY + 7,
      "text-anchor": "start",
      class: "row-num " + (v.lead_total === 0 ? "row-num--zero" : ""),
    }, g).textContent = v.lead_total;

    // Trail total numeral on left of left bars
    svgEl("text", {
      x: NAME_W + NUM_W - 8, y: midY + 7,
      "text-anchor": "end",
      class: "row-num " + (v.trail_total === 0 ? "row-num--zero" : ""),
    }, g).textContent = v.trail_total;

    // Trailing bars: from AXIS_X going LEFT, innermost = bucket 0 (tight)
    let cumX = AXIS_X;
    buckets.forEach((b, i) => {
      const count = v.trail[b] || 0;
      if (count <= 0) return;
      const w = count * scale;
      const x = cumX - w;
      const r = svgEl("rect", {
        x, y: barTop, width: w, height: barH,
        fill: `url(#hatch-${i})`,
        stroke: BAND_COLORS[i],
        "stroke-width": 0.5,
        class: "bar bar--trail",
        tabindex: "0",
        role: "button",
        "aria-label": `${count} ${party} seats trailing by ${b}`,
        style: `--delay: ${delayBase + rowIdx * 40 + i * 30}ms`,
      }, g);
      attachBarHandlers(r, party, b, count, "trail");
      cumX -= w;
    });

    // Leading bars: from AXIS_X going RIGHT, innermost = bucket 0
    cumX = AXIS_X;
    buckets.forEach((b, i) => {
      const count = v.lead[b] || 0;
      if (count <= 0) return;
      const w = count * scale;
      const r = svgEl("rect", {
        x: cumX, y: barTop, width: w, height: barH,
        fill: BAND_COLORS[i],
        class: "bar bar--lead",
        tabindex: "0",
        role: "button",
        "aria-label": `${count} ${party} seats leading by ${b}`,
        style: `--delay: ${delayBase + rowIdx * 40 + i * 30}ms`,
      }, g);
      attachBarHandlers(r, party, b, count, "lead");
      cumX += w;
    });

    // Row divider
    if (rowIdx < entries.length - 1) {
      svgEl("line", {
        x1: NAME_W - 10, x2: RIGHT_END + 8,
        y1: rowY + ROW_H, y2: rowY + ROW_H,
        class: "row-divider",
      }, svg);
    }
  });

  host.appendChild(svg);
}

/* -------- pyramid bar interactions -------- */

const tip = $("tooltip");
function attachBarHandlers(rect, party, band, count, dir) {
  rect.addEventListener("mousemove", (e) => {
    tip.hidden = false;
    tip.innerHTML = `
      <strong>${abbreviate(party)}</strong>
      ${count} seat${count === 1 ? "" : "s"} ${dir === "lead" ? "leading" : "trailing"}
      <em>by ${band} votes · <span style="color:var(--paper)">${escapeHtml(party)}</span></em>
      <em style="color:var(--paper-deep)">Click for the full list</em>
    `;
    tip.style.left = e.clientX + "px";
    tip.style.top  = e.clientY + "px";
  });
  rect.addEventListener("mouseleave", () => { tip.hidden = true; });
  rect.addEventListener("click", () => {
    tip.hidden = true;
    showDetail({ type: "bar", party, band, direction: dir });
  });
  rect.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showDetail({ type: "bar", party, band, direction: dir });
    }
  });
}

/* -------- bucket table -------- */

function renderBucketTable() {
  const data = cache.bucketsData;
  if (!data) return;
  const { buckets, parties } = data;
  const mode = cache.mode;
  const totalKey = mode === "lead" ? "lead_total" : "trail_total";

  const entries = Object.entries(parties)
    .filter(([, v]) => v[totalKey] > 0)
    .sort((a, b) => b[1][totalKey] - a[1][totalKey]);

  const t = $("bucketTable");
  if (!entries.length) {
    t.innerHTML = `<tbody><tr><td class="party"><em>No ${mode === "lead" ? "leading" : "trailing"} contests on file.</em></td></tr></tbody>`;
    return;
  }

  const thead = `
    <thead>
      <tr>
        <th>Party</th>
        ${buckets.map(b => `<th class="num">${b}</th>`).join("")}
        <th class="num total">Total</th>
      </tr>
    </thead>
  `;
  const tbody = entries.map(([party, v]) => {
    const cells = buckets.map(b => {
      const c = v[mode][b] || 0;
      return `<td class="num ${c === 0 ? "zero" : ""}">${c || "·"}</td>`;
    }).join("");
    return `
      <tr>
        <td class="party">${abbreviate(party)}<small>${party}</small></td>
        ${cells}
        <td class="num total">${v[totalKey]}</td>
      </tr>
    `;
  }).join("");
  t.innerHTML = thead + `<tbody>${tbody}</tbody>`;
}

/* -------- watchlist (close contests / landslides) -------- */

function renderWatchlist() {
  const list = $("closeContests");
  const all = (cache.contests || []).filter(c => c.margin !== null && c.margin !== undefined);
  if (!all.length) {
    list.innerHTML = `<li><span class="contest__name muted">No contests on file</span></li>`;
    return;
  }
  const mode = cache.watch;
  const sorted = [...all].sort((a, b) =>
    mode === "close"
      ? Math.abs(a.margin) - Math.abs(b.margin)
      : Math.abs(b.margin) - Math.abs(a.margin)
  ).slice(0, 8);

  list.innerHTML = sorted.map((c, i) => `
    <li data-idx="${i}" tabindex="0" role="button" aria-label="Open detail for ${escapeHtml(c.ac_name)}">
      <span class="contest__name">${escapeHtml(c.ac_name)}</span>
      <span class="contest__pair">
        <strong>${abbreviate(c.leading_party)}</strong> ${c.leading_candidate ? "(" + escapeHtml(c.leading_candidate) + ")" : ""}
        over
        <strong>${abbreviate(c.trailing_party)}</strong>
      </span>
      <span class="contest__margin">
        ${fmt(c.margin)}
        <small>${c.status || ""}</small>
      </span>
    </li>
  `).join("");

  list.querySelectorAll("li").forEach((el, i) => {
    el.addEventListener("click", () => showDetail({ type: "contest", contest: sorted[i] }));
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showDetail({ type: "contest", contest: sorted[i] });
      }
    });
  });

  const isClose = mode === "close";
  $("wl-h").textContent          = isClose ? "Knife-Edge Contests" : "Landslide Contests";
  $("watchKicker").textContent   = isClose ? "Dispatch" : "Stop press";
  $("watchDek").textContent      = isClose
    ? "Eight tightest margins on file."
    : "Eight largest margins on file.";
  $("watchToggle").textContent   = isClose ? "Show landslides instead" : "Show knife-edge instead";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;",
  }[c]));
}

/* -------- headline / lede -------- */

function renderHeadline() {
  const summary = cache.summary;
  const contests = cache.contests || [];
  const stateCode = cache.state;

  $("stateHeading").textContent = cache.stateMap[stateCode] || stateCode;
  $("totalContests").textContent = fmt(summary?.total_contests ?? 0);

  // top party
  const top = (summary?.by_leading_party || []).find(r => r.leading_party);
  if (top) {
    $("topPartyAbbr").textContent = abbreviate(top.leading_party);
    $("topPartyName").textContent = top.leading_party;
    $("topPartySeats").textContent = fmt(top.seats);
    const total = summary?.total_contests || 0;
    const share = total > 0 ? Math.round((top.seats / total) * 100) + "%" : "—";
    $("topPartyShare").textContent = share + " of seats";
  } else {
    $("topPartyAbbr").textContent = "—";
    $("topPartyName").textContent = "Awaiting first dispatch";
    $("topPartySeats").textContent = "0";
    $("topPartyShare").textContent = "—";
  }

  // closest race
  const sortedByMargin = contests
    .filter(c => c.margin !== null && c.margin !== undefined)
    .sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin));
  const closest = sortedByMargin[0];
  if (closest) {
    $("closestMargin").textContent = fmt(Math.abs(closest.margin));
    $("closestRace").textContent = closest.ac_name;
    $("closestPair").textContent =
      `${abbreviate(closest.leading_party)} vs ${abbreviate(closest.trailing_party)}`;
  } else {
    $("closestMargin").textContent = "—";
    $("closestRace").textContent = "Awaiting bulletins";
    $("closestPair").textContent = "—";
  }

  // last update
  const last = summary?.last_scrape;
  const lastDate = fmtTimeIso(last?.finished_at);
  $("lastUpdate").textContent = lastDate ? fmtClock(lastDate) : "—";
  $("lastPages").textContent = fmt(last?.pages_fetched ?? 0);
  $("lastRows").textContent = `${fmt(last?.rows_upserted ?? 0)} rows recorded`;
  $("counting").textContent = (summary?.total_contests ?? 0) > 0 ? "progress" : "abeyance";
}

/* -------- detail panel -------- */

function showDetail(ctx) {
  cache.detail = ctx;
  const panel = $("detailPanel");
  panel.hidden = false;
  if (ctx.type === "bar") renderDetailBar(ctx);
  else if (ctx.type === "band") renderDetailBand(ctx);
  else if (ctx.type === "contest") renderDetailContest(ctx);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function refreshDetailIfOpen() {
  if (!cache.detail) return;
  // re-resolve contest reference from latest cache for type=contest
  const ctx = cache.detail;
  if (ctx.type === "contest" && ctx.contest) {
    const fresh = (cache.contests || []).find(
      c => c.state_code === ctx.contest.state_code && c.ac_no === ctx.contest.ac_no,
    );
    if (fresh) ctx.contest = fresh;
  }
  showDetail(ctx);
}

function hideDetail() {
  cache.detail = null;
  $("detailPanel").hidden = true;
}

function renderDetailBar({ party, band, direction }) {
  const all = cache.contests || [];
  const matches = all.filter(c => {
    if (bandFor(c.margin) !== band) return false;
    return direction === "lead"
      ? c.leading_party === party
      : c.trailing_party === party;
  }).sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin));

  $("detailKicker").innerHTML =
    `<span class="legend__sw" style="background:${bandColor(band)};vertical-align:-2px;display:inline-block;margin-right:.45rem"></span>${direction === "lead" ? "Leading" : "Trailing"} segment`;
  $("detailTitle").textContent = `${abbreviate(party)} · ${direction === "lead" ? "leading" : "trailing"} by ${band} votes`;
  $("detailDek").innerHTML =
    `<strong>${matches.length}</strong> contest${matches.length === 1 ? "" : "s"} in this segment of ${escapeHtml(party)}.`;
  $("detailBody").innerHTML = renderContestList(matches);
  bindDetailContestClicks();
}

function renderDetailBand({ band }) {
  const all = (cache.contests || []).filter(c => bandFor(c.margin) === band);
  const [lo, hi] = BAND_RANGES[band] || [0, 0];
  const rangeLabel = hi === Infinity
    ? `${fmt(lo)}+ votes`
    : `${fmt(lo)} – ${fmt(hi)} votes`;

  // group by leading party desc by count
  const byParty = new Map();
  for (const c of all) {
    const p = c.leading_party || "Unknown";
    if (!byParty.has(p)) byParty.set(p, []);
    byParty.get(p).push(c);
  }
  const groups = [...byParty.entries()]
    .map(([p, list]) => [p, list.sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin))])
    .sort((a, b) => b[1].length - a[1].length);

  $("detailKicker").innerHTML =
    `<span class="legend__sw" style="background:${bandColor(band)};vertical-align:-2px;display:inline-block;margin-right:.45rem"></span>Margin band`;
  $("detailTitle").textContent = `${band} · ${all.length} contest${all.length === 1 ? "" : "s"}`;
  $("detailDek").textContent =
    `Margins of ${rangeLabel}. Grouped by leading party, sorted by closest first within each group.`;

  if (!groups.length) {
    $("detailBody").innerHTML = `<p class="muted">No contests on file in this band.</p>`;
    return;
  }
  $("detailBody").innerHTML = groups.map(([party, list]) => `
    <div class="detail__group">
      <h4 class="detail__group-title">
        ${abbreviate(party)}
        <small>${escapeHtml(party)}</small>
        <em>${list.length} seat${list.length === 1 ? "" : "s"}</em>
      </h4>
      ${renderContestList(list)}
    </div>
  `).join("");
  bindDetailContestClicks();
}

function renderDetailContest({ contest: c }) {
  if (!c) return;
  const band = bandFor(c.margin);
  $("detailKicker").innerHTML =
    `<span class="legend__sw" style="background:${bandColor(band)};vertical-align:-2px;display:inline-block;margin-right:.45rem"></span>Constituency`;
  $("detailTitle").textContent = c.ac_name;
  $("detailDek").innerHTML =
    `${escapeHtml(c.state_code)} · No. ${c.ac_no} · <em>${escapeHtml(c.status || "Status unknown")}</em>${band ? " · band " + band : ""}`;

  $("detailBody").innerHTML = `
    <div class="detail__contest">
      <div class="detail__col">
        <span class="kicker">Leading</span>
        <p class="detail__cand">${escapeHtml(c.leading_candidate || "—")}</p>
        <p class="detail__party">
          <strong>${abbreviate(c.leading_party)}</strong>
          <small>${escapeHtml(c.leading_party || "")}</small>
        </p>
      </div>
      <div class="detail__col detail__col--center">
        <span class="kicker">Margin</span>
        <p class="detail__margin">${fmt(c.margin)}</p>
        <p class="detail__margin-sub">votes${band ? " · " + band + " band" : ""}</p>
      </div>
      <div class="detail__col">
        <span class="kicker">Trailing</span>
        <p class="detail__cand">${escapeHtml(c.trailing_candidate || "—")}</p>
        <p class="detail__party">
          <strong>${abbreviate(c.trailing_party)}</strong>
          <small>${escapeHtml(c.trailing_party || "")}</small>
        </p>
      </div>
    </div>
    <p class="detail__meta">
      Round ${escapeHtml(c.round || "—")}
      &middot; Last bulletin ${c.scraped_at ? escapeHtml(new Date(c.scraped_at).toLocaleString()) : "—"}
    </p>
  `;
}

function renderContestList(list) {
  if (!list.length) return `<p class="muted">No contests.</p>`;
  return `<ol class="detail__contests">${list.map((c, i) => `
    <li data-ac-no="${c.ac_no}" data-state="${escapeHtml(c.state_code)}" tabindex="0" role="button"
        aria-label="Open detail for ${escapeHtml(c.ac_name)}">
      <span class="contest__name">${escapeHtml(c.ac_name)}</span>
      <span class="contest__pair">
        <strong>${abbreviate(c.leading_party)}</strong>
        ${c.leading_candidate ? "(" + escapeHtml(c.leading_candidate) + ")" : ""}
        over
        <strong>${abbreviate(c.trailing_party)}</strong>
      </span>
      <span class="contest__margin">
        ${fmt(Math.abs(c.margin))}
        <small>${escapeHtml(c.status || "")}</small>
      </span>
    </li>
  `).join("")}</ol>`;
}

function bindDetailContestClicks() {
  $("detailBody").querySelectorAll("li[data-ac-no]").forEach(li => {
    const open = () => {
      const acNo = parseInt(li.dataset.acNo, 10);
      const state = li.dataset.state;
      const c = (cache.contests || []).find(x => x.ac_no === acNo && x.state_code === state);
      if (c) showDetail({ type: "contest", contest: c });
    };
    li.addEventListener("click", open);
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

/* -------- search (autocomplete) -------- */

const searchInput = $("search");
const searchResults = $("searchResults");
let searchActiveIdx = -1;
let searchMatches = [];

function highlightQuery(text, q) {
  const i = (text || "").toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(text || "");
  return `${escapeHtml(text.slice(0, i))}<mark>${escapeHtml(text.slice(i, i + q.length))}</mark>${escapeHtml(text.slice(i + q.length))}`;
}

function runSearch(q) {
  const all = cache.contests || [];
  searchMatches = !q.trim()
    ? []
    : all
        .filter(c => (c.ac_name || "").toLowerCase().includes(q.toLowerCase()))
        .slice(0, 10);
  searchActiveIdx = -1;
  if (!q.trim()) { hideSearch(); return; }
  if (!searchMatches.length) {
    searchResults.innerHTML = `<div class="search-empty">No constituency matches “${escapeHtml(q)}”.</div>`;
  } else {
    searchResults.innerHTML = searchMatches.map((c, i) => `
      <button type="button" class="search-result" data-i="${i}" role="option" aria-selected="false">
        <span class="search-result__name">${highlightQuery(c.ac_name, q)}</span>
        <span class="search-result__meta">
          <span class="search-result__abbr">${abbreviate(c.leading_party)}</span>
          margin ${fmt(Math.abs(c.margin))}
        </span>
      </button>
    `).join("");
  }
  searchResults.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
}

function hideSearch() {
  searchResults.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchActiveIdx = -1;
}

function selectSearch(i) {
  const c = searchMatches[i];
  if (!c) return;
  searchInput.value = c.ac_name;
  hideSearch();
  showDetail({ type: "contest", contest: c });
}

function updateSearchHighlight() {
  searchResults.querySelectorAll(".search-result").forEach((el, i) => {
    const active = i === searchActiveIdx;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
    if (active) el.scrollIntoView({ block: "nearest" });
  });
}

searchInput.addEventListener("input", () => runSearch(searchInput.value));
searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) runSearch(searchInput.value);
});
searchInput.addEventListener("keydown", (e) => {
  if (searchResults.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    runSearch(searchInput.value);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchActiveIdx = Math.min(searchMatches.length - 1, searchActiveIdx + 1);
    updateSearchHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    searchActiveIdx = Math.max(0, searchActiveIdx - 1);
    updateSearchHighlight();
  } else if (e.key === "Enter") {
    if (!searchResults.hidden && searchMatches.length) {
      e.preventDefault();
      selectSearch(searchActiveIdx >= 0 ? searchActiveIdx : 0);
    }
  } else if (e.key === "Escape") {
    if (!searchResults.hidden) { e.stopPropagation(); hideSearch(); }
  }
});
searchResults.addEventListener("click", (e) => {
  const btn = e.target.closest(".search-result");
  if (!btn) return;
  selectSearch(parseInt(btn.dataset.i, 10));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSearch();
});

/* -------- loaders -------- */

async function loadStates() {
  try {
    const states = await api(`/api/states`);
    cache.states = states;
    cache.stateMap = Object.fromEntries(states.map(s => [s.code, s.name]));

    const select = $("state");
    select.innerHTML = states.map(s =>
      `<option value="${s.code}">${escapeHtml(s.name)}</option>`
    ).join("");

    if (!cache.stateMap[cache.state]) {
      cache.state = states[0]?.code || cache.state;
    }
    select.value = cache.state;
  } catch (e) {
    setStatus(`Could not load states: ${e.message}`, "error");
  }
}

async function loadAll() {
  const state = cache.state;
  setStatus(STATUS_LABELS.loading, "");
  try {
    const [summary, bucketsData, contests] = await Promise.all([
      api(`/api/summary?state=${encodeURIComponent(state)}`),
      api(`/api/buckets?state=${encodeURIComponent(state)}`),
      api(`/api/contests?state=${encodeURIComponent(state)}&limit=2000`),
    ]);
    cache.summary = summary;
    cache.bucketsData = bucketsData;
    cache.contests = contests;
    renderHeadline();
    renderLegend(bucketsData.buckets);
    renderPyramid(bucketsData);
    renderBucketTable();
    renderWatchlist();
    refreshDetailIfOpen();
    setStatus(STATUS_LABELS.ok, "ok");
  } catch (e) {
    setStatus(`Wire error: ${e.message}`, "error");
  }
}

/* -------- events -------- */

$("refresh").addEventListener("click", () => {
  cache.state = $("state").value || cache.state;
  loadAll();
});
$("state").addEventListener("change", () => {
  cache.state = $("state").value;
  // Switching state invalidates any open contest detail
  if (cache.detail && cache.detail.type === "contest") hideDetail();
  loadAll();
});

document.querySelectorAll(".mode-toggle button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-toggle button").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    cache.mode = btn.dataset.mode;
    renderBucketTable();
  });
});

$("watchToggle").addEventListener("click", () => {
  cache.watch = cache.watch === "close" ? "landslide" : "close";
  renderWatchlist();
});

$("detailClose").addEventListener("click", hideDetail);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!searchResults.hidden) return; // search handles its own Esc first
  if (cache.detail) hideDetail();
});

/* -------- init / polling -------- */

let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadAll();
  }, POLL_INTERVAL_MS);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadAll();
});

loadStates()
  .then(() => loadAll())
  .finally(startPolling);
