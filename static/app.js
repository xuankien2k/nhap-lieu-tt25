const state = {
  schema: null,
  fields: [],
  info: null,
  batches: [],
  batchId: null,
  patients: [],
  activeId: null,
  snapshot: {},
  dirty: new Set(),
  query: "",
  editorName: localStorage.getItem("ksk-editor") || "",
  saving: false,
  saveTimer: null,
  status: "Sẵn sàng",
};

let silent = false;

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

function fold(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function haystack(data) {
  const cccd = fold(data.E).replace(/\s+/g, "");
  return `${fold(data.B)} ${cccd} ${fold(data.MA_KCB)}`;
}

function matches(data, query) {
  if (!query) return true;
  const folded = fold(query).trim();
  if (!folded) return true;
  const compact = folded.replace(/\s+/g, "");
  return haystack(data).includes(folded) || fold(data.E).replace(/\s+/g, "").includes(compact);
}

function toast(message, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast show ${kind}`.trim();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3400);
}

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...opts, headers, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === "string" ? detail : "Không thực hiện được thao tác";
    const error = new Error(message);
    error.data = data;
    throw error;
  }
  return data;
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function genderLabel(value) {
  return state.schema.gender_options.find((item) => item.value === value)?.label || "";
}

function gradeLabel(value) {
  return state.schema.grade_options.find((item) => item.value === value)?.label || "";
}

function fieldByCol(col) {
  return state.fields.find((field) => field.col === col);
}

function toISO(dmy) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dmy || "").trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function toDMY(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function currentBatch() {
  return state.batches.find((batch) => batch.id === state.batchId) || null;
}

function requiredStats(data) {
  const total = state.schema.required.length;
  const done = state.schema.required.filter((col) => (data[col] || "").trim()).length;
  return { done, total };
}

function folderSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ficon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z");
  svg.append(path);
  return svg;
}

function mount() {
  document.getElementById("app").append(
    h("div", { class: "layout", id: "layout" }, [
      h("aside", { class: "rail", id: "rail" }),
      h("section", { class: "stage", id: "stage" }),
      h("aside", { class: "drawer", id: "drawer", "aria-hidden": "true" }),
    ]),
  );
  document.addEventListener("click", () => {
    document.querySelectorAll(".sync-drop").forEach((item) => {
      item.hidden = true;
    });
  });
  renderRail();
  renderStage();
}

function setEditorOpen(open) {
  const drawer = document.getElementById("drawer");
  document.getElementById("layout")?.classList.toggle("editing", open);
  if (!drawer) return;
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    if (!drawer.classList.contains("open")) {
      requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add("open")));
    }
  } else {
    drawer.classList.remove("open");
  }
}

function renderRail() {
  const rail = document.getElementById("rail");
  const editor = h("input", { id: "editor-name", autocomplete: "name", placeholder: "Ví dụ: Điều dưỡng Lan" });
  editor.value = state.editorName;
  editor.addEventListener("input", () => {
    state.editorName = editor.value;
    localStorage.setItem("ksk-editor", editor.value);
  });
  rail.replaceChildren(
    h("div", { class: "brand" }, [
      h("p", { class: "brand-kicker" }, ["Sổ dùng chung"]),
      h("h1", { class: "brand-title" }, ["Khám sức khỏe"]),
      h("p", {}, ["Mỗi đoàn là một thư mục. Mở ra để nhập từng người."]),
    ]),
    h("div", { class: "rail-actions" }, [
      h("button", { class: "btn btn-primary", type: "button", onClick: showCreate }, ["Tạo đoàn"]),
      h("button", { class: "btn btn-line", type: "button", onClick: () => showImport() }, ["Nhập Excel"]),
    ]),
    h("div", { class: "folder-list", id: "folder-list" }),
    h("div", { class: "rail-foot" }, [
      h("label", { class: "editor-label" }, ["Tên người nhập", editor]),
      h("div", { class: "lan-box", id: "lan-box" }, ["Đang lấy địa chỉ mạng…"]),
    ]),
  );
  paintFolders();
  paintLan();
}

function paintLan() {
  const box = document.getElementById("lan-box");
  if (!box) return;
  const urls = state.info?.urls || [];
  box.replaceChildren(h("div", {}, ["Máy khác trong LAN mở:"]));
  if (!urls.length) {
    box.append(h("div", {}, ["http://127.0.0.1:8787"]));
    return;
  }
  for (const url of urls) box.append(h("div", {}, [url]));
  const copy = h("button", { type: "button" }, ["Sao chép địa chỉ"]);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urls[0]);
      toast("Đã sao chép địa chỉ");
    } catch {
      toast(urls[0]);
    }
  });
  box.append(copy);
}

function paintFolders() {
  const list = document.getElementById("folder-list");
  if (!list) return;
  if (!state.batches.length) {
    list.replaceChildren(h("p", { class: "folder-meta" }, ["Chưa có đoàn nào."]));
    return;
  }
  list.replaceChildren(
    ...state.batches.map((batch) => {
      const button = h("button", { class: `folder${batch.id === state.batchId ? " active" : ""}`, type: "button" }, [
        folderSvg(),
        h("span", {}, [
          h("span", { class: "folder-name" }, [batch.name]),
          h("span", { class: "folder-meta" }, [`${batch.patient_count} người · ${batch.source_filename || "tạo tay"}`]),
        ]),
      ]);
      button.addEventListener("click", () => openBatch(batch.id));
      return button;
    }),
  );
}

function renderStage() {
  const stage = document.getElementById("stage");
  if (!state.batchId) {
    stage.replaceChildren(homeView());
    return;
  }
  stage.replaceChildren(batchView());
  paintTable();
}

function homeView() {
  const wrap = h("div", { class: "home" }, [
    h("div", { class: "home-lead" }, [
      h("h1", {}, ["Danh sách đoàn khám"]),
      h("p", {}, ["Nhập file Excel theo mẫu sổ khám. Mỗi file thành một đoàn, tách riêng như từng thư mục. Trong đoàn, bấm một người để sửa ở bảng bên cạnh."]),
    ]),
  ]);
  if (!state.batches.length) {
    wrap.append(h("div", { class: "empty-home" }, [
      h("p", {}, ["Kéo thả file .xlsx vào đây, hoặc bấm Nhập Excel."]),
      h("button", { class: "btn", type: "button", onClick: () => showImport() }, ["Nhập file Excel"]),
    ]));
    return wrap;
  }
  const grid = h("div", { class: "card-grid" });
  for (const batch of state.batches) {
    const card = h("article", { class: "manila" }, [
      h("div", { class: "manila-tab" }),
      h("h2", {}, [batch.name]),
      h("p", { class: "manila-file" }, [batch.source_filename ? `File: ${batch.source_filename}` : "Tạo trong ứng dụng, xuất theo mẫu chuẩn"]),
      h("div", { class: "manila-stats" }, [
        h("div", { class: "stat" }, [h("strong", {}, [String(batch.patient_count)]), h("span", {}, ["bệnh nhân"])]),
        h("div", { class: "stat" }, [h("strong", {}, [String(batch.concluded_count)]), h("span", {}, ["đã phân loại"])]),
      ]),
      h("p", { class: "manila-note" }, [batch.note || `Nhập lúc ${fmtTime(batch.created_at)}`]),
      h("div", { class: "manila-actions" }, [
        h("button", { class: "btn btn-small", type: "button", onClick: () => openBatch(batch.id) }, ["Mở đoàn"]),
        h("button", { class: "btn btn-line btn-small", type: "button", onClick: () => exportBatch(batch.id) }, ["Xuất Excel"]),
        h("button", { class: "btn btn-danger btn-small", type: "button", onClick: () => removeBatch(batch.id) }, ["Xóa"]),
      ]),
    ]);
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

function batchView() {
  const batch = currentBatch();
  const name = h("input", { class: "name-input", id: "batch-name", "aria-label": "Tên đoàn" });
  name.value = batch?.name || "";
  name.addEventListener("change", () => saveBatchMeta());
  const note = h("textarea", { class: "note-input", id: "batch-note", rows: "2", placeholder: "Ghi chú đoàn: đơn vị, ngày khám, địa điểm…" });
  note.value = batch?.note || "";
  note.addEventListener("change", () => saveBatchMeta());
  const search = h("input", {
    class: "search",
    id: "list-search",
    "data-search": "1",
    placeholder: "Tìm trong đoàn này theo họ tên hoặc số CCCD",
    autocomplete: "off",
  });
  search.value = state.query;
  search.addEventListener("input", () => onSearch(search));
  return h("div", { class: "batch" }, [
    h("div", { class: "batch-head" }, [
      h("button", { class: "btn btn-line btn-small", type: "button", onClick: leaveBatch }, ["Tất cả đoàn"]),
      name,
      h("div", { class: "tools" }, [
        h("button", { class: "btn btn-small", type: "button", onClick: addPatient }, ["Thêm bệnh nhân"]),
        syncMenu(),
        h("button", { class: "btn btn-line btn-small", type: "button", onClick: () => exportBatch(state.batchId) }, ["Xuất Excel"]),
        h("button", { class: "btn btn-danger btn-small", type: "button", onClick: () => removeBatch(state.batchId) }, ["Xóa đoàn"]),
      ]),
      h("p", { class: "meta", id: "batch-meta" }, [batchMetaText(batch)]),
      note,
    ]),
    h("div", { class: "list-tools" }, [
      search,
      h("span", { class: "match-count", id: "match-count" }),
    ]),
    h("div", { class: "table-wrap" }, [
      h("table", { class: "patients" }, [
        h("thead", {}, [
          h("tr", {}, ["STT", "Họ và tên", "Ngày sinh", "Giới", "CCCD", "Điện thoại", "Mã KCB", "Phân loại", "Bắt buộc"].map((label) => h("th", {}, [label]))),
        ]),
        h("tbody", { id: "patient-body" }),
      ]),
    ]),
  ]);
}

function batchMetaText(batch) {
  if (!batch) return "";
  const file = batch.source_filename ? `File gốc: ${batch.source_filename}` : "Chưa gắn file gốc";
  return `${batch.patient_count} người · ${batch.concluded_count} đã phân loại sức khỏe · ${file} · cập nhật ${fmtTime(batch.updated_at)}`;
}

function paintBatchHeader() {
  const meta = document.getElementById("batch-meta");
  const batch = currentBatch();
  if (meta && batch) meta.textContent = batchMetaText(batch);
  const name = document.getElementById("batch-name");
  if (name && document.activeElement !== name && batch) name.value = batch.name;
}

function paintTable() {
  const body = document.getElementById("patient-body");
  if (!body) return;
  const rows = state.patients.filter((patient) => matches(patient.data, state.query));
  if (!rows.length) {
    body.replaceChildren(h("tr", {}, [h("td", { colspan: "9", class: "sub" }, [state.query ? "Không có người nào trong đoàn này khớp từ khóa." : "Đoàn chưa có bệnh nhân."])]));
  } else {
    body.replaceChildren(...rows.map((patient) => patientRow(patient)));
  }
  const count = document.getElementById("match-count");
  if (count) {
    count.textContent = state.query ? `${rows.length} người trong đoàn này` : `${state.patients.length} người`;
  }
  paintJumpList();
}

function patientRow(patient) {
  const data = patient.data;
  const stats = requiredStats(data);
  const tr = h("tr", { class: patient.id === state.activeId ? "selected" : "", "data-id": patient.id }, [
    h("td", {}, [data.A || ""]),
    h("td", {}, [h("button", { class: "person col-name", type: "button" }, [data.B || "Chưa có tên"])]),
    h("td", {}, [data.C || "—"]),
    h("td", {}, [genderLabel(data.D) || "—"]),
    h("td", { class: "col-cccd" }, [data.E || "—"]),
    h("td", {}, [data.I || "—"]),
    h("td", {}, [data.MA_KCB || "—"]),
    h("td", {}, [data.CW ? h("span", { class: "pill done" }, [`${data.CW} · ${gradeLabel(data.CW)}`]) : h("span", { class: "pill" }, ["Chưa có"])]),
    h("td", {}, [
      h("div", { class: "bar", title: `${stats.done}/${stats.total} mục bắt buộc` }, [
        h("span", { style: `width:${Math.round((stats.done / stats.total) * 100)}%` }),
      ]),
    ]),
  ]);
  tr.addEventListener("click", () => openPatient(patient.id));
  return tr;
}

function onSearch(source) {
  state.query = source.value;
  document.querySelectorAll("[data-search]").forEach((input) => {
    if (input !== source) input.value = state.query;
  });
  paintTable();
}

function renderDrawer() {
  const drawer = document.getElementById("drawer");
  const patient = state.patients.find((item) => item.id === state.activeId);
  if (!patient) {
    setEditorOpen(false);
    return;
  }
  const search = h("input", {
    class: "search",
    id: "drawer-search",
    "data-search": "1",
    placeholder: "Tìm trong đoàn này theo họ tên hoặc CCCD",
    autocomplete: "off",
  });
  search.value = state.query;
  search.addEventListener("input", () => onSearch(search));
  const chips = h("div", { class: "chips" });
  const body = h("div", { class: "drawer-body", id: "drawer-body" });
  state.schema.sections.forEach((section, index) => {
    const cols = section.groups.flatMap((group) => group.fields.map((field) => field.col));
    const filled = cols.filter((col) => (state.snapshot[col] || "").trim()).length;
    const chip = h("button", { class: `chip${index === 0 ? " on" : ""}`, type: "button", "data-chip": section.id }, [
      section.title,
      h("span", { class: "count" }, [`${filled}/${cols.length}`]),
    ]);
    chip.addEventListener("click", () => {
      document.getElementById(`sec-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      drawer.querySelectorAll(".chip").forEach((item) => item.classList.toggle("on", item === chip));
    });
    chips.append(chip);
    const block = h("section", { id: `sec-${section.id}` }, [h("h3", { class: "section-title" }, [section.title])]);
    for (const group of section.groups) {
      const grid = h("div", { class: "form-grid" });
      for (const field of group.fields) grid.append(fieldNode(field, state.snapshot[field.col] || ""));
      block.append(h("div", { class: "group" }, [h("h4", { class: "group-title" }, [group.title]), grid]));
    }
    body.append(block);
  });
  drawer.replaceChildren(
    h("div", { class: "drawer-top" }, [
      h("div", {}, [
        h("h2", { class: "who-name", id: "who-name" }, [patient.data.B || "Bệnh nhân mới"]),
        h("p", { class: "who-sub", id: "who-sub" }, [whoSub(patient)]),
        h("p", { class: "cccd-warn", id: "cccd-warn" }),
      ]),
      h("button", { class: "close", type: "button", onClick: closeDrawer, "aria-label": "Đóng" }, ["×"]),
    ]),
    h("div", { class: "jump" }, [search, h("div", { class: "jump-list", id: "jump-list", hidden: true })]),
    chips,
    body,
    h("div", { class: "drawer-foot" }, [
      h("span", { class: "status", id: "save-status" }, [state.status]),
      h("div", { class: "tools" }, [
        h("button", { class: "btn btn-danger btn-small", type: "button", onClick: removePatient }, ["Xóa người này"]),
        h("button", { class: "btn btn-small", type: "button", onClick: () => savePatient(true) }, ["Lưu"]),
      ]),
    ]),
  );
  setEditorOpen(true);
  paintCccdWarn();
  paintJumpList();
  refreshChips();
  markClinicalReview();
  applyGyneLock();
}

