// Static standup dashboard. Fetches ./data.json and renders an overview rail,
// a per-day board, and collapsible per-intern history. No framework, no build.
// Designed to look intentional from one intern up to many.

const FIELD_DEFS = [
  { key: "current_task", label: "Current Task" },
  { key: "previous_workday", label: "Previous Workday" },
  { key: "today_goal", label: "Today's Goal" },
  { key: "blockers", label: "Blockers", span: true },
];

let STATE = { interns: [] };

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.value != null) node.value = opts.value;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
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
  for (const intern of interns) {
    for (const e of intern.entries || []) set.add(e.date);
  }
  return [...set].sort().reverse(); // newest first
}

function entryForDate(intern, date) {
  return (intern.entries || []).find((e) => e.date === date) || null;
}

function prettyDate(date) {
  try {
    const d = new Date(date + "T00:00:00");
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function formatTs(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function renderDateSelector(dates) {
  const select = document.getElementById("date-select");
  select.innerHTML = "";
  if (dates.length === 0) {
    select.appendChild(el("option", { text: "No data", value: "" }));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const d of dates) select.appendChild(el("option", { text: prettyDate(d), value: d }));
  const today = new Date().toISOString().slice(0, 10);
  select.value = dates.includes(today) ? today : dates[0];
}

// ── Overview rail ───────────────────────────────────────────────────────────
function renderOverview(date) {
  const wrap = document.getElementById("overview");
  wrap.innerHTML = "";

  const total = STATE.interns.length;
  let reported = 0;
  let blocked = 0;
  for (const intern of STATE.interns) {
    const entry = date ? entryForDate(intern, date) : null;
    if (entry) {
      reported += 1;
      if (entry.has_blocker) blocked += 1;
    }
  }
  const awaiting = total - reported;

  const stats = [
    { value: total, label: "Interns", sub: total === 1 ? "on the roster" : "on the roster", cls: "" },
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
    wrap.appendChild(card);
  });
}

// ── Board ───────────────────────────────────────────────────────────────────
function renderBoard(date) {
  const board = document.getElementById("board");
  board.innerHTML = "";
  document.getElementById("board-date").textContent = date ? prettyDate(date) : "";

  if (STATE.interns.length === 0) {
    board.appendChild(
      el("div", { class: "empty-state", html: "<strong>No interns yet</strong>Add interns to the roster and their updates will appear here." })
    );
    return;
  }

  STATE.interns.forEach((intern, i) => {
    const entry = entryForDate(intern, date);
    const hasBlocker = entry && entry.has_blocker;

    const card = el("div", {
      class: "card" + (hasBlocker ? " is-blocked" : "") + (!entry ? " is-missing" : ""),
    });
    card.style.setProperty("--i", i);

    // header: avatar + name + status pill
    const idWrap = el("div", { class: "card-id" }, [
      el("span", { class: "avatar", text: initials(intern.name), attrs: { "aria-hidden": "true" } }),
      el("h3", { class: "card-name", text: intern.name }),
    ]);

    let pill;
    if (!entry) {
      pill = el("span", { class: "pill none" }, [el("span", { class: "dot" }), el("span", { text: "Awaiting" })]);
    } else if (hasBlocker) {
      pill = el("span", { class: "pill blocked" }, [el("span", { class: "dot" }), el("span", { text: "Blocked" })]);
    } else {
      pill = el("span", { class: "pill ok" }, [el("span", { class: "dot" }), el("span", { text: "On track" })]);
    }
    card.appendChild(el("div", { class: "card-head" }, [idWrap, pill]));

    if (!entry) {
      card.appendChild(el("div", { class: "card-missing-note", text: "No update submitted for this day." }));
      board.appendChild(card);
      return;
    }

    // fields
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
      block.appendChild(
        el("div", { class: "field-value" + (raw && String(raw).trim() ? "" : " empty"), text: value })
      );
      fields.appendChild(block);
    }
    card.appendChild(fields);

    if (entry.submitted_at) {
      card.appendChild(el("div", { class: "card-foot", text: "Submitted " + formatTs(entry.submitted_at) }));
    }

    board.appendChild(card);
  });
}

// ── History (collapsible per intern) ────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById("history");
  container.innerHTML = "";
  const meta = document.getElementById("history-meta");

  if (STATE.interns.length === 0) {
    meta.textContent = "";
    container.appendChild(el("div", { class: "empty-state", text: "No history yet." }));
    return;
  }

  meta.textContent = STATE.interns.length + (STATE.interns.length === 1 ? " intern" : " interns");
  const openByDefault = STATE.interns.length <= 4; // keep it tidy once the team grows

  for (const intern of STATE.interns) {
    const entries = [...(intern.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

    const details = el("details", { class: "history-intern" });
    if (openByDefault && entries.length > 0) details.setAttribute("open", "");

    const summary = el("summary", {}, [
      el("span", { class: "summary-name", text: intern.name }),
      el("span", {
        class: "summary-count",
        text: entries.length + (entries.length === 1 ? " entry" : " entries"),
      }),
      el("span", { class: "summary-chevron", text: "›", attrs: { "aria-hidden": "true" } }),
    ]);
    details.appendChild(summary);

    if (entries.length === 0) {
      details.appendChild(el("div", { class: "card-missing-note", html: "<div style='padding:0.9rem 1.1rem'>No entries yet.</div>" }));
      container.appendChild(details);
      continue;
    }

    const table = el("table", { class: "history-table" });
    const headRow = el("tr");
    ["Date", "Current Task", "Previous Workday", "Today's Goal", "Blockers"].forEach((h) =>
      headRow.appendChild(el("th", { text: h }))
    );
    table.appendChild(el("thead", {}, [headRow]));

    const tbody = el("tbody");
    for (const e of entries) {
      const tr = el("tr");
      tr.appendChild(el("td", { text: e.date }));
      tr.appendChild(el("td", { text: e.current_task || "—" }));
      tr.appendChild(el("td", { text: e.previous_workday || "—" }));
      tr.appendChild(el("td", { text: e.today_goal || "—" }));
      const blockerTd = el("td", { text: e.blockers || "None" });
      blockerTd.className = e.has_blocker ? "row-blocker" : "row-clear";
      tr.appendChild(blockerTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(details);
    details.appendChild(el("div", { class: "table-scroll" }, [table]));
  }
}

// ── Weekly reports (one technical paragraph per intern per week) ────────────
function prettyWeek(start, end) {
  const a = prettyDate(start);
  const b = prettyDate(end);
  return `${a} – ${b}`;
}

function renderWeekly() {
  const container = document.getElementById("weekly");
  if (!container) return;
  container.innerHTML = "";
  const meta = document.getElementById("weekly-meta");

  // Total weekly reports across all interns (to decide whether to show anything).
  const totalReports = STATE.interns.reduce(
    (n, intern) => n + (intern.weekly ? intern.weekly.length : 0),
    0
  );

  if (STATE.interns.length === 0 || totalReports === 0) {
    if (meta) meta.textContent = "";
    container.appendChild(
      el("div", {
        class: "empty-state",
        html: "<strong>No weekly reports yet</strong>The first summary is generated on the Tuesday after a full work week.",
      })
    );
    return;
  }

  if (meta) meta.textContent = totalReports + (totalReports === 1 ? " report" : " reports");
  const openByDefault = STATE.interns.length <= 4;

  for (const intern of STATE.interns) {
    const weeks = [...(intern.weekly || [])].sort((a, b) =>
      b.week_start.localeCompare(a.week_start)
    );

    const details = el("details", { class: "history-intern" });
    if (openByDefault && weeks.length > 0) details.setAttribute("open", "");

    details.appendChild(
      el("summary", {}, [
        el("span", { class: "summary-name", text: intern.name }),
        el("span", {
          class: "summary-count",
          text: weeks.length + (weeks.length === 1 ? " week" : " weeks"),
        }),
        el("span", { class: "summary-chevron", text: "›", attrs: { "aria-hidden": "true" } }),
      ])
    );

    const body = el("div", { class: "weekly-body" });
    if (weeks.length === 0) {
      body.appendChild(el("div", { class: "card-missing-note", text: "No weekly reports yet." }));
    } else {
      for (const w of weeks) {
        const noData = w.status === "no_data";
        const block = el("div", { class: "weekly-week" + (noData ? " is-empty" : "") });
        block.appendChild(el("div", { class: "weekly-range", text: prettyWeek(w.week_start, w.week_end) }));
        block.appendChild(
          el("p", { class: "weekly-summary" + (noData ? " empty" : ""), text: w.summary || "—" })
        );
        body.appendChild(block);
      }
    }
    details.appendChild(body);
    container.appendChild(details);
  }
}

async function init() {
  let data;
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    data = await res.json();
  } catch (err) {
    document.getElementById("board").innerHTML =
      '<div class="empty-state"><strong>Could not load data</strong>data.json is missing or invalid.</div>';
    return;
  }

  STATE = data;

  const genEl = document.getElementById("generated-at");
  if (data.generated_at) genEl.textContent = "Updated " + formatTs(data.generated_at);

  const dates = allDates(data.interns);
  renderDateSelector(dates);

  const select = document.getElementById("date-select");
  const draw = () => {
    renderOverview(select.value);
    renderBoard(select.value);
  };
  select.addEventListener("change", draw);

  draw();
  renderWeekly();
  renderHistory();
}

init();
