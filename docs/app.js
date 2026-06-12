// Static standup dashboard. Fetches ./data.json and renders a per-day board,
// summary stats, and a per-intern history table. No framework, no build step.

const FIELD_DEFS = [
  { key: "current_task", label: "Current Task" },
  { key: "yesterday", label: "Yesterday" },
  { key: "today_goal", label: "Today's Goal" },
  { key: "blockers", label: "Blockers" },
];

const AVATAR_COLORS = [
  "#4f6bff", "#8a5bff", "#1a9f64", "#e0483d",
  "#e08a1a", "#0ea5e9", "#d6409f", "#0f9b8e",
];

let STATE = { interns: [] };

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.style) node.setAttribute("style", opts.style);
  for (const c of children) node.appendChild(c);
  return node;
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatar(name, cls = "avatar") {
  const a = el("span", { class: cls, text: initials(name) });
  a.style.background = colorFor(name);
  return a;
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

/* ---------------------------------------------------------------- Theme */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("standup-theme", theme); } catch {}
}

function initTheme() {
  let theme;
  try { theme = localStorage.getItem("standup-theme"); } catch {}
  if (!theme) {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyTheme(theme);
  const btn = document.getElementById("theme-toggle");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

/* ---------------------------------------------------------------- Stats */

function renderStats(date) {
  const stats = document.getElementById("stats");
  stats.innerHTML = "";

  const total = STATE.interns.length;
  let submitted = 0;
  let blocked = 0;
  for (const intern of STATE.interns) {
    const entry = entryForDate(intern, date);
    if (entry) {
      submitted += 1;
      if (entry.has_blocker) blocked += 1;
    }
  }

  const cards = [
    { value: `${submitted}/${total}`, label: "Submitted", cls: submitted === total && total > 0 ? "is-ok" : "" },
    { value: String(blocked), label: blocked === 1 ? "Blocker" : "Blockers", cls: blocked > 0 ? "is-warn" : "is-ok" },
    { value: String(total - submitted), label: "Pending", cls: total - submitted > 0 ? "" : "is-ok" },
  ];

  for (const c of cards) {
    const stat = el("div", { class: "stat " + c.cls });
    stat.appendChild(el("span", { class: "stat-value", text: c.value }));
    stat.appendChild(el("span", { class: "stat-label", text: c.label }));
    stats.appendChild(stat);
  }
}

/* --------------------------------------------------------------- Controls */

function renderDateSelector(dates) {
  const select = document.getElementById("date-select");
  select.innerHTML = "";
  if (dates.length === 0) {
    select.appendChild(el("option", { text: "No data", value: "" }));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const d of dates) {
    select.appendChild(el("option", { text: formatDate(d), value: d }));
  }
  // Default to today if present, else the newest available date.
  const today = new Date().toISOString().slice(0, 10);
  select.value = dates.includes(today) ? today : dates[0];
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ----------------------------------------------------------------- Board */

function renderBoard(date) {
  const board = document.getElementById("board");
  board.innerHTML = "";

  STATE.interns.forEach((intern, i) => {
    const card = el("div", { class: "card" });
    card.style.animationDelay = `${i * 50}ms`;
    const entry = entryForDate(intern, date);

    const hasBlocker = entry && entry.has_blocker;
    const badge = el("span", {
      class: "badge " + (entry ? (hasBlocker ? "blocker" : "clear") : "none"),
      text: entry ? (hasBlocker ? "Blocked" : "Clear") : "No update",
    });

    const head = el("div", { class: "card-head" }, [
      avatar(intern.name),
      el("h3", { class: "name", text: intern.name }),
      badge,
    ]);
    card.appendChild(head);

    if (!entry) {
      card.appendChild(el("p", { class: "empty-state", text: "No update submitted yet." }));
      board.appendChild(card);
      return;
    }

    const fields = el("div", { class: "fields" });
    for (const f of FIELD_DEFS) {
      const value = entry[f.key] || "Not provided";
      const block = el("div", { class: "field-block" });
      if (f.key === "blockers") {
        block.classList.add("blocker");
        if (!entry.has_blocker) block.classList.add("none");
      }
      block.appendChild(el("div", { class: "field-label", text: f.label }));
      block.appendChild(el("div", { class: "field-value", text: value }));
      fields.appendChild(block);
    }
    card.appendChild(fields);

    if (entry.submitted_at) {
      card.appendChild(
        el("div", { class: "submitted-at", text: "Submitted " + formatTs(entry.submitted_at) })
      );
    }

    board.appendChild(card);
  });
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

/* --------------------------------------------------------------- History */

function renderHistory() {
  const container = document.getElementById("history");
  container.innerHTML = "";

  for (const intern of STATE.interns) {
    const wrap = el("div", { class: "history-intern" });
    wrap.appendChild(
      el("div", { class: "h-name" }, [avatar(intern.name), el("span", { text: intern.name })])
    );

    const entries = [...(intern.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

    if (entries.length === 0) {
      wrap.appendChild(el("p", { class: "history-empty", text: "No entries yet." }));
      container.appendChild(wrap);
      continue;
    }

    const table = el("table", { class: "history-table" });
    const thead = el("thead");
    const headRow = el("tr");
    ["Date", "Current Task", "Yesterday", "Today's Goal", "Blockers"].forEach((h) =>
      headRow.appendChild(el("th", { text: h }))
    );
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const e of entries) {
      const tr = el("tr");
      const dateTd = el("td", { class: "date-cell", text: formatDate(e.date) });
      tr.appendChild(dateTd);
      tr.appendChild(el("td", { text: e.current_task || "—" }));
      tr.appendChild(el("td", { text: e.yesterday || "—" }));
      tr.appendChild(el("td", { text: e.today_goal || "—" }));
      const blockerTd = el("td", { text: e.blockers || "None" });
      blockerTd.className = e.has_blocker ? "row-blocker" : "row-clear";
      tr.appendChild(blockerTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(el("div", { class: "table-wrap" }, [table]));
    container.appendChild(wrap);
  }
}

/* ------------------------------------------------------------------ Init */

async function init() {
  initTheme();

  let data;
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    data = await res.json();
  } catch (err) {
    document.getElementById("board").innerHTML =
      '<p class="empty-state">Could not load data.json.</p>';
    return;
  }

  STATE = data;

  const genEl = document.getElementById("generated-at");
  if (data.generated_at) genEl.textContent = "Updated " + formatTs(data.generated_at);

  const dates = allDates(data.interns);
  renderDateSelector(dates);

  const select = document.getElementById("date-select");
  const rerender = () => {
    renderStats(select.value);
    renderBoard(select.value);
  };
  select.addEventListener("change", rerender);

  rerender();
  renderHistory();
}

init();