function whoSub(patient) {
  const bits = [];
  if (patient.data.A) bits.push(`STT ${patient.data.A}`);
  if (patient.data.MA_KCB) bits.push(`Mã KCB ${patient.data.MA_KCB}`);
  if (patient.data.E) bits.push(`CCCD ${patient.data.E}`);
  if (patient.updated_by) bits.push(`sửa bởi ${patient.updated_by}`);
  bits.push(fmtTime(patient.updated_at));
  return bits.filter(Boolean).join(" · ");
}

function fieldNode(field, value) {
  const name = h("span", { class: "field-name" }, [field.label]);
  if (field.required) name.append(h("span", { class: "req" }, [" *"]));
  const label = h("label", { for: `f-${field.col}` }, [name]);
  if (field.hint) label.append(h("span", { class: "hint" }, [field.hint]));
  return h("div", { class: `field${field.wide ? " wide" : ""}` }, [label, control(field, value)]);
}

function control(field, value) {
  const id = `f-${field.col}`;
  if (field.type === "gender" || field.type === "grade") {
    const select = h("select", { id });
    select.append(h("option", { value: "" }, ["—"]));
    const options = field.type === "gender" ? state.schema.gender_options : state.schema.grade_options;
    for (const option of options) {
      const node = h("option", { value: option.value }, [`${option.value} — ${option.label}`]);
      if (value === option.value) node.selected = true;
      select.append(node);
    }
    select.addEventListener("change", () => onEdit(field.col));
    return select;
  }
  if (field.type === "textarea") {
    const area = h("textarea", { id, rows: "3" });
    area.value = value;
    area.addEventListener("input", () => onEdit(field.col));
    return area;
  }
  if (field.type === "date") {
    const input = h("input", { id, type: "date" });
    input.value = toISO(value);
    input.addEventListener("change", () => onEdit(field.col));
    return input;
  }
  const input = h("input", {
    id,
    type: "text",
    autocomplete: "off",
    inputmode: field.type === "number" ? "decimal" : "text",
    placeholder: field.type === "number" ? "Số" : "",
  });
  input.value = value;
  input.addEventListener("input", () => onEdit(field.col));
  return input;
}

