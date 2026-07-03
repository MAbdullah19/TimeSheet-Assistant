// Static standup dashboard — a small hash-routed SPA over a single ./data.json.
// No framework, no build step: it runs as-is on GitHub Pages. Routes:
//   #/                       Today's board (overview + per-day board)
//   #/directory              Searchable grid of all interns
//   #/intern/<name>          One intern's profile — Overview (latest update)
//   #/intern/<name>/history  · full standup history
//   #/intern/<name>/weekly   · weekly reports
//   #/intern/<name>/blockers · blockers logged so far
// A global search box in the nav jumps straight to any intern's profile.

const FIELD_DEFS = [
  { key: "current_task", label: "Current Task" },
  { key: "previous_workday", label: "Previous Workday" },
  { key: "today_goal", label: "Today's Goal" },
  { key: "blockers", label: "Blockers", span: true },
];

let STATE = { interns: [] };
let SELECTED_DATE = null; // remembered across Today re-renders

// ── DOM helper ───────────────────────────────────────────────────────────────
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.value != null) node.value = opts.value;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function allDates(interns) {
  const set = new Set();
  for (const intern of interns) for (const e of intern.entries || []) set.add(e.date);
  return [...set].sort().reverse(); // newest first
}

function entryForDate(intern, date) {
  return (intern.entries || []).find((e) => e.date === date) || null;
}

function internByName(name) {
  return STATE.interns.find((i) => i.name === name) || null;
}

// Summary numbers for a single intern (used by directory cards + profile header).
function internStats(intern) {
  const entries = [...(intern.entries || [])].sort((a, b) => b.date.localeCompare(a.date));
  const latest = entries[0] || null;
  const blockers = entries.filter((e) => e.has_blocker).length;
  return {
    count: entries.length,
    latest,
    lastDate: latest ? latest.date : null,
    blockers,
    entries,
  };
}

