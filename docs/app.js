// Static standup dashboard. Fetches ./data.json and renders a per-day board
// plus a per-intern history table. No framework, no build step.

const FIELD_DEFS = [
  { key: "current_task", label: "Current Task" },
  { key: "yesterday", label: "Yesterday" },
  { key: "today_goal", label: "Today's Goal" },
  { key: "blockers", label: "Blockers" },
];

let STATE = { interns: [] };

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  for (const c of children) node.appendChild(c);
  return node;
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
    const opt = el("option", { text: d, value: d });
    select.appendChild(opt);
  }
  // Default to today if present, else the newest available date.
  const today = new Date().toISOString().slice(0, 10);
  select.value = dates.includes(today) ? today : dates[0];
}

function renderBoard(date) {
  const board = document.getElementById("board");
  board.innerHTML = "";

  for (const intern of STATE.interns) {
    const card = el("div", { class: "card" });
    const entry = entryForDate(intern, date);

    const hasBlocker = entry && entry.has_blocker;
    const badge = el("span", {
      class: "badge " + (hasBlocker ? "blocker" : "clear"),
      text: entry ? (hasBlocker ? "Blocked" : "Clear") : "—",
    });
    card.appendChild(el("h3", {}, [el("span", { text: intern.name }), badge]));

    if (!entry) {
      card.appendChild(el("p", { class: "empty-state", text: "No update yet today." }));
      board.appendChild(card);
      continue;
    }

    for (const f of FIELD_DEFS) {
      const value = entry[f.key] || "Not provided";
      const block = el("div", { class: "field-block" });
      if (f.key === "blockers") {
        block.classList.add("blocker");
        if (!entry.has_blocker) block.classList.add("none");
      }
      block.appendChild(el("div", { class: "field-label", text: f.label }));
      block.appendChild(el("div", { class: "field-value", text: value }));
      card.appendChild(block);
    }

    if (entry.submitted_at) {
      card.appendChild(
        el("div", { class: "submitted-at", text: "Submitted " + formatTs(entry.submitted_at) })
      );
    }

    board.appendChild(card);
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

function renderHistory() {
  const container = document.getElementById("history");
  container.innerHTML = "";

  for (const intern of STATE.interns) {
    const wrap = el("div", { class: "history-intern" });
    wrap.appendChild(el("h3", { text: intern.name }));

    const entries = [...(intern.entries || [])].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

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
      tr.appendChild(el("td", { text: e.date }));
      tr.appendChild(el("td", { text: e.current_task || "" }));
      tr.appendChild(el("td", { text: e.yesterday || "" }));
      tr.appendChild(el("td", { text: e.today_goal || "" }));
      const blockerTd = el("td", { text: e.blockers || "None" });
      blockerTd.className = e.has_blocker ? "blocker-cell row-blocker" : "row-clear";
      tr.appendChild(blockerTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }
}

async function init() {
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
  select.addEventListener("change", () => renderBoard(select.value));

  renderBoard(select.value);
  renderHistory();
}

init();