function readField(col) {
  const el = document.getElementById(`f-${col}`);
  if (!el) return state.snapshot[col] || "";
  const field = fieldByCol(col);
  if (field?.type === "date") return toDMY(el.value);
  return el.value;
}

function setControl(col, value) {
  const el = document.getElementById(`f-${col}`);
  if (!el) return;
  const field = fieldByCol(col);
  silent = true;
  el.value = field?.type === "date" ? toISO(value) : value || "";
  silent = false;
}

function onEdit(col) {
  if (silent) return;
  state.dirty.add(col);
  setStatus("Chưa lưu");
  if (col === "B" || col === "E" || col === "A") paintIdentity();
  if (col === "E") paintCccdWarn();
  refreshChips();
  markClinicalReview();
  if (col === "D") clearGyneIfMale();
  applyGyneLock();
  scheduleSave();
}

function paintIdentity() {
  const name = document.getElementById("who-name");
  if (name) name.textContent = readField("B") || "Bệnh nhân mới";
  const sub = document.getElementById("who-sub");
  const patient = state.patients.find((item) => item.id === state.activeId);
  if (sub && patient) {
    sub.textContent = whoSub({ ...patient, data: { ...patient.data, A: readField("A"), B: readField("B"), E: readField("E") } });
  }
}

function paintCccdWarn() {
  const el = document.getElementById("cccd-warn");
  if (!el) return;
  const cccd = readField("E").trim();
  if (!cccd) {
    el.textContent = "";
    return;
  }
  const other = state.patients.find((patient) => patient.id !== state.activeId && (patient.data.E || "").trim() === cccd);
  el.textContent = other ? `Số CCCD này đang trùng với ${other.data.B || "một người khác"} trong đoàn.` : "";
}