function prettyDate(date) {
  try {
    const d = new Date(date + "T00:00:00");
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

function formatTs(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function prettyWeek(start, end) {
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

// ── Reusable pieces ──────────────────────────────────────────────────────────
function statusPill(entry) {
  if (!entry) return el("span", { class: "pill none" }, [el("span", { class: "dot" }), el("span", { text: "Awaiting" })]);
  if (entry.has_blocker) return el("span", { class: "pill blocked" }, [el("span", { class: "dot" }), el("span", { text: "Blocked" })]);
  return el("span", { class: "pill ok" }, [el("span", { class: "dot" }), el("span", { text: "On track" })]);
}

// A single standup entry rendered as a card (used on the board + profile latest).
function entryCard(intern, entry, i = 0, link = true) {
  const hasBlocker = entry && entry.has_blocker;
  const card = el("div", {
    class: "card" + (hasBlocker ? " is-blocked" : "") + (!entry ? " is-missing" : ""),
  });
  card.style.setProperty("--i", i);

  const nameNode = link
    ? el("a", { class: "card-name card-name-link", text: intern.name, attrs: { href: profileHref(intern.name) } })
    : el("h3", { class: "card-name", text: intern.name });

  const idWrap = el("div", { class: "card-id" }, [
    el("span", { class: "avatar", text: initials(intern.name), attrs: { "aria-hidden": "true" } }),
    nameNode,
  ]);
  card.appendChild(el("div", { class: "card-head" }, [idWrap, statusPill(entry)]));

  if (!entry) {
    card.appendChild(el("div", { class: "card-missing-note", text: "No update submitted for this day." }));
    return card;
  }

  const fields = el("div", { class: "fields" });
  for (const f of FIELD_DEFS) {
    const raw = entry[f.key];
    const value = raw && String(raw).trim() ? String(raw) : "Not provided";
    const block = el("div", { class: "field-block" + (f.span ? " span" : "") });
    if (f.key === "blockers") {
      block.classList.add("blocker");
      if (!entry.has_blocker) block.classList.add("clear");
    }
    block.appendChild(el("div", { class: "field-label", text: f.label }));
    block.appendChild(el("div", { class: "field-value" + (raw && String(raw).trim() ? "" : " empty"), text: value }));
    fields.appendChild(block);
  }
  card.appendChild(fields);

  if (entry.submitted_at) {
    card.appendChild(el("div", { class: "card-foot", text: "Submitted " + formatTs(entry.submitted_at) }));
  }
  return card;
}

function historyTable(entries) {
  const table = el("table", { class: "history-table" });
  const headRow = el("tr");
  ["Date", "Current Task", "Previous Workday", "Today's Goal", "Blockers"].forEach((h) =>
    headRow.appendChild(el("th", { text: h }))
  );
  table.appendChild(el("thead", {}, [headRow]));

  const tbody = el("tbody");
  for (const e of entries) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: e.date, attrs: { "data-label": "Date" } }));
    tr.appendChild(el("td", { text: e.current_task || "—", attrs: { "data-label": "Current Task" } }));
    tr.appendChild(el("td", { text: e.previous_workday || "—", attrs: { "data-label": "Previous Workday" } }));
    tr.appendChild(el("td", { text: e.today_goal || "—", attrs: { "data-label": "Today's Goal" } }));
    const blockerTd = el("td", { text: e.blockers || "None", attrs: { "data-label": "Blockers" } });
    blockerTd.className = e.has_blocker ? "row-blocker" : "row-clear";
    tr.appendChild(blockerTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return el("div", { class: "table-scroll" }, [table]);
}

function sectionHead(title, metaText) {
  return el("div", { class: "section-head" }, [
    el("h2", { text: title }),
    metaText ? el("span", { class: "section-meta", text: metaText }) : null,
  ]);
}

function emptyState(strong, rest) {
  return el("div", { class: "empty-state", html: `<strong>${strong}</strong>${rest || ""}` });
}

// ── View: Today ──────────────────────────────────────────────────────────────
function viewToday(root) {
  const dates = allDates(STATE.interns);
  if (SELECTED_DATE == null || !dates.includes(SELECTED_DATE)) {
    const today = new Date().toISOString().slice(0, 10);
    SELECTED_DATE = dates.includes(today) ? today : dates[0] || null;
  }

  // controls row: date selector
  const select = el("select", { attrs: { "aria-label": "Select date", id: "date-select" } });
  if (dates.length === 0) {
    select.appendChild(el("option", { text: "No data", value: "" }));
    select.disabled = true;
  } else {
    for (const d of dates) select.appendChild(el("option", { text: prettyDate(d), value: d }));
    select.value = SELECTED_DATE;
  }
  select.addEventListener("change", () => {
    SELECTED_DATE = select.value;
    redrawToday(root);
  });

  root.appendChild(
    el("div", { class: "view-controls" }, [
      el("label", { text: "Day", attrs: { for: "date-select" } }),
      el("div", { class: "select-wrap" }, [select]),
    ])
  );

  root.appendChild(el("section", { class: "overview", attrs: { id: "overview", "aria-label": "Day summary" } }));
  const boardHead = el("div", { class: "section-head" }, [
    el("h2", { text: "Today's board" }),
    el("span", { class: "section-meta", attrs: { id: "board-date" } }),
  ]);
  root.appendChild(
    el("section", { class: "board-section" }, [boardHead, el("div", { class: "board", attrs: { id: "board" } })])
  );

  redrawToday(root);
}

function redrawToday(root) {
  const date = SELECTED_DATE;
  const overview = root.querySelector("#overview");
  const board = root.querySelector("#board");
  const boardDate = root.querySelector("#board-date");
  if (boardDate) boardDate.textContent = date ? prettyDate(date) : "";

  // overview stats
  overview.innerHTML = "";
  const total = STATE.interns.length;
  let reported = 0, blocked = 0;
  for (const intern of STATE.interns) {
    const entry = date ? entryForDate(intern, date) : null;
    if (entry) { reported += 1; if (entry.has_blocker) blocked += 1; }
  }
  const awaiting = total - reported;
  const stats = [
    { value: total, label: "Interns", sub: "on the roster", cls: "" },
    { value: `${reported}/${total}`, label: "Reported", sub: reported === total && total > 0 ? "all in" : "submitted today", cls: reported === total && total > 0 ? "ok" : "" },
    { value: blocked, label: "Blocked", sub: blocked === 0 ? "all clear" : "need attention", cls: blocked > 0 ? "bad" : "ok" },
    { value: awaiting, label: "Awaiting", sub: awaiting === 0 ? "nothing pending" : "no update yet", cls: awaiting > 0 ? "muted" : "ok" },
  ];
  stats.forEach((s, i) => {
    const card = el("div", { class: ("stat " + s.cls).trim() });
    card.style.setProperty("--i", i);
    card.appendChild(el("div", { class: "stat-value", text: String(s.value) }));
    card.appendChild(el("div", { class: "stat-label", text: s.label }));
    card.appendChild(el("div", { class: "stat-sub", text: s.sub }));
    overview.appendChild(card);
  });

  // board
  board.innerHTML = "";
  if (STATE.interns.length === 0) {
    board.appendChild(emptyState("No interns yet", "Add interns to the roster and their updates will appear here."));
    return;
  }
  STATE.interns.forEach((intern, i) => {
    board.appendChild(entryCard(intern, entryForDate(intern, date), i, true));
  });
}

// ── View: Directory ──────────────────────────────────────────────────────────
function viewDirectory(root) {
  root.appendChild(sectionHead("Interns", STATE.interns.length + (STATE.interns.length === 1 ? " intern" : " interns")));

  if (STATE.interns.length === 0) {
    root.appendChild(emptyState("No interns yet", "Interns appear here once they submit their first standup."));
    return;
  }

  const input = el("input", {
    class: "dir-search",
    attrs: { type: "text", placeholder: "Search by name…", "aria-label": "Filter interns", autocomplete: "off", spellcheck: "false" },
  });
  root.appendChild(el("div", { class: "dir-search-wrap" }, [input]));

  const grid = el("div", { class: "dir-grid" });
  root.appendChild(grid);

  const draw = (q) => {
    grid.innerHTML = "";
    const needle = (q || "").trim().toLowerCase();
    const matches = STATE.interns.filter((i) => i.name.toLowerCase().includes(needle));
    if (matches.length === 0) {
      grid.appendChild(emptyState("No matches", "No intern name contains “" + q + "”."));
      return;
    }
    matches.forEach((intern, i) => grid.appendChild(directoryCard(intern, i)));
  };

  input.addEventListener("input", () => draw(input.value));
  draw("");
}

function directoryCard(intern, i) {
  const s = internStats(intern);
  const card = el("a", { class: "dir-card", attrs: { href: profileHref(intern.name) } });
  card.style.setProperty("--i", i);

  card.appendChild(
    el("div", { class: "dir-card-head" }, [
      el("span", { class: "avatar", text: initials(intern.name), attrs: { "aria-hidden": "true" } }),
      el("div", { class: "dir-card-id" }, [
        el("div", { class: "dir-card-name", text: intern.name }),
        el("div", {
          class: "dir-card-meta",
          text: s.count + (s.count === 1 ? " entry" : " entries") + (s.lastDate ? " · last " + s.lastDate : ""),
        }),
      ]),
    ])
  );
  card.appendChild(el("div", { class: "dir-card-foot" }, [statusPill(s.latest), el("span", { class: "dir-arrow", text: "→", attrs: { "aria-hidden": "true" } })]));
  return card;
}

// ── View: Intern profile (tabbed sub-pages) ──────────────────────────────────
// The profile is split into four sub-pages so a long history/weekly/blocker log
// stays navigable: #/intern/<name> (overview) and #/intern/<name>/{history,
// weekly,blockers}. A persistent header + tab bar sits above the active panel.
const PROFILE_TABS = ["overview", "history", "weekly", "blockers"];

function viewProfile(root, name, tab) {
  const intern = internByName(name);
  root.appendChild(el("a", { class: "back-link", text: "← All interns", attrs: { href: "#/directory" } }));

  if (!intern) {
    root.appendChild(emptyState("Intern not found", "No intern named “" + name + "”. Try the directory."));
    return;
  }

  const s = internStats(intern);
  const weeks = [...(intern.weekly || [])].sort((a, b) => b.week_start.localeCompare(a.week_start));
  const blocked = s.entries.filter((e) => e.has_blocker);
  if (!PROFILE_TABS.includes(tab)) tab = "overview";

  // header (avatar, name, status, summary chips)
  const chips = el("div", { class: "profile-chips" });
  chips.appendChild(profileChip(String(s.count), s.count === 1 ? "Entry" : "Entries"));
  chips.appendChild(profileChip(s.lastDate || "—", "Last reported"));
  chips.appendChild(profileChip(String(s.blockers), s.blockers === 1 ? "Blocked day" : "Blocked days", s.blockers > 0 ? "bad" : "ok"));
  const head = el("section", { class: "profile-head" }, [
    el("span", { class: "avatar avatar-lg", text: initials(intern.name), attrs: { "aria-hidden": "true" } }),
    el("div", { class: "profile-id" }, [el("h1", { class: "profile-name", text: intern.name }), statusPill(s.latest)]),
    chips,
  ]);

  // header + tab bar travel together, tightly spaced, above the active panel
  root.appendChild(
    el("div", { class: "profile-top" }, [
      head,
      profileTabs(intern.name, tab, { history: s.count, weekly: weeks.length, blockers: blocked.length }),
    ])
  );

  const panel = el("div", { class: "profile-panel" });
  root.appendChild(panel);
  if (tab === "history") renderHistoryTab(panel, intern, s);
  else if (tab === "weekly") renderWeeklyTab(panel, weeks);
  else if (tab === "blockers") renderBlockersTab(panel, blocked);
  else renderOverviewTab(panel, intern, s);
}

function profileTabs(name, active, counts) {
  const defs = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "History", count: counts.history },
    { key: "weekly", label: "Weekly reports", count: counts.weekly },
    { key: "blockers", label: "Blockers", count: counts.blockers, danger: true },
  ];
  const nav = el("nav", { class: "profile-tabs", attrs: { "aria-label": "Profile sections" } });
  for (const d of defs) {
    const on = d.key === active;
    const children = [el("span", { text: d.label })];
    if (d.count != null && d.count > 0) {
      children.push(el("span", { class: "ptab-count" + (d.danger ? " danger" : ""), text: String(d.count) }));
    }
    const attrs = { href: profileTabHref(name, d.key) };
    if (on) attrs["aria-current"] = "page";
    nav.appendChild(el("a", { class: "ptab" + (on ? " is-active" : ""), attrs }, children));
  }
  return nav;
}

