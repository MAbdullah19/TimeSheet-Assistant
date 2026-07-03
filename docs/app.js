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

// ── Calendar date picker ─────────────────────────────────────────────────────
// A compact, self-contained popover calendar reused by the Today board and each
// intern's History tab. It navigates months instead of a long scroll of dates.
// Only days that carry data are selectable; blocked days get a rose marker.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // Monday-first
const CAL_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>';

// Local-time "YYYY-MM-DD" (never touches UTC, so no off-by-one across timezones).
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function monthIndex(y, m) {
  return y * 12 + m;
}

// opts: { selected, dates:[YYYY-MM-DD], meta:{date:{blocked}}, onSelect, placeholder }
function makeDatePicker(opts) {
  const { dates = [], meta = {}, onSelect, placeholder = "Pick a date" } = opts;
  const availSet = new Set(dates);
  const sorted = [...dates].sort();
  const minMi = sorted.length ? (() => { const d = parseYmd(sorted[0]); return monthIndex(d.getFullYear(), d.getMonth()); })() : Infinity;
  const maxMi = sorted.length ? (() => { const d = parseYmd(sorted[sorted.length - 1]); return monthIndex(d.getFullYear(), d.getMonth()); })() : -Infinity;
  let selDate = opts.selected || null;

  const start = selDate ? parseYmd(selDate) : (sorted.length ? parseYmd(sorted[sorted.length - 1]) : new Date());
  let viewY = start.getFullYear();
  let viewM = start.getMonth();

  const root = el("div", { class: "datepicker" });
  const trigger = el("button", {
    class: "dp-trigger",
    attrs: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
  });
  const panel = el("div", { class: "dp-panel", attrs: { role: "dialog", "aria-label": "Choose a date" } });
  panel.hidden = true;
  root.appendChild(trigger);
  root.appendChild(panel);

  // panel scaffold: header (prev · label · next), weekday row, day grid
  const prevBtn = el("button", { class: "dp-nav", html: "‹", attrs: { type: "button", "aria-label": "Previous month" } });
  const nextBtn = el("button", { class: "dp-nav", html: "›", attrs: { type: "button", "aria-label": "Next month" } });
  const label = el("div", { class: "dp-label", attrs: { "aria-live": "polite" } });
  panel.appendChild(el("div", { class: "dp-head" }, [prevBtn, label, nextBtn]));
  const wkRow = el("div", { class: "dp-weekdays" });
  for (const w of WEEKDAY_LABELS) wkRow.appendChild(el("span", { class: "dp-wk", text: w }));
  panel.appendChild(wkRow);
  const grid = el("div", { class: "dp-grid" });
  panel.appendChild(grid);

  let cellByDate = {};
  const canPrev = () => monthIndex(viewY, viewM) > minMi;
  const canNext = () => monthIndex(viewY, viewM) < maxMi;

  function updateTrigger() {
    trigger.innerHTML = "";
    trigger.appendChild(el("span", { class: "dp-ico", html: CAL_ICON }));
    trigger.appendChild(el("span", { class: "dp-trigger-text" + (selDate ? "" : " is-placeholder"), text: selDate ? prettyDate(selDate) : placeholder }));
    trigger.appendChild(el("span", { class: "dp-caret", html: "▾", attrs: { "aria-hidden": "true" } }));
  }

  function renderGrid() {
    grid.innerHTML = "";
    cellByDate = {};
    label.textContent = MONTH_NAMES[viewM] + " " + viewY;
    prevBtn.disabled = !canPrev();
    nextBtn.disabled = !canNext();

    const first = new Date(viewY, viewM, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first leading blanks
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const todayStr = ymd(new Date());

    for (let i = 0; i < lead; i++) grid.appendChild(el("span", { class: "dp-cell dp-blank" }));
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${viewY}-${String(viewM + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const has = availSet.has(ds);
      const cls = ["dp-cell", "dp-day"];
      if (!has) cls.push("is-disabled");
      if (has) cls.push(meta[ds] && meta[ds].blocked ? "is-blocked" : "has-data");
      if (ds === selDate) cls.push("is-selected");
      if (ds === todayStr) cls.push("is-today");
      const cell = el("button", {
        class: cls.join(" "),
        text: String(day),
        attrs: { type: "button", "data-date": ds, tabindex: "-1", "aria-label": prettyDate(ds) + (has ? "" : " — no update") },
      });
      if (!has) cell.setAttribute("aria-disabled", "true");
      if (ds === selDate) cell.setAttribute("aria-current", "date");
      if (has) cell.addEventListener("click", () => choose(ds));
      cell.addEventListener("keydown", onDayKey);
      cellByDate[ds] = cell;
      grid.appendChild(cell);
    }
  }

  function choose(ds) {
    selDate = ds;
    updateTrigger();
    if (onSelect) onSelect(ds);
    close();
    trigger.focus();
  }

  function focusDate(ds) {
    const d = parseYmd(ds);
    const mi = monthIndex(d.getFullYear(), d.getMonth());
    if (mi < minMi || mi > maxMi) return; // stay inside the data range
    if (d.getFullYear() !== viewY || d.getMonth() !== viewM) {
      viewY = d.getFullYear();
      viewM = d.getMonth();
      renderGrid();
    }
    const cell = cellByDate[ds];
    if (cell) cell.focus();
  }

  function onDayKey(e) {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -1;
    else if (e.key === "ArrowRight") delta = 1;
    else if (e.key === "ArrowUp") delta = -7;
    else if (e.key === "ArrowDown") delta = 7;
    else if (e.key === "Escape") { close(); trigger.focus(); return; }
    else return;
    e.preventDefault();
    const d = parseYmd(e.target.getAttribute("data-date"));
    d.setDate(d.getDate() + delta);
    focusDate(ymd(d));
  }

  let outside = null;
  function open() {
    if (!sorted.length) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    renderGrid();
    const focusTarget = (selDate && cellByDate[selDate]) || grid.querySelector(".dp-day.has-data, .dp-day.is-blocked") || grid.querySelector(".dp-day");
    if (focusTarget) focusTarget.focus();
    outside = (ev) => { if (!root.contains(ev.target)) { close(); } };
    document.addEventListener("mousedown", outside);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    if (outside) { document.removeEventListener("mousedown", outside); outside = null; }
  }

  trigger.addEventListener("click", () => { panel.hidden ? open() : close(); });
  trigger.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  prevBtn.addEventListener("click", () => { if (canPrev()) { if (--viewM < 0) { viewM = 11; viewY--; } renderGrid(); } });
  nextBtn.addEventListener("click", () => { if (canNext()) { if (++viewM > 11) { viewM = 0; viewY++; } renderGrid(); } });

  if (!sorted.length) trigger.disabled = true;
  updateTrigger();
  return { root, setSelected(ds) { selDate = ds; updateTrigger(); } };
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
    const tr = el("tr", { attrs: { "data-date": e.date } });
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

  // controls row: calendar date picker (blocked days flagged so gaps stand out)
  const dateMeta = {};
  for (const d of dates) {
    let blocked = false;
    for (const intern of STATE.interns) {
      const e = entryForDate(intern, d);
      if (e && e.has_blocker) { blocked = true; break; }
    }
    dateMeta[d] = { blocked };
  }
  const picker = makeDatePicker({
    selected: SELECTED_DATE,
    dates,
    meta: dateMeta,
    placeholder: "No data",
    onSelect: (d) => { SELECTED_DATE = d; redrawToday(root); },
  });

  root.appendChild(
    el("div", { class: "view-controls" }, [
      el("label", { text: "Day" }),
      picker.root,
    ])
  );

  root.appendChild(el("section", { class: "overview", attrs: { id: "overview", "aria-label": "Day summary" } }));
  const boardHead = el("div", { class: "section-head" }, [
    el("h2", { text: "Bulletin board" }),
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
    return;
  }

  const tableWrap = historyTable(s.entries);

  // Calendar to jump straight to a day instead of scrolling the whole log.
  const dates = s.entries.map((e) => e.date);
  const meta = {};
  s.entries.forEach((e) => { meta[e.date] = { blocked: e.has_blocker }; });
  const picker = makeDatePicker({
    selected: null,
    dates,
    meta,
    placeholder: "Latest",
    onSelect: (d) => {
      const rows = tableWrap.querySelectorAll("tr[data-date]");
      rows.forEach((r) => r.classList.toggle("is-focus", r.getAttribute("data-date") === d));
      const target = tableWrap.querySelector('tr[data-date="' + d + '"]');
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    },
  });
  root.appendChild(
    el("div", { class: "view-controls" }, [
      el("label", { text: "Jump to" }),
      picker.root,
    ])
  );

  root.appendChild(tableWrap);
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