function refreshChips() {
  for (const section of state.schema.sections) {
    const cols = section.groups.flatMap((group) => group.fields.map((field) => field.col));
    const filled = cols.filter((col) => readField(col).trim()).length;
    const count = document.querySelector(`[data-chip="${section.id}"] .count`);
    if (count) count.textContent = `${filled}/${cols.length}`;
  }
}

function paintJumpList() {
  const list = document.getElementById("jump-list");
  if (!list) return;
  const query = state.query.trim();
  if (!query) {
    list.hidden = true;
    list.replaceChildren();
    return;
  }
  const found = state.patients.filter((patient) => matches(patient.data, query)).slice(0, 8);
  list.hidden = false;
  if (!found.length) {
    list.replaceChildren(h("div", { class: "jump-item" }, ["Không có trong đoàn này"]));
    return;
  }
  list.replaceChildren(
    ...found.map((patient) => {
      const button = h("button", { class: `jump-item${patient.id === state.activeId ? " active" : ""}`, type: "button" }, [
        h("strong", {}, [patient.data.B || "Chưa có tên"]),
        h("div", { class: "sub" }, [[patient.data.E, patient.data.C].filter(Boolean).join(" · ") || "Chưa có CCCD"]),
      ]);
      button.addEventListener("click", () => openPatient(patient.id));
      return button;
    }),
  );
}