function renderOverviewTab(root, intern, s) {
  if (!s.latest) {
    root.appendChild(emptyState("No updates yet", "This intern hasn't submitted a standup."));
    return;
  }
  root.appendChild(sectionHead("Latest update", prettyDate(s.latest.date)));
  root.appendChild(el("div", { class: "board single" }, [entryCard(intern, s.latest, 0, false)]));
}

function renderHistoryTab(root, intern, s) {
  root.appendChild(sectionHead("History", s.count + (s.count === 1 ? " entry" : " entries")));
  if (s.count === 0) {
    root.appendChild(emptyState("No entries yet", "This intern hasn't submitted a standup."));
  } else {
    root.appendChild(historyTable(s.entries));
  }
}

function renderWeeklyTab(root, weeks) {
  root.appendChild(sectionHead("Weekly reports", weeks.length ? weeks.length + (weeks.length === 1 ? " report" : " reports") : ""));
  if (weeks.length === 0) {
    root.appendChild(emptyState("No weekly reports yet", "The first summary is generated on the Tuesday after a full work week."));
    return;
  }
  const body = el("div", { class: "weekly-list" });
  for (const w of weeks) {
    const noData = w.status === "no_data";
    const block = el("div", { class: "weekly-week" + (noData ? " is-empty" : "") });
    block.appendChild(el("div", { class: "weekly-range", text: prettyWeek(w.week_start, w.week_end) }));
    block.appendChild(el("p", { class: "weekly-summary" + (noData ? " empty" : ""), text: w.summary || "—" }));
    body.appendChild(block);
  }
  root.appendChild(body);
}

function renderBlockersTab(root, blocked) {
  root.appendChild(sectionHead("Blockers", blocked.length ? blocked.length + (blocked.length === 1 ? " day" : " days") : ""));
  if (blocked.length === 0) {
    root.appendChild(emptyState("No blockers logged", "Every reported day was on track."));
    return;
  }
  const list = el("div", { class: "timeline" });
  for (const e of blocked) {
    list.appendChild(
      el("div", { class: "timeline-item" }, [
        el("div", { class: "timeline-date", text: e.date }),
        el("div", { class: "timeline-text", text: e.blockers || "—" }),
      ])
    );
  }
  root.appendChild(list);
}

function profileChip(value, label, cls) {
  return el("div", { class: ("profile-chip " + (cls || "")).trim() }, [
    el("div", { class: "profile-chip-value", text: value }),
    el("div", { class: "profile-chip-label", text: label }),
  ]);
}

// ── Global nav search ────────────────────────────────────────────────────────
function setupNavSearch() {
  const input = document.getElementById("nav-search");
  const results = document.getElementById("nav-search-results");
  if (!input || !results) return;
  let active = -1;
  let items = [];

  const close = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    items = q
      ? STATE.interns.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
      : [];
    if (items.length === 0) {
      close();
      return;
    }
    items.forEach((intern, idx) => {
      const row = el("a", {
        class: "search-row",
        attrs: { href: profileHref(intern.name), role: "option" },
      }, [
        el("span", { class: "avatar avatar-sm", text: initials(intern.name), attrs: { "aria-hidden": "true" } }),
        el("span", { class: "search-row-name", text: intern.name }),
      ]);
      row.addEventListener("mousedown", (e) => {
        // mousedown (not click) so it fires before input blur closes the list
        e.preventDefault();
        go(intern.name);
      });
      row.addEventListener("mouseenter", () => setActive(idx));
      results.appendChild(row);
    });
    active = -1;
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const setActive = (idx) => {
    active = idx;
    [...results.children].forEach((c, i) => c.classList.toggle("is-active", i === idx));
  };

  const go = (name) => {
    input.value = "";
    close();
    input.blur();
    location.hash = profileHref(name).slice(1); // strip leading '#'
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (results.hidden || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(items[active >= 0 ? active : 0].name); }
    else if (e.key === "Escape") { close(); input.blur(); }
  });
}