function setStatus(text) {
  state.status = text;
  const el = document.getElementById("save-status");
  if (el) el.textContent = text;
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => savePatient(false), 700);
}

async function savePatient(manual) {
  if (!state.activeId || state.dirty.size === 0 || state.saving) return;
  const id = state.activeId;
  const cols = [...state.dirty];
  const fields = {};
  const base = {};
  for (const col of cols) {
    fields[col] = readField(col);
    base[col] = state.snapshot[col] ?? "";
  }
  state.saving = true;
  setStatus("Đang lưu…");
  try {
    const result = await api(`/api/patients/${id}`, {
      method: "PATCH",
      body: { fields, base, editor: state.editorName },
    });
    const conflicts = new Set(result.conflicts || []);
    const patient = state.patients.find((item) => item.id === id);
    if (patient) {
      patient.data = result.patient.data;
      patient.updated_at = result.patient.updated_at;
      patient.updated_by = result.patient.updated_by;
    }
    if (state.activeId === id) {
      state.snapshot = { ...result.patient.data };
      for (const col of cols) {
        if (conflicts.has(col)) {
          setControl(col, result.patient.data[col] || "");
          state.dirty.delete(col);
        } else if (readField(col) !== (result.patient.data[col] || "")) {
          state.dirty.add(col);
        } else {
          state.dirty.delete(col);
        }
      }
      paintIdentity();
      paintCccdWarn();
      if (conflicts.size) toast("Một số ô vừa được người khác sửa. Đã giữ bản trên máy chủ.", "warn");
      setStatus(state.dirty.size ? "Chưa lưu" : `Đã lưu${result.patient.updated_by ? " · " + result.patient.updated_by : ""}`);
    }
    paintTable();
    if (manual && !conflicts.size && state.activeId === id && !state.dirty.size) toast("Đã lưu");
    if (state.dirty.size && state.activeId === id) scheduleSave();
  } catch (error) {
    setStatus("Lỗi lưu");
    toast(error.message, "bad");
  } finally {
    state.saving = false;
  }
}

async function openBatch(id) {
  await savePatient(false);
  state.batchId = id;
  state.query = "";
  state.activeId = null;
  state.dirty.clear();
  setEditorOpen(false);
  state.patients = await api(`/api/batches/${id}/patients`);
  paintFolders();
  renderStage();
}

async function leaveBatch() {
  await closeDrawer();
  state.batchId = null;
  state.patients = [];
  state.query = "";
  paintFolders();
  renderStage();
}

async function openPatient(id) {
  if (state.activeId && state.activeId !== id) await savePatient(false);
  state.activeId = id;
  const patient = state.patients.find((item) => item.id === id);
  state.snapshot = { ...(patient?.data || {}) };
  state.dirty.clear();
  setStatus("Sẵn sàng");
  renderDrawer();
  paintTable();
}

async function closeDrawer() {
  await savePatient(false);
  state.activeId = null;
  state.dirty.clear();
  setEditorOpen(false);
  paintTable();
}

async function reloadBatches() {
  state.batches = await api("/api/batches");
  paintFolders();
  if (!state.batchId) renderStage();
  else paintBatchHeader();
}

async function addPatient() {
  await savePatient(false);
  const patient = await api(`/api/batches/${state.batchId}/patients`, {
    method: "POST",
    body: { editor: state.editorName },
  });
  state.patients = await api(`/api/batches/${state.batchId}/patients`);
  await reloadBatches();
  await openPatient(patient.id);
  document.getElementById("f-B")?.focus();
}

async function removePatient() {
  const patient = state.patients.find((item) => item.id === state.activeId);
  if (!patient) return;
  const name = patient.data.B || "người này";
  if (!confirm(`Xóa ${name} khỏi đoàn?`)) return;
  const id = patient.id;
  state.dirty.clear();
  await api(`/api/patients/${id}`, { method: "DELETE" });
  state.patients = state.patients.filter((item) => item.id !== id);
  state.activeId = null;
  setEditorOpen(false);
  await reloadBatches();
  paintTable();
  toast("Đã xóa khỏi đoàn");
}

async function saveBatchMeta() {
  const batch = currentBatch();
  if (!batch) return;
  const name = document.getElementById("batch-name").value;
  const note = document.getElementById("batch-note").value;
  const updated = await api(`/api/batches/${batch.id}`, { method: "PATCH", body: { name, note } });
  const index = state.batches.findIndex((item) => item.id === batch.id);
  if (index >= 0) state.batches[index] = updated;
  paintFolders();
  paintBatchHeader();
}

function exportBatch(id) {
  const link = document.createElement("a");
  link.href = `/api/batches/${id}/export`;
  link.click();
}

async function removeBatch(id) {
  const batch = state.batches.find((item) => item.id === id);
  if (!batch) return;
  if (!confirm(`Xóa đoàn "${batch.name}" và toàn bộ bệnh nhân trong đoàn?`)) return;
  await api(`/api/batches/${id}`, { method: "DELETE" });
  if (state.batchId === id) {
    state.batchId = null;
    state.patients = [];
    state.activeId = null;
    setEditorOpen(false);
  }
  await reloadBatches();
  if (!state.batchId) renderStage();
  toast("Đã xóa đoàn");
}

function batchHasKcb() {
  return state.patients.some((patient) => (patient.data.MA_KCB || "").trim());
}

function syncMenu() {
  const menu = h("div", { class: "sync-drop", hidden: true }, [
    h("button", { type: "button", onClick: showSyncKcb }, ["Đồng bộ mã KCB"]),
    h("button", { type: "button", onClick: showSyncClinical }, ["Đồng bộ khám lâm sàng"]),
    h("button", { type: "button", onClick: showSyncCls }, ["Đồng bộ khám cận lâm sàng"]),
  ]);
  const button = h("button", { class: "btn btn-line btn-small", type: "button" }, ["Đồng bộ"]);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    document.querySelectorAll(".sync-drop").forEach((item) => {
      item.hidden = true;
    });
    menu.hidden = !willOpen;
  });
  menu.addEventListener("click", () => {
    menu.hidden = true;
  });
  return h("div", { class: "sync-menu" }, [button, menu]);
}

function showSyncClinical() {
  if (!batchHasKcb()) {
    toast("Hãy đồng bộ mã KCB trước khi đồng bộ khám lâm sàng.", "warn");
    return;
  }
  const file = h("input", { type: "file", accept: ".xlsx" });
  openModal(
    "Đồng bộ khám lâm sàng",
    [
      h("p", {}, ["Chọn file khám lâm sàng có mã KCB. Huyết áp được tách thành tâm thu và tâm trương. Chỉ số bình thường được phân loại 1. Chỉ số khác để trống phân loại và hiện đỏ khi mở phiếu. Mã KCB không có trong đoàn sẽ được bỏ qua."]),
      file,
    ],
    async () => {
      const picked = file.files[0];
      if (!picked) throw new Error("Hãy chọn file Excel");
      const form = new FormData();
      form.append("file", picked);
      form.append("editor", state.editorName);
      const report = await api(`/api/batches/${state.batchId}/sync-clinical`, { method: "POST", body: form });
      await absorbPatients(await api(`/api/batches/${state.batchId}/patients`));
      const details = [];
      if (report.skipped_not_in_batch) details.push(`Bỏ qua ${report.skipped_not_in_batch} mã KCB không có trong đoàn.`);
      for (const item of report.missing_in_file || []) details.push(`Không thấy kết quả: ${item.name} · ${item.ma_kcb}`);
      for (const item of report.without_code || []) details.push(`Chưa có mã KCB: ${item.name}`);
      showSyncReport("Kết quả đồng bộ khám lâm sàng", [`Đã cập nhật ${report.updated} người.`, `${report.unchanged} người không đổi.`], details);
      toast(`Đã cập nhật khám lâm sàng cho ${report.updated} người`);
    },
  );
}

function showSyncCls() {
  if (!batchHasKcb()) {
    toast("Hãy đồng bộ mã KCB trước khi đồng bộ cận lâm sàng.", "warn");
    return;
  }
  const file = h("input", { type: "file", accept: ".xlsx" });
  openModal(
    "Đồng bộ khám cận lâm sàng",
    [
      h("p", {}, ["Chọn file kết quả có cột makcb và ketluan. Các xét nghiệm trên một dòng, cách nhau bằng dấu chấm phẩy, sẽ được điền vào phiếu cận lâm sàng. Mã KCB không có trong đoàn sẽ được bỏ qua."]),
      file,
    ],
    async () => {
      const picked = file.files[0];
      if (!picked) throw new Error("Hãy chọn file Excel");
      const form = new FormData();
      form.append("file", picked);
      form.append("editor", state.editorName);
      const report = await api(`/api/batches/${state.batchId}/sync-cls`, { method: "POST", body: form });
      await absorbPatients(await api(`/api/batches/${state.batchId}/patients`));
      const details = [];
      if (report.skipped_not_in_batch) details.push(`Bỏ qua ${report.skipped_not_in_batch} mã KCB không có trong đoàn.`);
      for (const item of report.missing_in_file || []) details.push(`Không thấy kết quả: ${item.name} · ${item.ma_kcb}`);
      for (const item of report.without_code || []) details.push(`Chưa có mã KCB: ${item.name}`);
      showSyncReport("Kết quả đồng bộ cận lâm sàng", [`Đã cập nhật ${report.updated} người.`, `${report.unchanged} người không đổi.`], details);
      toast(`Đã cập nhật cận lâm sàng cho ${report.updated} người`);
    },
  );
}

async function absorbPatients(patients) {
  state.patients = patients;
  paintTable();
  const next = patients.find((patient) => patient.id === state.activeId);
  if (!next) return;
  for (const field of state.fields) {
    if (state.dirty.has(field.col)) continue;
    if (document.activeElement?.id === `f-${field.col}`) continue;
    const value = next.data[field.col] || "";
    state.snapshot[field.col] = value;
    setControl(field.col, value);
  }
  state.snapshot.MA_KCB = next.data.MA_KCB || "";
  state.snapshot.REVIEW_COLS = next.data.REVIEW_COLS || "";
  paintIdentity();
  refreshChips();
  markClinicalReview();
  applyGyneLock();
}