// ── Router ───────────────────────────────────────────────────────────────────
function profileHref(name) {
  return "#/intern/" + encodeURIComponent(name);
}

function profileTabHref(name, tab) {
  const base = "#/intern/" + encodeURIComponent(name);
  return tab && tab !== "overview" ? base + "/" + tab : base;
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean); // e.g. ["intern","Some%20Name"]
  if (parts.length === 0) return { name: "home", route: "/" };
  if (parts[0] === "directory") return { name: "directory", route: "/directory" };
  if (parts[0] === "intern" && parts[1]) {
    // Intern names are encodeURIComponent-encoded (slashes → %2F), so parts[1]
    // is always the whole name and parts[2], if present, is the sub-page tab.
    const tab = parts[2] ? decodeURIComponent(parts[2]) : "overview";
    return { name: "profile", route: "/intern", param: decodeURIComponent(parts[1]), tab };
  }
  return { name: "home", route: "/" };
}

function setActiveNav(route) {
  document.querySelectorAll(".nav-link").forEach((a) => {
    const r = a.getAttribute("data-route");
    const on = r === route || (r === "/directory" && route === "/intern");
    a.classList.toggle("is-active", on);
  });
}

function router() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = "";
  const r = parseRoute();
  setActiveNav(r.route);
  window.scrollTo(0, 0);

  if (r.name === "directory") viewDirectory(view);
  else if (r.name === "profile") viewProfile(view, r.param, r.tab);
  else viewToday(view);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  let data;
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    data = await res.json();
  } catch (err) {
    document.getElementById("view").innerHTML =
      '<div class="empty-state"><strong>Could not load data</strong>data.json is missing or invalid.</div>';
    return;
  }

  STATE = data;
  const genEl = document.getElementById("generated-at");
  if (data.generated_at) genEl.textContent = "Updated " + formatTs(data.generated_at);

  setupNavSearch();
  window.addEventListener("hashchange", router);
  router();
}

init();