const CLINICAL_PAIRS = [
  ["X", "Y"], ["Z", "AA"], ["AB", "AC"], ["AD", "AE"], ["AF", "AG"], ["AH", "AI"],
  ["AJ", "AK"], ["AL", "AM"], ["AO", "AP"], ["AV", "AW"], ["BC", "BD"], ["BH", "BI"],
  ["BK", "BL"], ["BN", "BO"],
];

const GYNE_COLS = ["BN", "BO", "BP"];

function patientIsMale() {
  return (document.getElementById("f-D")?.value || state.snapshot.D || "") === "1";
}

function applyGyneLock() {
  const male = patientIsMale();
  const group = [...document.querySelectorAll(".drawer .group")].find(
    (item) => item.querySelector(".group-title")?.textContent.trim() === "Khám sản phụ khoa",
  );
  if (group) group.classList.toggle("locked", male);
  for (const col of GYNE_COLS) {
    const el = document.getElementById(`f-${col}`);
    if (!el) continue;
    el.disabled = male;
    if (!male) continue;
    el.closest(".field")?.classList.remove("needs-review");
    if (el.value) {
      silent = true;
      el.value = "";
      silent = false;
    }
  }
}

function clearGyneIfMale() {
  if (!patientIsMale()) return;
  for (const col of GYNE_COLS) {
    const el = document.getElementById(`f-${col}`);
    if (!el) continue;
    silent = true;
    el.value = "";
    silent = false;
    if ((state.snapshot[col] || "") !== "") state.dirty.add(col);
  }
}

function markClinicalReview() {
  const flagged = new Set((state.snapshot.REVIEW_COLS || "").split(",").filter(Boolean));
  for (const [textCol, gradeCol] of CLINICAL_PAIRS) {
    const pending = !readField(gradeCol).trim() && (flagged.has(textCol) || flagged.has(gradeCol));
    for (const col of [textCol, gradeCol]) {
      const field = document.getElementById(`f-${col}`)?.closest(".field");
      if (!field) continue;
      const show = pending && flagged.has(col);
      field.classList.toggle("needs-review", show);
      field.title = show ? "Chỉ số chưa bình thường. Hãy nhập phân loại." : "";
    }
  }
}

function showSyncKcb() {
  const file = h("input", { type: "file", accept: ".xlsx" });
  openModal(
    "Đồng bộ mã KCB",
    [
      h("p", {}, ["Chọn file danh sách bệnh nhân có cột Tên BN, Ngày sinh và Mã KCB. Mã được gắn vào từng người trong đoàn này, khớp theo họ tên và ngày sinh. Mã cơ sở KCB trên sổ không đổi."]),
      file,
    ],
    async () => {
      const picked = file.files[0];
      if (!picked) throw new Error("Hãy chọn file Excel");
      const form = new FormData();
      form.append("file", picked);
      form.append("editor", state.editorName);
      const report = await api(`/api/batches/${state.batchId}/sync-kcb`, { method: "POST", body: form });
      await absorbPatients(await api(`/api/batches/${state.batchId}/patients`));
      const details = [];
      for (const item of report.name_only || []) {
        details.push(`${item.name}: khớp theo tên, ngày sinh trên sổ ${item.patient_dob || "trống"}, trong file ${item.file_dob || "trống"} · ${item.ma_kcb}`);
      }
      for (const item of report.unmatched_patients || []) {
        details.push(`Chưa có trong file: ${item.name}${item.dob ? ` (${item.dob})` : ""}`);
      }
      for (const item of report.unmatched_file || []) {
        details.push(`File có nhưng không thấy trong đoàn: ${item.name}${item.dob ? ` (${item.dob})` : ""} · ${item.ma_kcb}`);
      }
      for (const item of report.ambiguous || []) {
        details.push(`Chưa gắn vì không chắc: ${item.name}${item.dob ? ` (${item.dob})` : ""} — ${item.reason}`);
      }
      showSyncReport("Kết quả đồng bộ mã KCB", [`Đã cập nhật ${report.updated} người.`, `${report.unchanged} người đã có đúng mã này.`], details);
      toast(`Đã gắn mã KCB cho ${report.matched} người`);
    },
  );
}

function showSyncReport(title, lines, details) {
  let box = document.getElementById("sync-report");
  if (!box) {
    box = h("div", { id: "sync-report", class: "sync-report" });
    document.querySelector(".list-tools")?.after(box);
  }
  box.replaceChildren(
    h("h3", {}, [title]),
    h("p", {}, [lines.join(" ")]),
    details.length ? h("ul", {}, details.map((line) => h("li", {}, [line]))) : "",
  );
}

function showCreate() {
  const name = h("input", { id: "new-name", placeholder: "Ví dụ: Công ty Hậu Giang" });
  const note = h("textarea", { id: "new-note", rows: "3", placeholder: "Đơn vị, ngày khám…" });
  openModal("Tạo đoàn khám", [h("label", {}, ["Tên đoàn"]), name, h("label", {}, ["Ghi chú"]), note], async () => {
    const batch = await api("/api/batches", { method: "POST", body: { name: name.value, note: note.value } });
    await reloadBatches();
    await openBatch(batch.id);
    toast("Đã tạo đoàn");
  });
}

function showImport(preset) {
  const file = h("input", { type: "file", accept: ".xlsx" });
  const name = h("input", { placeholder: "Tên đoàn" });
  const note = h("textarea", { rows: "2", placeholder: "Ghi chú" });
  if (preset) {
    const transfer = new DataTransfer();
    transfer.items.add(preset);
    file.files = transfer.files;
    name.value = preset.name.replace(/\.xlsx$/i, "");
  }
  file.addEventListener("change", () => {
    const picked = file.files[0];
    if (picked && !name.value) name.value = picked.name.replace(/\.xlsx$/i, "");
  });
  openModal("Nhập file Excel", [
    h("p", {}, ["File đúng mẫu sổ khám sẽ thành một đoàn riêng. Dữ liệu bệnh nhân bắt đầu từ dòng 6."]),
    h("label", {}, ["File .xlsx"]),
    file,
    h("label", {}, ["Tên đoàn"]),
    name,
    h("label", {}, ["Ghi chú"]),
    note,
  ], async () => {
    const picked = file.files[0];
    if (!picked) throw new Error("Hãy chọn file Excel");
    const form = new FormData();
    form.append("file", picked);
    form.append("name", name.value);
    form.append("note", note.value);
    form.append("editor", state.editorName);
    const batch = await api("/api/batches/import", { method: "POST", body: form });
    await reloadBatches();
    await openBatch(batch.id);
    toast(`Đã nhập ${batch.patient_count} người vào đoàn ${batch.name}`);
  });
}

function openModal(title, nodes, onSubmit) {
  const error = h("p", { class: "cccd-warn" });
  const backdrop = h("div", { class: "modal-back" }, [
    h("form", { class: "modal" }, [
      h("h2", {}, [title]),
      ...nodes,
      error,
      h("div", { class: "modal-actions" }, [
        h("button", { class: "btn btn-line", type: "button", onClick: () => backdrop.remove() }, ["Hủy"]),
        h("button", { class: "btn", type: "submit" }, ["Xong"]),
      ]),
    ]),
  ]);
  backdrop.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      await onSubmit();
      backdrop.remove();
    } catch (err) {
      error.textContent = err.message;
    }
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
  backdrop.querySelector("input")?.focus();
}

async function poll() {
  try {
    const batches = await api("/api/batches");
    const signature = JSON.stringify(batches.map((batch) => [batch.id, batch.name, batch.patient_count, batch.concluded_count, batch.updated_at, batch.note]));
    if (signature !== state.batchSignature) {
      state.batchSignature = signature;
      state.batches = batches;
      paintFolders();
      if (!state.batchId) renderStage();
      else paintBatchHeader();
    }
    if (!state.batchId || state.saving) return;
    const patients = await api(`/api/batches/${state.batchId}/patients`);
    const same = JSON.stringify(patients.map((patient) => [patient.id, patient.updated_at])) === JSON.stringify(state.patients.map((patient) => [patient.id, patient.updated_at]));
    if (same) return;
    if (state.dirty.size && state.activeId) {
      const local = state.patients.find((patient) => patient.id === state.activeId);
      state.patients = patients.map((patient) => (patient.id === state.activeId && local ? local : patient));
      paintTable();
      return;
    }
    const previous = state.patients.find((patient) => patient.id === state.activeId);
    state.patients = patients;
    paintTable();
    const next = patients.find((patient) => patient.id === state.activeId);
    if (next && previous && next.updated_at !== previous.updated_at) {
      for (const field of state.fields) {
        if (state.dirty.has(field.col)) continue;
        if (document.activeElement?.id === `f-${field.col}`) continue;
        const value = next.data[field.col] || "";
        if ((state.snapshot[field.col] || "") !== value) {
          state.snapshot[field.col] = value;
          setControl(field.col, value);
        }
      }
      const patient = state.patients.find((item) => item.id === state.activeId);
      if (patient) patient.data = { ...next.data, ...Object.fromEntries([...state.dirty].map((col) => [col, readField(col)])) };
      paintIdentity();
      refreshChips();
      setStatus(`Vừa có bản mới${next.updated_by ? " từ " + next.updated_by : ""}`);
    }
  } catch {
    /* máy chủ tạm bận, lần sau sẽ thử lại */
  }
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    savePatient(true);
  }
  if (event.key === "Escape" && state.activeId) closeDrawer();
  if (event.key === "/" && state.batchId && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
    event.preventDefault();
    (document.getElementById("drawer-search") || document.getElementById("list-search"))?.focus();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty.size || !state.activeId) return;
  const fields = {};
  const base = {};
  for (const col of state.dirty) {
    fields[col] = readField(col);
    base[col] = state.snapshot[col] ?? "";
  }
  fetch(`/api/patients/${state.activeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, base, editor: state.editorName }),
    keepalive: true,
  });
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer?.items || []].some((item) => item.kind === "file")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    toast("Chỉ nhận file .xlsx", "bad");
    return;
  }
  showImport(file);
});

async function boot() {
  state.schema = await api("/api/schema");
  state.fields = state.schema.sections.flatMap((section) => section.groups.flatMap((group) => group.fields));
  state.info = await api("/api/info");
  state.batches = await api("/api/batches");
  state.batchSignature = JSON.stringify(state.batches.map((batch) => [batch.id, batch.updated_at]));
  mount();
  setInterval(poll, 4000);
}

boot().catch((error) => {
  document.getElementById("app").textContent = error.message || "Không mở được ứng dụng";
});
