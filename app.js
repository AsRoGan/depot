(function () {
  "use strict";

  var LS_ITEMS_KEY = "depot.items.v1";
  var LS_HISTORY_KEY = "depot.history.v1";
  var LS_CATEGORIES_KEY = "depot.categories.v1";
  var LS_SETTINGS_KEY = "depot.settings.v1";
  var APP_VERSION = "v14";
  var SWATCHES = ["#6B8F47", "#B23A48", "#3E6C8C", "#8A6E4B", "#B8912F", "#3E8C7E", "#7A4E7E", "#5B6770"];

  var state = {
    items: [],
    history: [],
    categories: [],
    settings: { soonDays: 30, urgentDays: 7, depletionThreshold: 0, deviceName: "", lastExportAt: null, lastImportAt: null },
    activeCategory: "all",
    activeSubCategory: "all",
    activeLocation: "all",
    search: "",
    soonOnly: false,
    depletedOnly: false,
    editingId: null,
    viewingId: null,
    withdrawItemId: null,
    batchEditContext: "form",
    batchEditItemId: null,
    formCategoryId: null,
    formSubCategoryId: null,
    formBatches: [],
    formBarcodes: [],
    editingBatchId: null,
    newCategoryColor: SWATCHES[0],
    expandedCategoryIds: {},
    historySearch: "",
    historyCategory: "all",
    pendingImport: null,
    auditLocation: null,
    auditChecked: {},
    scanContext: "global",
    scanMode: "single",
    scanPaused: false,
    scanSessionLog: [],
    scanLastLocation: "",
    scanLastHandledCode: null,
    scanLastHandledAt: 0,
    scanMultiCode: null,
    scanMultiMatchedItemId: null
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function roundQty(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function formatQty(n) { return String(parseFloat(roundQty(n).toFixed(2))); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function defaultCategories() {
    return [
      { id: "food", name: "Food", color: "#6B8F47", subcategories: [] },
      { id: "medical", name: "Medical", color: "#B23A48", subcategories: [] },
      { id: "devices", name: "Devices", color: "#3E6C8C", subcategories: [] },
      { id: "other", name: "Other", color: "#8A6E4B", subcategories: [] }
    ];
  }

  // ---------- IndexedDB layer ----------

  var DB_NAME = "depot-db";
  var DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        ["items", "history", "categories"].forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return dbPromise;
  }

  function idbGetAll(store) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbClearAndPutAll(store, records) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readwrite");
        var os = tx.objectStore(store);
        os.clear();
        (records || []).forEach(function (r) { os.put(r); });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGetKV(key, fallback) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction("kv", "readonly").objectStore("kv").get(key);
        req.onsuccess = function () { resolve(req.result ? req.result.value : fallback); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSetKV(key, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ key: key, value: value });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function saveItems() { idbClearAndPutAll("items", state.items).catch(function (e) { console.error("Save items failed", e); }); }
  function saveHistory() { idbClearAndPutAll("history", state.history).catch(function (e) { console.error("Save history failed", e); }); }
  function saveCategories() { idbClearAndPutAll("categories", state.categories).catch(function (e) { console.error("Save categories failed", e); }); }
  function saveSettings() { idbSetKV("settings", state.settings).catch(function (e) { console.error("Save settings failed", e); }); }

  function migrateFromLocalStorage() {
    return idbGetAll("items").then(function (existing) {
      if (existing.length > 0) return;
      var oldRaw = localStorage.getItem(LS_ITEMS_KEY);
      if (!oldRaw) return;
      var oldItems, oldHistory, oldCategories, oldSettings;
      try {
        oldItems = JSON.parse(oldRaw) || [];
        oldHistory = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]");
        oldCategories = JSON.parse(localStorage.getItem(LS_CATEGORIES_KEY) || "null");
        oldSettings = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || "null");
      } catch (e) {
        console.error("Could not parse existing localStorage data during migration", e);
        return;
      }
      var jobs = [idbClearAndPutAll("items", oldItems), idbClearAndPutAll("history", oldHistory)];
      if (oldCategories) jobs.push(idbClearAndPutAll("categories", oldCategories));
      if (oldSettings) jobs.push(idbSetKV("settings", oldSettings));
      return Promise.all(jobs);
    });
  }

  // ---------- schema migration (field-level) ----------

  function migrateItems(items) {
    var changed = false;
    items.forEach(function (it) {
      if (it.categoryId === undefined) { it.categoryId = it.category || null; changed = true; }
      if (it.category !== undefined) { delete it.category; changed = true; }
      if (it.subcategoryId === undefined) { it.subcategoryId = null; changed = true; }

      if (it.batches === undefined) {
        it.batches = [{
          id: uid(),
          quantity: Number(it.quantity) || 0,
          expiry: it.expiry || null,
          expiryType: it.expiry ? (it.expiryType || "use_by") : null,
          location: it.location || null,
          openDate: null
        }];
        delete it.quantity; delete it.expiry; delete it.expiryType;
        changed = true;
      }

      if (it.location !== undefined) {
        it.batches.forEach(function (b) {
          if (b.location === undefined || b.location === null) b.location = it.location || null;
        });
        delete it.location;
        changed = true;
      }

      it.batches.forEach(function (b) {
        if (b.location === undefined) { b.location = null; changed = true; }
        if (b.openDate === undefined) { b.openDate = null; changed = true; }
      });

      if (it.reorderThreshold === undefined) { it.reorderThreshold = null; changed = true; }
      if (it.openShelfLifeDays === undefined) { it.openShelfLifeDays = null; changed = true; }
      if (it.barcodes === undefined) {
        it.barcodes = it.barcode ? [it.barcode] : [];
        delete it.barcode;
        changed = true;
      }
    });
    return changed;
  }

  function migrateHistory(history) {
    var changed = false;
    history.forEach(function (h) {
      if (h.categoryId === undefined && h.category !== undefined) {
        h.categoryId = h.category; delete h.category; changed = true;
      }
    });
    return changed;
  }

  // ---------- category helpers ----------

  function getCategory(id) { return state.categories.find(function (c) { return c.id === id; }) || null; }
  function getSubcategory(catId, subId) {
    var cat = getCategory(catId);
    if (!cat) return null;
    return cat.subcategories.find(function (s) { return s.id === subId; }) || null;
  }
  function colorFor(categoryId) {
    var cat = getCategory(categoryId);
    return cat ? cat.color : "var(--uncategorized)";
  }
  function categoryName(categoryId) {
    var cat = getCategory(categoryId);
    return cat ? cat.name : "Uncategorized";
  }

  // ---------- batch / expiry helpers ----------

  function itemTotalQty(item) {
    return roundQty(item.batches.reduce(function (sum, b) { return sum + (Number(b.quantity) || 0); }, 0));
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var target = new Date(dateStr + "T00:00:00");
    return Math.round((target - today) / 86400000);
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function formatDateShort(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    var day = String(d.getDate()).padStart(2, "0");
    var month = String(d.getMonth() + 1).padStart(2, "0");
    var year = String(d.getFullYear()).slice(-2);
    return day + "-" + month + "-" + year;
  }

  function relativeTime(iso) {
    if (!iso) return "never";
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    return days + "d ago";
  }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + Number(days));
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // Resolves the date that actually governs a batch: the printed expiry, or the
  // "opened N days ago + shelf life" countdown, whichever comes first.
  function getBatchEffectiveDate(item, batch) {
    var candidates = [];
    if (batch.expiry) candidates.push({ date: batch.expiry, type: batch.expiryType || "use_by", source: "printed" });
    if (batch.openDate && item.openShelfLifeDays) {
      candidates.push({ date: addDays(batch.openDate, item.openShelfLifeDays), type: "use_by", source: "opened" });
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return daysUntil(a.date) - daysUntil(b.date); });
    return candidates[0];
  }

  function expiryStatus(dateStr, type, compact) {
    var d = daysUntil(dateStr);
    if (d === null) return { label: "No expiry", cls: "" };

    var soonDays = state.settings.soonDays;
    var urgentDays = state.settings.urgentDays;

    var label;
    if (d < 0) label = "Expired " + Math.abs(d) + "d ago";
    else if (d === 0) label = "Expires today";
    else if (d <= soonDays) label = "In " + d + "d";
    else label = compact ? formatDateShort(dateStr) : formatDate(dateStr);

    var isBestBefore = type === "best_before";
    if (isBestBefore && !compact) label += " · Best before";

    var cls;
    if (isBestBefore) {
      cls = d <= soonDays ? "expiry-soon" : "expiry-fine";
    } else {
      if (d <= urgentDays) cls = "expiry-urgent";
      else if (d <= soonDays) cls = "expiry-soon";
      else cls = "expiry-fine";
    }
    return { label: label, cls: cls };
  }

  var STATUS_RANK = { "expiry-urgent": 3, "expiry-soon": 2, "expiry-fine": 1, "": 0 };

  function worstBatchStatus(item) {
    var worst = null;
    item.batches.forEach(function (b) {
      var eff = getBatchEffectiveDate(item, b);
      if (!eff) return;
      var s = expiryStatus(eff.date, eff.type);
      if (!worst || STATUS_RANK[s.cls] > STATUS_RANK[worst.status.cls]) worst = { batch: b, eff: eff, status: s };
    });
    return worst;
  }

  function sortBatchesByEffectiveDate(item, batches) {
    return batches.slice().sort(function (a, b) {
      var ea = getBatchEffectiveDate(item, a), eb = getBatchEffectiveDate(item, b);
      var da = ea ? daysUntil(ea.date) : null, db = eb ? daysUntil(eb.date) : null;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  }

  function isSoon(item) {
    return item.batches.some(function (b) {
      var eff = getBatchEffectiveDate(item, b);
      return eff && daysUntil(eff.date) <= state.settings.soonDays;
    });
  }

  function isDepleted(item) {
    return itemTotalQty(item) <= state.settings.depletionThreshold;
  }

  function batchLocations(item) {
    var seen = {};
    var out = [];
    item.batches.forEach(function (b) {
      if (b.location && !seen[b.location]) { seen[b.location] = true; out.push(b.location); }
    });
    return out;
  }

  function allKnownLocations() {
    var seen = {};
    var out = [];
    state.items.forEach(function (it) {
      it.batches.forEach(function (b) {
        if (b.location && !seen[b.location]) { seen[b.location] = true; out.push(b.location); }
      });
    });
    return out.sort();
  }

  // ---------- main list rendering ----------

  var listEl = document.getElementById("itemList");
  var emptyEl = document.getElementById("emptyState");
  var emptyTextEl = document.getElementById("emptyStateText");

  function visibleItems() {
    return state.items
      .filter(function (it) {
        var effCat = getCategory(it.categoryId) ? it.categoryId : null;
        if (state.activeCategory !== "all") {
          if (state.activeCategory === "uncategorized") {
            if (effCat !== null) return false;
          } else {
            if (effCat !== state.activeCategory) return false;
            if (state.activeSubCategory !== "all" && it.subcategoryId !== state.activeSubCategory) return false;
          }
        }
        if (state.soonOnly && !isSoon(it)) return false;
        if (state.depletedOnly && !isDepleted(it)) return false;
        if (state.activeLocation !== "all" && batchLocations(it).indexOf(state.activeLocation) === -1) return false;
        if (state.search) {
          var q = state.search.toLowerCase();
          var hay = (it.name + " " + batchLocations(it).join(" ") + " " + (it.notes || "") + " " + (it.barcode || "")).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      })
      .sort(function (a, b) {
        var wa = worstBatchStatus(a), wb = worstBatchStatus(b);
        var da = wa ? daysUntil(wa.eff.date) : null;
        var db = wb ? daysUntil(wb.eff.date) : null;
        if (da === null && db === null) return a.name.localeCompare(b.name);
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
  }

  function renderCategoryFilters() {
    var container = document.getElementById("categoryChips");
    var hasUncategorized = state.items.some(function (it) { return !getCategory(it.categoryId); });

    var html = '<button class="chip' + (state.activeCategory === "all" ? " is-active" : "") + '" data-category="all">All</button>';
    state.categories.forEach(function (cat) {
      html += '<button class="chip' + (state.activeCategory === cat.id ? " is-active" : "") + '" data-category="' + cat.id + '">' +
        '<span class="dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</button>';
    });
    if (hasUncategorized) {
      html += '<button class="chip' + (state.activeCategory === "uncategorized" ? " is-active" : "") + '" data-category="uncategorized">' +
        '<span class="dot"></span>Uncategorized</button>';
    }
    container.innerHTML = html;
  }

  function renderSubCategoryFilters() {
    var container = document.getElementById("subCategoryChips");
    var cat = getCategory(state.activeCategory);
    if (!cat || cat.subcategories.length === 0) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    var html = '<button class="chip' + (state.activeSubCategory === "all" ? " is-active" : "") + '" data-sub="all">All</button>';
    cat.subcategories.forEach(function (sub) {
      html += '<button class="chip' + (state.activeSubCategory === sub.id ? " is-active" : "") + '" data-sub="' + sub.id + '">' + escapeHtml(sub.name) + '</button>';
    });
    container.innerHTML = html;
  }

  function renderLocationFilters() {
    var container = document.getElementById("locationChips");
    var locs = allKnownLocations();
    if (!locs.length) { container.hidden = true; container.innerHTML = ""; return; }
    container.hidden = false;
    var html = '<button class="chip' + (state.activeLocation === "all" ? " is-active" : "") + '" data-location="all">All locations</button>';
    locs.forEach(function (loc) {
      html += '<button class="chip' + (state.activeLocation === loc ? " is-active" : "") + '" data-location="' + escapeHtml(loc) + '">' + escapeHtml(loc) + '</button>';
    });
    container.innerHTML = html;
  }

  function render() {
    renderCategoryFilters();
    renderSubCategoryFilters();
    renderLocationFilters();

    var items = visibleItems();
    listEl.innerHTML = "";

    if (items.length === 0) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      emptyTextEl.textContent = state.items.length === 0 ? "Nothing stored yet." : "Nothing matches this filter.";
      document.getElementById("emptyAddBtn").hidden = state.items.length !== 0;
      return;
    }
    emptyEl.hidden = true;
    listEl.hidden = false;

    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "item-row";
      li.dataset.id = item.id;

      var total = itemTotalQty(item);
      var worst = worstBatchStatus(item);

      var subName = getSubcategory(item.categoryId, item.subcategoryId);
      var subParts = [];
      if (subName) subParts.push(subName.name);
      var locs = batchLocations(item);
      if (locs.length) subParts.push(locs.join(", "));

      var qtyText, expiryLabel, expiryCls;
      if (total === 0) {
        qtyText = ""; expiryLabel = "Depleted"; expiryCls = "expiry-urgent";
      } else if (worst) {
        var compact = expiryStatus(worst.eff.date, worst.eff.type, true);
        qtyText = "";
        expiryLabel = compact.label + " (" + formatQty(worst.batch.quantity) + (item.unit ? " " + item.unit : "") + ")";
        expiryCls = compact.cls;
      } else {
        qtyText = formatQty(total) + (item.unit ? " " + item.unit : "");
        expiryLabel = ""; expiryCls = "";
      }

      li.innerHTML =
        '<div class="item-row-top">' +
          '<span class="dot item-cat-dot" style="background:' + colorFor(item.categoryId) + '"></span>' +
          '<p class="item-name"></p>' +
          '<span class="item-category"></span>' +
        '</div>' +
        '<div class="item-row-bottom">' +
          '<p class="item-sub"></p>' +
          '<div class="item-meta"><span class="item-qty"></span><span class="item-expiry ' + expiryCls + '"></span></div>' +
        '</div>';

      li.querySelector(".item-name").textContent = item.name;
      li.querySelector(".item-category").textContent = categoryName(item.categoryId);
      li.querySelector(".item-sub").textContent = subParts.join(" · ");
      li.querySelector(".item-qty").textContent = qtyText;
      li.querySelector(".item-expiry").textContent = expiryLabel;

      li.addEventListener("click", function () { openView(item.id); });
      listEl.appendChild(li);
    });
  }

  document.getElementById("categoryChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.activeCategory = btn.dataset.category;
    state.activeSubCategory = "all";
    render();
  });

  document.getElementById("subCategoryChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.activeSubCategory = btn.dataset.sub;
    render();
  });

  document.getElementById("locationChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.activeLocation = btn.dataset.location;
    render();
  });

  document.getElementById("soonToggle").addEventListener("change", function (e) { state.soonOnly = e.target.checked; render(); });
  document.getElementById("depletedToggle").addEventListener("change", function (e) { state.depletedOnly = e.target.checked; render(); });
  document.getElementById("searchInput").addEventListener("input", function (e) { state.search = e.target.value.trim(); render(); });

  // ---------- item view sheet ----------

  var itemViewSheet = document.getElementById("itemViewSheet");
  var viewBatchList = document.getElementById("viewBatchList");

  function renderViewBatches(item) {
    if (item.batches.length === 0) {
      viewBatchList.innerHTML = '<li class="batch-empty">No batches — depleted, due for restock.</li>';
      return;
    }
    var sorted = sortBatchesByEffectiveDate(item, item.batches);
    viewBatchList.innerHTML = sorted.map(function (b) {
      var eff = getBatchEffectiveDate(item, b);
      var status = eff ? expiryStatus(eff.date, eff.type) : { label: "No expiry", cls: "" };
      if (eff && eff.source === "opened") status.label += " (from open date)";
      var qtyText = formatQty(b.quantity) + (item.unit ? " " + item.unit : "");
      var locText = b.location ? " · " + escapeHtml(b.location) : "";
      return '<li class="batch-row" data-id="' + b.id + '">' +
        '<span class="batch-qty">' + qtyText + '</span>' +
        '<span class="batch-expiry ' + status.cls + '">' + status.label + locText + '</span>' +
        '<button type="button" class="icon-btn" title="Edit this batch">✎</button>' +
      '</li>';
    }).join("");
  }

  viewBatchList.addEventListener("click", function (e) {
    var row = e.target.closest(".batch-row[data-id]");
    if (!row) return;
    openBatchSheet(row.dataset.id, "direct", state.viewingId);
  });

  document.getElementById("viewAddBatchBtn").addEventListener("click", function () {
    openBatchSheet(null, "direct", state.viewingId);
  });

  function renderViewBarcodes(item) {
    var container = document.getElementById("viewBarcodeList");
    if (!item.barcodes.length) {
      container.innerHTML = '<li class="batch-empty">No barcodes attached.</li>';
      return;
    }
    container.innerHTML = item.barcodes.map(function (code) {
      return '<li class="batch-row"><span class="batch-qty">' + escapeHtml(code) + '</span>' +
        '<button type="button" class="icon-btn view-barcode-remove" data-code="' + escapeHtml(code) + '" title="Remove">🗑</button></li>';
    }).join("");
  }

  document.getElementById("viewBarcodeList").addEventListener("click", function (e) {
    var btn = e.target.closest(".view-barcode-remove");
    if (!btn) return;
    var item = state.items.find(function (it) { return it.id === state.viewingId; });
    if (!item) return;
    if (!confirm("Remove this barcode from the item?")) return;
    item.barcodes = item.barcodes.filter(function (c) { return c !== btn.dataset.code; });
    item.updatedAt = new Date().toISOString();
    saveItems();
    renderViewBarcodes(item);
  });

  document.getElementById("viewAddBarcodeBtn").addEventListener("click", function () {
    var input = document.getElementById("viewNewBarcodeInput");
    var code = input.value.trim();
    if (!code) return;
    var item = state.items.find(function (it) { return it.id === state.viewingId; });
    if (!item) return;
    if (item.barcodes.indexOf(code) === -1) item.barcodes.push(code);
    item.updatedAt = new Date().toISOString();
    saveItems();
    input.value = "";
    renderViewBarcodes(item);
  });

  document.getElementById("viewNewBarcodeScanBtn").addEventListener("click", function () {
    openScanSheet("fill-view-barcode");
  });

  function openView(id) {
    var item = state.items.find(function (it) { return it.id === id; });
    if (!item) return;
    state.viewingId = id;

    document.getElementById("viewItemName").textContent = item.name;

    var metaParts = [categoryName(item.categoryId)];
    var sub = getSubcategory(item.categoryId, item.subcategoryId);
    if (sub) metaParts.push(sub.name);
    if (item.unit) metaParts.push(item.unit);
    if (item.reorderThreshold !== null) metaParts.push("Reorder at " + formatQty(item.reorderThreshold));
    if (item.openShelfLifeDays !== null) metaParts.push("Once opened: " + item.openShelfLifeDays + "d");
    if (item.barcodes && item.barcodes.length) metaParts.push(item.barcodes.length + " barcode(s)");
    document.getElementById("viewItemMeta").textContent = metaParts.join(" · ");

    renderViewBatches(item);
    renderViewBarcodes(item);

    var notesEl = document.getElementById("viewNotesLine");
    if (item.notes) { notesEl.hidden = false; notesEl.textContent = item.notes; }
    else notesEl.hidden = true;

    itemViewSheet.hidden = false;
  }

  document.getElementById("viewCloseBtn").addEventListener("click", function () { itemViewSheet.hidden = true; });
  itemViewSheet.addEventListener("click", function (e) { if (e.target === itemViewSheet) itemViewSheet.hidden = true; });

  document.getElementById("viewEditBtn").addEventListener("click", function () {
    itemViewSheet.hidden = true;
    openForm(state.viewingId);
  });

  document.getElementById("viewDeleteBtn").addEventListener("click", function () {
    if (!state.viewingId) return;
    if (!confirm("Delete this item? This can't be undone.")) return;
    state.items = state.items.filter(function (it) { return it.id !== state.viewingId; });
    saveItems();
    itemViewSheet.hidden = true;
    render();
  });

  document.getElementById("viewWithdrawBtn").addEventListener("click", function () {
    itemViewSheet.hidden = true;
    openWithdrawFor(state.viewingId);
  });

  // ---------- add/edit sheet ----------

  var itemSheet = document.getElementById("itemSheet");
  var itemForm = document.getElementById("itemForm");
  var sheetTitle = document.getElementById("sheetTitle");
  var deleteBtn = document.getElementById("deleteBtn");
  var withdrawBtn = document.getElementById("withdrawBtn");

  function renderFormCategoryChips() {
    var container = document.getElementById("formCategoryChips");
    var html = "";
    state.categories.forEach(function (cat) {
      html += '<button type="button" class="chip' + (state.formCategoryId === cat.id ? " is-active" : "") + '" data-category="' + cat.id + '">' +
        '<span class="dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</button>';
    });
    container.innerHTML = html;
  }

  function renderFormSubCategoryChips() {
    var label = document.getElementById("formSubCategoryLabel");
    var container = document.getElementById("formSubCategoryChips");
    var cat = getCategory(state.formCategoryId);
    if (!cat || cat.subcategories.length === 0) { label.hidden = true; container.innerHTML = ""; return; }
    label.hidden = false;
    var html = '<button type="button" class="chip' + (!state.formSubCategoryId ? " is-active" : "") + '" data-sub="">None</button>';
    cat.subcategories.forEach(function (sub) {
      html += '<button type="button" class="chip' + (state.formSubCategoryId === sub.id ? " is-active" : "") + '" data-sub="' + sub.id + '">' + escapeHtml(sub.name) + '</button>';
    });
    container.innerHTML = html;
  }

  document.getElementById("formCategoryChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip"); if (!btn) return;
    state.formCategoryId = btn.dataset.category;
    state.formSubCategoryId = null;
    renderFormCategoryChips(); renderFormSubCategoryChips();
  });
  document.getElementById("formSubCategoryChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip"); if (!btn) return;
    state.formSubCategoryId = btn.dataset.sub || null;
    renderFormSubCategoryChips();
  });

  // ---------- batches within the item form ----------

  function currentFormPseudoItem() {
    return { openShelfLifeDays: Number(document.getElementById("fieldOpenShelfLife").value) || null };
  }

  function renderFormBatches() {
    var container = document.getElementById("formBatchList");
    var unit = document.getElementById("fieldUnit").value.trim();
    var pseudoItem = currentFormPseudoItem();
    var total = roundQty(state.formBatches.reduce(function (sum, b) { return sum + (Number(b.quantity) || 0); }, 0));
    document.getElementById("formBatchesTotal").textContent = "Total: " + formatQty(total) + (unit ? " " + unit : "");

    if (state.formBatches.length === 0) {
      container.innerHTML = '<li class="batch-empty">No batches yet — add one below, or leave empty to track this as depleted and due for restock.</li>';
      return;
    }
    var sorted = sortBatchesByEffectiveDate(pseudoItem, state.formBatches);
    container.innerHTML = sorted.map(function (b) {
      var eff = getBatchEffectiveDate(pseudoItem, b);
      var status = eff ? expiryStatus(eff.date, eff.type) : { label: "No expiry", cls: "" };
      if (eff && eff.source === "opened") status.label += " (from open date)";
      var qtyText = formatQty(b.quantity) + (unit ? " " + unit : "");
      var locText = b.location ? " · " + escapeHtml(b.location) : "";
      return '<li class="batch-row" data-id="' + b.id + '">' +
        '<span class="batch-qty">' + qtyText + '</span>' +
        '<span class="batch-expiry ' + status.cls + '">' + status.label + locText + '</span>' +
        '<button type="button" class="icon-btn batch-edit" data-id="' + b.id + '" title="Edit">✎</button>' +
        '<button type="button" class="icon-btn batch-delete" data-id="' + b.id + '" title="Remove">🗑</button>' +
      '</li>';
    }).join("");
  }

  document.getElementById("fieldUnit").addEventListener("input", renderFormBatches);
  document.getElementById("fieldOpenShelfLife").addEventListener("input", renderFormBatches);

  function renderFormBarcodes() {
    var container = document.getElementById("formBarcodeList");
    if (!state.formBarcodes.length) {
      container.innerHTML = '<li class="batch-empty">No barcodes attached yet.</li>';
      return;
    }
    container.innerHTML = state.formBarcodes.map(function (code) {
      return '<li class="batch-row"><span class="batch-qty">' + escapeHtml(code) + '</span>' +
        '<button type="button" class="icon-btn form-barcode-remove" data-code="' + escapeHtml(code) + '" title="Remove">🗑</button></li>';
    }).join("");
  }

  document.getElementById("addBarcodeBtn").addEventListener("click", function () {
    var input = document.getElementById("newBarcodeInput");
    var code = input.value.trim();
    if (!code) return;
    if (state.formBarcodes.indexOf(code) === -1) state.formBarcodes.push(code);
    input.value = "";
    renderFormBarcodes();
  });

  document.getElementById("formBarcodeList").addEventListener("click", function (e) {
    var btn = e.target.closest(".form-barcode-remove");
    if (!btn) return;
    state.formBarcodes = state.formBarcodes.filter(function (c) { return c !== btn.dataset.code; });
    renderFormBarcodes();
  });

  document.getElementById("formBatchList").addEventListener("click", function (e) {
    var editBtn = e.target.closest(".batch-edit");
    if (editBtn) { openBatchSheet(editBtn.dataset.id, "form"); return; }
    var delBtn = e.target.closest(".batch-delete");
    if (delBtn) {
      if (!confirm("Remove this batch?")) return;
      state.formBatches = state.formBatches.filter(function (b) { return b.id !== delBtn.dataset.id; });
      renderFormBatches();
    }
  });

  var batchSheet = document.getElementById("batchSheet");
  var batchForm = document.getElementById("batchForm");
  var batchQtyInput = document.getElementById("batchQty");

  function renderLocationSuggestions() {
    var dl = document.getElementById("locationSuggestions");
    dl.innerHTML = allKnownLocations().map(function (loc) {
      return '<option value="' + escapeHtml(loc) + '"></option>';
    }).join("");
  }

  function openBatchSheet(batchId, context, itemId) {
    state.batchEditContext = context || "form";
    state.batchEditItemId = itemId || null;
    state.editingBatchId = batchId || null;

    var batch;
    if (state.batchEditContext === "direct") {
      var directItem = state.items.find(function (it) { return it.id === itemId; });
      batch = directItem && batchId ? directItem.batches.find(function (b) { return b.id === batchId; }) : null;
    } else {
      batch = batchId ? state.formBatches.find(function (b) { return b.id === batchId; }) : null;
    }

    document.getElementById("batchSheetTitle").textContent = batch ? "Edit batch" : "Add batch";
    batchQtyInput.value = batch ? formatQty(batch.quantity) : "1";
    document.getElementById("batchExpiry").value = batch ? (batch.expiry || "") : "";
    document.getElementById("batchOpenDate").value = batch ? (batch.openDate || "") : "";
    document.getElementById("batchLocation").value = batch ? (batch.location || "") : "";
    renderLocationSuggestions();

    var type = batch && batch.expiryType ? batch.expiryType : "use_by";
    document.querySelectorAll("#batchExpiryTypeSegmented .segment").forEach(function (s) {
      s.classList.toggle("is-active", s.dataset.type === type);
    });

    batchSheet.hidden = false;
    batchQtyInput.focus();
  }

  function closeBatchSheet() {
    batchSheet.hidden = true;
    batchForm.reset();
    state.editingBatchId = null;
    state.batchEditContext = "form";
    state.batchEditItemId = null;
  }

  document.getElementById("addBatchBtn").addEventListener("click", function () { openBatchSheet(null, "form"); });
  document.getElementById("batchCancelBtn").addEventListener("click", closeBatchSheet);
  batchSheet.addEventListener("click", function (e) { if (e.target === batchSheet) closeBatchSheet(); });

  document.getElementById("batchExpiryTypeSegmented").addEventListener("click", function (e) {
    var btn = e.target.closest(".segment"); if (!btn) return;
    document.querySelectorAll("#batchExpiryTypeSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s === btn); });
  });

  batchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var qty = roundQty(Number(batchQtyInput.value));
    if (!qty || qty <= 0) return;
    var expiry = document.getElementById("batchExpiry").value || null;
    var activeSeg = document.querySelector("#batchExpiryTypeSegmented .segment.is-active");
    var type = expiry ? (activeSeg ? activeSeg.dataset.type : "use_by") : null;
    var openDate = document.getElementById("batchOpenDate").value || null;
    var location = document.getElementById("batchLocation").value.trim() || null;

    if (state.batchEditContext === "direct") {
      var item = state.items.find(function (it) { return it.id === state.batchEditItemId; });
      var newBatch = null;
      if (item) {
        if (state.editingBatchId) {
          var db = item.batches.find(function (x) { return x.id === state.editingBatchId; });
          if (db) { db.quantity = qty; db.expiry = expiry; db.expiryType = type; db.openDate = openDate; db.location = location; }
        } else {
          newBatch = { id: uid(), quantity: qty, expiry: expiry, expiryType: type, openDate: openDate, location: location };
          item.batches.push(newBatch);
        }
        item.updatedAt = new Date().toISOString();
        saveItems();
        renderViewBatches(item);
        render();
        if (newBatch && !locationAuditSheet.hidden && state.auditLocation) {
          state.auditChecked[newBatch.id] = true;
          renderAuditChecklist();
        }
      }
    } else {
      if (state.editingBatchId) {
        var b = state.formBatches.find(function (x) { return x.id === state.editingBatchId; });
        if (b) { b.quantity = qty; b.expiry = expiry; b.expiryType = type; b.openDate = openDate; b.location = location; }
      } else {
        state.formBatches.push({ id: uid(), quantity: qty, expiry: expiry, expiryType: type, openDate: openDate, location: location });
      }
      renderFormBatches();
    }
    closeBatchSheet();
  });

  // ---------- item form open/close/submit ----------

  function openForm(id) {
    state.editingId = id || null;
    var item = id ? state.items.find(function (it) { return it.id === id; }) : null;

    sheetTitle.textContent = item ? "Edit item" : "Add item";
    deleteBtn.hidden = !item;
    withdrawBtn.hidden = !item;

    document.getElementById("fieldName").value = item ? item.name : "";
    document.getElementById("fieldUnit").value = item ? (item.unit || "") : "";
    document.getElementById("fieldReorderThreshold").value = item && item.reorderThreshold !== null ? formatQty(item.reorderThreshold) : "";
    document.getElementById("fieldOpenShelfLife").value = item && item.openShelfLifeDays !== null ? item.openShelfLifeDays : "";
    document.getElementById("fieldNotes").value = item ? (item.notes || "") : "";

    state.formBarcodes = item ? item.barcodes.slice() : [];
    renderFormBarcodes();

    var defaultCatId = state.categories.length ? state.categories[0].id : null;
    state.formCategoryId = item ? (getCategory(item.categoryId) ? item.categoryId : defaultCatId) : defaultCatId;
    state.formSubCategoryId = item ? item.subcategoryId : null;
    renderFormCategoryChips();
    renderFormSubCategoryChips();

    state.formBatches = item ? item.batches.map(function (b) { return Object.assign({}, b); }) : [];
    renderFormBatches();

    itemSheet.hidden = false;
    document.getElementById("fieldName").focus();
  }

  function closeForm() {
    itemSheet.hidden = true;
    itemForm.reset();
    state.editingId = null;
    state.formBatches = [];
  }

  document.getElementById("fab").addEventListener("click", function () { openForm(null); });
  document.getElementById("emptyAddBtn").addEventListener("click", function () { openForm(null); });
  document.getElementById("cancelBtn").addEventListener("click", closeForm);
  itemSheet.addEventListener("click", function (e) { if (e.target === itemSheet) closeForm(); });

  itemForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("fieldName").value.trim();
    if (!name) return;

    var reorderVal = document.getElementById("fieldReorderThreshold").value;
    var shelfLifeVal = document.getElementById("fieldOpenShelfLife").value;

    var data = {
      name: name,
      categoryId: state.formCategoryId,
      subcategoryId: state.formSubCategoryId || null,
      unit: document.getElementById("fieldUnit").value.trim(),
      reorderThreshold: reorderVal === "" ? null : roundQty(Number(reorderVal)),
      openShelfLifeDays: shelfLifeVal === "" ? null : Math.max(1, Number(shelfLifeVal) || 1),
      barcodes: state.formBarcodes.slice(),
      batches: state.formBatches.map(function (b) { return Object.assign({}, b); }),
      notes: document.getElementById("fieldNotes").value.trim(),
      updatedAt: new Date().toISOString()
    };

    if (state.editingId) {
      var idx = state.items.findIndex(function (it) { return it.id === state.editingId; });
      if (idx !== -1) state.items[idx] = Object.assign({}, state.items[idx], data);
    } else {
      data.id = uid();
      state.items.push(data);
    }

    saveItems();
    closeForm();
    render();
  });

  deleteBtn.addEventListener("click", function () {
    if (!state.editingId) return;
    if (!confirm("Delete this item? This can't be undone.")) return;
    state.items = state.items.filter(function (it) { return it.id !== state.editingId; });
    saveItems();
    closeForm();
    render();
  });

  // ---------- withdraw sheet ----------

  var withdrawSheet = document.getElementById("withdrawSheet");
  var withdrawForm = document.getElementById("withdrawForm");
  var withdrawQtyInput = document.getElementById("withdrawQty");

  function openWithdrawFor(itemId) {
    var item = state.items.find(function (it) { return it.id === itemId; });
    if (!item) return;
    state.withdrawItemId = itemId;
    var total = itemTotalQty(item);
    document.getElementById("withdrawItemName").textContent = item.name;
    document.getElementById("withdrawStockLine").textContent =
      "Currently have " + formatQty(total) + (item.unit ? " " + item.unit : "") + " in stock across " +
      item.batches.length + " batch" + (item.batches.length === 1 ? "" : "es") + ".";
    withdrawQtyInput.max = total;
    withdrawQtyInput.value = Math.min(1, total) || 1;
    document.getElementById("withdrawReason").value = "";
    withdrawSheet.hidden = false;
  }

  withdrawBtn.addEventListener("click", function () { openWithdrawFor(state.editingId); });

  function closeWithdrawSheet() { withdrawSheet.hidden = true; withdrawForm.reset(); state.withdrawItemId = null; }
  document.getElementById("withdrawCancelBtn").addEventListener("click", closeWithdrawSheet);
  withdrawSheet.addEventListener("click", function (e) { if (e.target === withdrawSheet) closeWithdrawSheet(); });

  withdrawForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var item = state.items.find(function (it) { return it.id === state.withdrawItemId; });
    if (!item) return;

    var total = itemTotalQty(item);
    var amount = roundQty(Number(withdrawQtyInput.value));
    if (!amount || amount <= 0) return;
    if (amount > total) amount = total;

    var reason = document.getElementById("withdrawReason").value.trim();

    var sorted = sortBatchesByEffectiveDate(item, item.batches);
    var remaining = amount;
    sorted.forEach(function (b) {
      if (remaining <= 0) return;
      var take = Math.min(b.quantity, remaining);
      b.quantity = roundQty(b.quantity - take);
      remaining = roundQty(remaining - take);
    });
    item.batches = item.batches.filter(function (b) { return b.quantity > 0; });
    item.updatedAt = new Date().toISOString();

    state.history.unshift({
      id: uid(), itemId: item.id, name: item.name, categoryId: item.categoryId, unit: item.unit,
      amount: amount, reason: reason, remainingAfter: itemTotalQty(item), date: new Date().toISOString()
    });
    saveHistory();
    saveItems();

    closeWithdrawSheet();
    itemSheet.hidden = true;
    itemForm.reset();
    state.editingId = null;
    state.formBatches = [];
    itemViewSheet.hidden = true;
    render();
  });

  // ---------- history sheet ----------

  var historySheet = document.getElementById("historySheet");
  var historyList = document.getElementById("historyList");
  var historyEmpty = document.getElementById("historyEmpty");

  function visibleHistory() {
    return state.history.filter(function (h) {
      if (state.historyCategory !== "all") {
        var effCat = getCategory(h.categoryId) ? h.categoryId : null;
        if (state.historyCategory === "uncategorized") { if (effCat !== null) return false; }
        else if (effCat !== state.historyCategory) return false;
      }
      if (state.historySearch) {
        var q = state.historySearch.toLowerCase();
        var when = new Date(h.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
        var hay = (h.name + " " + (h.reason || "") + " " + categoryName(h.categoryId) + " " + when).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderHistoryFilters() {
    var container = document.getElementById("historyCategoryChips");
    var hasUncategorized = state.history.some(function (h) { return !getCategory(h.categoryId); });
    var html = '<button class="chip' + (state.historyCategory === "all" ? " is-active" : "") + '" data-category="all">All</button>';
    state.categories.forEach(function (cat) {
      html += '<button class="chip' + (state.historyCategory === cat.id ? " is-active" : "") + '" data-category="' + cat.id + '">' +
        '<span class="dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</button>';
    });
    if (hasUncategorized) {
      html += '<button class="chip' + (state.historyCategory === "uncategorized" ? " is-active" : "") + '" data-category="uncategorized"><span class="dot"></span>Uncategorized</button>';
    }
    container.innerHTML = html;
  }

  document.getElementById("historyCategoryChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip"); if (!btn) return;
    state.historyCategory = btn.dataset.category;
    renderHistory();
  });
  document.getElementById("historySearchInput").addEventListener("input", function (e) {
    state.historySearch = e.target.value.trim();
    renderHistory();
  });

  function renderHistory() {
    renderHistoryFilters();
    var entries = visibleHistory();
    historyList.innerHTML = "";

    if (entries.length === 0) {
      historyEmpty.hidden = false;
      historyList.hidden = true;
      historyEmpty.textContent = state.history.length === 0 ? "No withdrawals recorded yet." : "Nothing matches this search.";
      return;
    }
    historyEmpty.hidden = true;
    historyList.hidden = false;

    entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "item-row";
      var when = new Date(entry.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      li.innerHTML =
        '<div class="item-row-top">' +
          '<span class="dot item-cat-dot" style="background:' + colorFor(entry.categoryId) + '"></span>' +
          '<p class="item-name"></p>' +
          '<span class="item-category"></span>' +
        '</div>' +
        '<div class="item-row-bottom">' +
          '<p class="item-sub"></p>' +
          '<div class="item-meta"><span class="item-qty"></span>' +
            '<button type="button" class="icon-btn history-delete" data-id="' + entry.id + '" title="Delete this record">🗑</button>' +
          '</div>' +
        '</div>';
      li.querySelector(".item-name").textContent = entry.name;
      li.querySelector(".item-category").textContent = categoryName(entry.categoryId);
      li.querySelector(".item-sub").textContent = when + (entry.reason ? " · " + entry.reason : "");
      li.querySelector(".item-qty").textContent = "-" + formatQty(entry.amount) + (entry.unit ? " " + entry.unit : "");
      historyList.appendChild(li);
    });
  }

  historyList.addEventListener("click", function (e) {
    var btn = e.target.closest(".history-delete");
    if (!btn) return;
    if (!confirm("Delete this withdrawal record?")) return;
    state.history = state.history.filter(function (h) { return h.id !== btn.dataset.id; });
    saveHistory();
    renderHistory();
  });

  document.getElementById("historyBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    renderHistory();
    historySheet.hidden = false;
  });
  document.getElementById("historyCloseBtn").addEventListener("click", function () { historySheet.hidden = true; });
  historySheet.addEventListener("click", function (e) { if (e.target === historySheet) historySheet.hidden = true; });

  document.getElementById("historyClearShownBtn").addEventListener("click", function () {
    var shown = visibleHistory();
    if (!shown.length) return;
    if (!confirm("Clear the " + shown.length + " withdrawal record(s) currently shown? This can't be undone.")) return;
    var shownIds = {};
    shown.forEach(function (h) { shownIds[h.id] = true; });
    state.history = state.history.filter(function (h) { return !shownIds[h.id]; });
    saveHistory();
    renderHistory();
  });

  document.getElementById("historyClearAllBtn").addEventListener("click", function () {
    if (!state.history.length) return;
    if (!confirm("Clear all withdrawal history? This can't be undone.")) return;
    state.history = [];
    saveHistory();
    renderHistory();
  });

  // ---------- manage categories sheet ----------

  var categoriesSheet = document.getElementById("categoriesSheet");
  var categoryManageList = document.getElementById("categoryManageList");

  function renderSwatchRow() {
    var container = document.getElementById("swatchRow");
    container.innerHTML = SWATCHES.map(function (color) {
      return '<button type="button" class="swatch' + (state.newCategoryColor === color ? " is-active" : "") + '" style="background:' + color + '" data-color="' + color + '"></button>';
    }).join("");
  }
  document.getElementById("swatchRow").addEventListener("click", function (e) {
    var btn = e.target.closest(".swatch"); if (!btn) return;
    state.newCategoryColor = btn.dataset.color;
    renderSwatchRow();
  });

  function renderCategoryManageList() {
    var html = "";
    state.categories.forEach(function (cat) {
      var count = state.items.filter(function (it) { return it.categoryId === cat.id; }).length;
      var expanded = !!state.expandedCategoryIds[cat.id];
      html += '<li class="category-row" data-id="' + cat.id + '">' +
        '<div class="category-row-main">' +
          '<span class="dot" style="background:' + cat.color + '"></span>' +
          '<span class="category-name">' + escapeHtml(cat.name) + '</span>' +
          '<span class="category-count">' + count + ' item' + (count === 1 ? "" : "s") + '</span>' +
          '<button type="button" class="icon-btn cat-rename" data-id="' + cat.id + '" title="Rename">✎</button>' +
          '<button type="button" class="icon-btn cat-delete" data-id="' + cat.id + '" title="Delete">🗑</button>' +
          '<button type="button" class="icon-btn cat-expand" data-id="' + cat.id + '" title="Subcategories">' + (expanded ? "▾" : "▸") + '</button>' +
        '</div>' +
        '<ul class="subcategory-list" data-parent="' + cat.id + '"' + (expanded ? "" : " hidden") + '>' +
          cat.subcategories.map(function (sub) {
            return '<li class="subcategory-row" data-id="' + sub.id + '">' +
              '<span class="subcategory-name">' + escapeHtml(sub.name) + '</span>' +
              '<button type="button" class="icon-btn sub-rename" data-parent="' + cat.id + '" data-id="' + sub.id + '" title="Rename">✎</button>' +
              '<button type="button" class="icon-btn sub-delete" data-parent="' + cat.id + '" data-id="' + sub.id + '" title="Delete">🗑</button>' +
            '</li>';
          }).join("") +
          '<li class="add-sub-row-li"><div class="add-sub-row">' +
            '<input type="text" class="new-sub-input" data-parent="' + cat.id + '" placeholder="New subcategory" maxlength="30">' +
            '<button type="button" class="btn-secondary add-sub-btn" data-parent="' + cat.id + '">Add</button>' +
          '</div></li>' +
        '</ul>' +
      '</li>';
    });
    categoryManageList.innerHTML = html;
  }

  categoryManageList.addEventListener("click", function (e) {
    var expandBtn = e.target.closest(".cat-expand");
    if (expandBtn) { var id = expandBtn.dataset.id; state.expandedCategoryIds[id] = !state.expandedCategoryIds[id]; renderCategoryManageList(); return; }
    var renameBtn = e.target.closest(".cat-rename");
    if (renameBtn) {
      var cat = getCategory(renameBtn.dataset.id); if (!cat) return;
      var name = prompt("Rename category", cat.name);
      if (name && name.trim()) { cat.name = name.trim(); saveCategories(); renderCategoryManageList(); render(); }
      return;
    }
    var delBtn = e.target.closest(".cat-delete");
    if (delBtn) {
      var id2 = delBtn.dataset.id; var cat2 = getCategory(id2); if (!cat2) return;
      var count = state.items.filter(function (it) { return it.categoryId === id2; }).length;
      var msg = count > 0 ? ('Delete "' + cat2.name + '"? ' + count + " item(s) will become Uncategorized.") : ('Delete "' + cat2.name + '"?');
      if (!confirm(msg)) return;
      state.items.forEach(function (it) { if (it.categoryId === id2) { it.categoryId = null; it.subcategoryId = null; } });
      state.categories = state.categories.filter(function (c) { return c.id !== id2; });
      if (state.activeCategory === id2) { state.activeCategory = "all"; state.activeSubCategory = "all"; }
      saveItems(); saveCategories();
      renderCategoryManageList(); render();
      return;
    }
    var subRename = e.target.closest(".sub-rename");
    if (subRename) {
      var sub = getSubcategory(subRename.dataset.parent, subRename.dataset.id); if (!sub) return;
      var sname = prompt("Rename subcategory", sub.name);
      if (sname && sname.trim()) { sub.name = sname.trim(); saveCategories(); renderCategoryManageList(); render(); }
      return;
    }
    var subDelete = e.target.closest(".sub-delete");
    if (subDelete) {
      var pid = subDelete.dataset.parent, sid = subDelete.dataset.id;
      var pcat = getCategory(pid); if (!pcat) return;
      if (!confirm("Delete this subcategory? Items using it will keep their main category.")) return;
      pcat.subcategories = pcat.subcategories.filter(function (s) { return s.id !== sid; });
      state.items.forEach(function (it) { if (it.categoryId === pid && it.subcategoryId === sid) it.subcategoryId = null; });
      saveItems(); saveCategories();
      renderCategoryManageList(); render();
      return;
    }
    var addSubBtn = e.target.closest(".add-sub-btn");
    if (addSubBtn) {
      var pid3 = addSubBtn.dataset.parent;
      var input = categoryManageList.querySelector('.new-sub-input[data-parent="' + pid3 + '"]');
      var newName = input.value.trim(); if (!newName) return;
      var pcat3 = getCategory(pid3);
      pcat3.subcategories.push({ id: uid(), name: newName });
      input.value = "";
      saveCategories();
      state.expandedCategoryIds[pid3] = true;
      renderCategoryManageList(); render();
      return;
    }
  });

  categoryManageList.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.classList.contains("new-sub-input")) {
      e.preventDefault();
      var btn = categoryManageList.querySelector('.add-sub-btn[data-parent="' + e.target.dataset.parent + '"]');
      if (btn) btn.click();
    }
  });

  document.getElementById("addCategoryBtn").addEventListener("click", function () {
    var input = document.getElementById("newCategoryName");
    var name = input.value.trim(); if (!name) return;
    state.categories.push({ id: uid(), name: name, color: state.newCategoryColor || SWATCHES[0], subcategories: [] });
    input.value = "";
    saveCategories();
    renderCategoryManageList();
    render();
  });

  document.getElementById("manageCategoriesBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    state.newCategoryColor = SWATCHES[0];
    renderSwatchRow();
    renderCategoryManageList();
    categoriesSheet.hidden = false;
  });
  document.getElementById("categoriesCloseBtn").addEventListener("click", function () { categoriesSheet.hidden = true; });
  categoriesSheet.addEventListener("click", function (e) { if (e.target === categoriesSheet) categoriesSheet.hidden = true; });

  // ---------- thresholds sheet ----------

  var thresholdsSheet = document.getElementById("thresholdsSheet");
  var thresholdsForm = document.getElementById("thresholdsForm");

  document.getElementById("adjustThresholdsBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    document.getElementById("settingSoonDays").value = state.settings.soonDays;
    document.getElementById("settingUrgentDays").value = state.settings.urgentDays;
    document.getElementById("settingDepletionThreshold").value = state.settings.depletionThreshold;
    thresholdsSheet.hidden = false;
  });
  document.getElementById("thresholdsCancelBtn").addEventListener("click", function () { thresholdsSheet.hidden = true; });
  thresholdsSheet.addEventListener("click", function (e) { if (e.target === thresholdsSheet) thresholdsSheet.hidden = true; });

  thresholdsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var soonDays = Math.max(1, Number(document.getElementById("settingSoonDays").value) || 30);
    var urgentDays = Math.max(0, Number(document.getElementById("settingUrgentDays").value) || 0);
    var depletionThreshold = roundQty(Math.max(0, Number(document.getElementById("settingDepletionThreshold").value) || 0));
    if (urgentDays > soonDays) urgentDays = soonDays;
    state.settings = { soonDays: soonDays, urgentDays: urgentDays, depletionThreshold: depletionThreshold };
    saveSettings();
    thresholdsSheet.hidden = true;
    render();
  });

  // ---------- stats sheet ----------

  var statsSheet = document.getElementById("statsSheet");
  var statsList = document.getElementById("statsList");

  function renderStats() {
    var totalQuantity = state.items.reduce(function (sum, it) { return sum + itemTotalQty(it); }, 0);
    var expiringSoon = state.items.filter(isSoon).length;
    var expired = state.items.filter(function (it) {
      return it.batches.some(function (b) {
        var eff = getBatchEffectiveDate(it, b);
        return eff && daysUntil(eff.date) < 0;
      });
    }).length;
    var depleted = state.items.filter(isDepleted).length;
    var totalWithdrawn = state.history.reduce(function (sum, h) { return sum + (Number(h.amount) || 0); }, 0);
    var subCount = state.categories.reduce(function (sum, c) { return sum + c.subcategories.length; }, 0);

    var bytes = JSON.stringify(state.items).length + JSON.stringify(state.history).length + JSON.stringify(state.categories).length;
    var kb = (bytes / 1024).toFixed(1);

    var rows = [
      ["Items tracked", state.items.length],
      ["Total units in stock", formatQty(totalQuantity)],
      ["Categories", state.categories.length + (subCount ? " (" + subCount + " subcategories)" : "")],
      ["Expiring within " + state.settings.soonDays + " days", expiringSoon],
      ["Already past date", expired],
      ["Depleted (≤ " + formatQty(state.settings.depletionThreshold) + ")", depleted],
      ["Withdrawals logged", state.history.length],
      ["Units withdrawn all-time", formatQty(totalWithdrawn)],
      ["Storage used (approx.)", kb + " KB"]
    ];

    var html = rows.map(function (r) {
      return '<li class="stat-row"><span class="stat-label">' + escapeHtml(r[0]) + '</span><span class="stat-value">' + escapeHtml(String(r[1])) + '</span></li>';
    }).join("");

    if (state.categories.length) {
      html += '<li class="stat-section-label">By category</li>';
      html += state.categories.map(function (cat) {
        var count = state.items.filter(function (it) { return it.categoryId === cat.id; }).length;
        return '<li class="stat-row"><span class="stat-label"><span class="dot" style="background:' + cat.color + '"></span>' + escapeHtml(cat.name) + '</span><span class="stat-value">' + count + '</span></li>';
      }).join("");
      var uncategorizedCount = state.items.filter(function (it) { return !getCategory(it.categoryId); }).length;
      if (uncategorizedCount > 0) {
        html += '<li class="stat-row"><span class="stat-label"><span class="dot"></span>Uncategorized</span><span class="stat-value">' + uncategorizedCount + '</span></li>';
      }
    }
    statsList.innerHTML = html;
  }

  document.getElementById("statsBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    renderStats();
    statsSheet.hidden = false;
  });
  document.getElementById("statsCloseBtn").addEventListener("click", function () { statsSheet.hidden = true; });
  statsSheet.addEventListener("click", function (e) { if (e.target === statsSheet) statsSheet.hidden = true; });

  // ---------- import options sheet ----------

  function mergeById(existing, incoming) {
    var existingIds = {};
    existing.forEach(function (x) { existingIds[x.id] = true; });
    var added = incoming.filter(function (x) { return !existingIds[x.id]; });
    return existing.concat(added);
  }

  // For items specifically: when the same id exists on both sides, keep
  // whichever has the more recent updatedAt, rather than silently dropping
  // the incoming edit. This is what makes "Merge" safe for two people
  // editing the same shared item on different devices.
  function mergeItemsLWW(existing, incoming) {
    var map = {};
    existing.forEach(function (it) { map[it.id] = it; });
    incoming.forEach(function (it) {
      var cur = map[it.id];
      if (!cur) { map[it.id] = it; return; }
      var curTime = cur.updatedAt ? new Date(cur.updatedAt).getTime() : 0;
      var incTime = it.updatedAt ? new Date(it.updatedAt).getTime() : 0;
      if (incTime > curTime) map[it.id] = it;
    });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  var importOptionsSheet = document.getElementById("importOptionsSheet");
  var importOptionsForm = document.getElementById("importOptionsForm");

  document.getElementById("importItemsSegmented").addEventListener("click", function (e) {
    var btn = e.target.closest(".segment"); if (!btn) return;
    this.querySelectorAll(".segment").forEach(function (s) { s.classList.toggle("is-active", s === btn); });
  });
  document.getElementById("importHistorySegmented").addEventListener("click", function (e) {
    var btn = e.target.closest(".segment"); if (!btn) return;
    this.querySelectorAll(".segment").forEach(function (s) { s.classList.toggle("is-active", s === btn); });
  });

  document.getElementById("importInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var importedItems = Array.isArray(parsed) ? parsed : parsed.items;
        var importedHistory = Array.isArray(parsed) ? [] : (parsed.history || []);
        var importedCategories = Array.isArray(parsed) ? null : (parsed.categories || null);
        var importedSettings = Array.isArray(parsed) ? null : (parsed.settings || null);
        var exportedBy = Array.isArray(parsed) ? "" : (parsed.exportedBy || "");
        var exportedAt = Array.isArray(parsed) ? null : (parsed.exportedAt || null);
        if (!Array.isArray(importedItems)) throw new Error("File is not a valid backup");

        state.pendingImport = { items: importedItems, history: importedHistory, categories: importedCategories, settings: importedSettings };

        var existingIds = {};
        state.items.forEach(function (it) { existingIds[it.id] = true; });
        var newCount = importedItems.filter(function (it) { return !existingIds[it.id]; }).length;
        var overlapCount = importedItems.length - newCount;

        var sourceLine = exportedBy || exportedAt
          ? "Backup from " + (exportedBy || "an unnamed device") + (exportedAt ? ", taken " + relativeTime(exportedAt) : "") + ". "
          : "";

        document.getElementById("importSummaryLine").textContent =
          sourceLine + "Contains " + importedItems.length + " item(s) — " + newCount + " new to this device, " +
          overlapCount + " already tracked here (the most recently edited version of each is kept on Merge) — " +
          "and " + importedHistory.length + " withdrawal record(s).";

        document.querySelectorAll("#importItemsSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s.dataset.mode === "merge"); });
        document.querySelectorAll("#importHistorySegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s.dataset.mode === "merge"); });

        settingsSheet.hidden = true;
        importOptionsSheet.hidden = false;
      } catch (err) {
        alert("Could not read that file: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  function closeImportOptions() { state.pendingImport = null; importOptionsSheet.hidden = true; }
  document.getElementById("importCancelBtn").addEventListener("click", closeImportOptions);
  importOptionsSheet.addEventListener("click", function (e) { if (e.target === importOptionsSheet) closeImportOptions(); });

  importOptionsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!state.pendingImport) return;
    var itemsMode = document.querySelector("#importItemsSegmented .segment.is-active").dataset.mode;
    var historyMode = document.querySelector("#importHistorySegmented .segment.is-active").dataset.mode;

    state.items = itemsMode === "replace" ? state.pendingImport.items : mergeItemsLWW(state.items, state.pendingImport.items);
    state.history = historyMode === "replace" ? state.pendingImport.history : mergeById(state.history, state.pendingImport.history);

    // Categories always reconcile additively, including subcategories —
    // never silently dropped just because the parent category already exists.
    if (state.pendingImport.categories) {
      state.pendingImport.categories.forEach(function (ic) {
        var existingCat = getCategory(ic.id);
        if (!existingCat) { state.categories.push(ic); return; }
        (ic.subcategories || []).forEach(function (isub) {
          if (!existingCat.subcategories.some(function (s) { return s.id === isub.id; })) {
            existingCat.subcategories.push(isub);
          }
        });
      });
    }

    // Settings (thresholds etc.) only come along on a full Replace — a
    // Merge shouldn't silently change your thresholds to someone else's.
    // Your device name is never overwritten by an import either way.
    if (itemsMode === "replace" && state.pendingImport.settings) {
      var myDeviceName = state.settings.deviceName;
      state.settings = Object.assign({}, state.pendingImport.settings, { deviceName: myDeviceName });
    }

    state.settings.lastImportAt = new Date().toISOString();

    migrateItems(state.items);
    saveItems(); saveHistory(); saveCategories(); saveSettings();

    state.pendingImport = null;
    importOptionsSheet.hidden = true;
    render();
  });

  // ---------- location audit ----------

  var locationAuditSheet = document.getElementById("locationAuditSheet");
  var auditListEl = document.getElementById("auditList");
  var auditMissingListEl = document.getElementById("auditMissingList");

  function getBatchesAtLocation(location) {
    var out = [];
    state.items.forEach(function (item) {
      item.batches.forEach(function (b) {
        if (b.location === location) out.push({ item: item, batch: b });
      });
    });
    return out;
  }

  function renderAuditLocationChips() {
    var container = document.getElementById("auditLocationChips");
    var locs = allKnownLocations();
    if (!locs.length) {
      container.innerHTML = '<p class="settings-desc">No locations recorded yet — add a location to a batch first.</p>';
      return;
    }
    container.innerHTML = locs.map(function (loc) {
      return '<button type="button" class="chip" data-location="' + escapeHtml(loc) + '">' + escapeHtml(loc) + '</button>';
    }).join("");
  }

  function renderAuditItemSuggestions() {
    var dl = document.getElementById("auditItemSuggestions");
    dl.innerHTML = state.items.map(function (it) { return '<option value="' + escapeHtml(it.name) + '"></option>'; }).join("");
  }

  function renderAuditMissing(entries) {
    var missing = entries.filter(function (e) { return !state.auditChecked[e.batch.id]; });
    var section = document.getElementById("auditMissingSection");
    if (missing.length === 0) { section.hidden = true; return; }
    section.hidden = false;
    auditMissingListEl.innerHTML = missing.map(function (e) {
      return '<li class="category-row">' +
        '<div class="category-row-main">' +
          '<span class="category-name">' + escapeHtml(e.item.name) + '</span>' +
          '<span class="category-count">' + formatQty(e.batch.quantity) + (e.item.unit ? " " + e.item.unit : "") + '</span>' +
          '<button type="button" class="btn-danger audit-remove" data-item-id="' + e.item.id + '" data-batch-id="' + e.batch.id + '">Remove</button>' +
          '<button type="button" class="btn-secondary audit-move" data-item-id="' + e.item.id + '" data-batch-id="' + e.batch.id + '">Move</button>' +
        '</div>' +
      '</li>';
    }).join("");
  }

  function renderAuditChecklist() {
    var entries = getBatchesAtLocation(state.auditLocation);
    var checkedCount = entries.filter(function (e) { return state.auditChecked[e.batch.id]; }).length;
    document.getElementById("auditProgressLine").textContent =
      'Checking "' + state.auditLocation + '" — ' + checkedCount + " of " + entries.length + " found so far.";

    auditListEl.innerHTML = entries.map(function (e) {
      var checked = !!state.auditChecked[e.batch.id];
      var eff = getBatchEffectiveDate(e.item, e.batch);
      var status = eff ? expiryStatus(eff.date, eff.type, true) : { label: "", cls: "" };
      var qtyText = formatQty(e.batch.quantity) + (e.item.unit ? " " + e.item.unit : "");
      return '<li class="batch-row">' +
        '<input type="checkbox" class="audit-check" data-batch-id="' + e.batch.id + '"' + (checked ? " checked" : "") + '>' +
        '<span class="batch-qty">' + escapeHtml(e.item.name) + '</span>' +
        '<span class="batch-expiry ' + status.cls + '">' + qtyText + (status.label ? " · " + status.label : "") + '</span>' +
      '</li>';
    }).join("");

    renderAuditMissing(entries);
  }

  function startAudit(location) {
    state.auditLocation = location;
    state.auditChecked = {};
    document.getElementById("auditPickLocation").hidden = true;
    document.getElementById("auditChecklist").hidden = false;
    renderAuditItemSuggestions();
    renderAuditChecklist();
  }

  function openLocationAudit() {
    settingsSheet.hidden = true;
    state.auditLocation = null;
    state.auditChecked = {};
    document.getElementById("auditPickLocation").hidden = false;
    document.getElementById("auditChecklist").hidden = true;
    renderAuditLocationChips();
    locationAuditSheet.hidden = false;
  }

  document.getElementById("startAuditBtn").addEventListener("click", openLocationAudit);
  document.getElementById("auditLocationChips").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip"); if (!btn) return;
    startAudit(btn.dataset.location);
  });

  auditListEl.addEventListener("change", function (e) {
    if (!e.target.classList.contains("audit-check")) return;
    state.auditChecked[e.target.dataset.batchId] = e.target.checked;
    renderAuditChecklist();
  });

  document.getElementById("auditAddItemBtn").addEventListener("click", function () {
    var name = document.getElementById("auditAddItemInput").value.trim();
    if (!name) return;
    var item = state.items.find(function (it) { return it.name.toLowerCase() === name.toLowerCase(); });
    if (!item) {
      alert('No item named "' + name + '" found. Add it as a new item from the main list first, then log it here.');
      return;
    }
    openBatchSheet(null, "direct", item.id);
    document.getElementById("batchLocation").value = state.auditLocation;
    document.getElementById("auditAddItemInput").value = "";
  });

  auditMissingListEl.addEventListener("click", function (e) {
    var removeBtn = e.target.closest(".audit-remove");
    if (removeBtn) {
      if (!confirm("Remove this batch? This can't be undone.")) return;
      var item = state.items.find(function (it) { return it.id === removeBtn.dataset.itemId; });
      if (item) {
        item.batches = item.batches.filter(function (b) { return b.id !== removeBtn.dataset.batchId; });
        item.updatedAt = new Date().toISOString();
        saveItems();
        render();
        renderAuditChecklist();
      }
      return;
    }
    var moveBtn = e.target.closest(".audit-move");
    if (moveBtn) {
      var newLoc = prompt("Move this batch to which location?");
      if (!newLoc || !newLoc.trim()) return;
      var item2 = state.items.find(function (it) { return it.id === moveBtn.dataset.itemId; });
      if (item2) {
        var b2 = item2.batches.find(function (x) { return x.id === moveBtn.dataset.batchId; });
        if (b2) {
          b2.location = newLoc.trim();
          item2.updatedAt = new Date().toISOString();
          saveItems();
          render();
          renderAuditChecklist();
        }
      }
      return;
    }
  });

  document.getElementById("auditFinishBtn").addEventListener("click", function () { locationAuditSheet.hidden = true; });
  document.getElementById("auditCloseBtn").addEventListener("click", function () { locationAuditSheet.hidden = true; });
  locationAuditSheet.addEventListener("click", function (e) { if (e.target === locationAuditSheet) locationAuditSheet.hidden = true; });

  // ---------- shopping list ----------

  var shoppingListSheet = document.getElementById("shoppingListSheet");
  var shoppingListResultsEl = document.getElementById("shoppingListResults");
  state.shoppingListResults = [];

  function generateShoppingList() {
    var includeDepleted = document.getElementById("slIncludeDepleted").checked;
    var includeReorder = document.getElementById("slIncludeReorder").checked;
    var includeSoon = document.getElementById("slIncludeSoon").checked;

    var results = [];
    state.items.forEach(function (item) {
      var total = itemTotalQty(item);
      var reasons = [];
      if (includeDepleted && isDepleted(item)) reasons.push("depleted");
      if (includeReorder && item.reorderThreshold !== null && total <= item.reorderThreshold) {
        reasons.push("at/below reorder threshold of " + formatQty(item.reorderThreshold));
      }
      if (includeSoon && isSoon(item)) reasons.push("expiring soon");
      if (reasons.length) results.push({ item: item, total: total, reasons: reasons });
    });
    return results;
  }

  function groupedByCategory(results) {
    var grouped = {};
    results.forEach(function (r) {
      var catId = getCategory(r.item.categoryId) ? r.item.categoryId : "uncategorized";
      (grouped[catId] = grouped[catId] || []).push(r);
    });
    return grouped;
  }

  function categoryOrder() {
    return state.categories.map(function (c) { return c.id; }).concat(["uncategorized"]);
  }

  function renderShoppingList(results) {
    if (!results.length) {
      shoppingListResultsEl.innerHTML = '<li class="batch-empty">Nothing matches the selected criteria.</li>';
      return;
    }
    var grouped = groupedByCategory(results);
    var html = "";
    categoryOrder().forEach(function (catId) {
      var list = grouped[catId];
      if (!list || !list.length) return;
      var catName = catId === "uncategorized" ? "Uncategorized" : categoryName(catId);
      html += '<li class="stat-section-label">' + escapeHtml(catName) + '</li>';
      list.forEach(function (r) {
        html += '<li class="category-row"><div class="category-row-main">' +
          '<span class="category-name">' + escapeHtml(r.item.name) + '</span>' +
          '<span class="category-count">' + formatQty(r.total) + (r.item.unit ? " " + r.item.unit : "") + '</span>' +
        '</div><p class="settings-desc">' + escapeHtml(r.reasons.join(", ")) + '</p></li>';
      });
    });
    shoppingListResultsEl.innerHTML = html;
  }

  function shoppingListAsText(results) {
    var grouped = groupedByCategory(results);
    var lines = ["Shopping list — " + new Date().toLocaleDateString()];
    categoryOrder().forEach(function (catId) {
      var list = grouped[catId];
      if (!list || !list.length) return;
      lines.push("");
      lines.push((catId === "uncategorized" ? "Uncategorized" : categoryName(catId)).toUpperCase());
      list.forEach(function (r) {
        lines.push("- " + r.item.name + " (" + formatQty(r.total) + (r.item.unit ? " " + r.item.unit : "") + " — " + r.reasons.join(", ") + ")");
      });
    });
    return lines.join("\n");
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch (e) { console.error("Clipboard fallback failed", e); }
    document.body.removeChild(ta);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  document.getElementById("generateShoppingListBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    document.getElementById("shoppingListResultsSection").hidden = true;
    shoppingListSheet.hidden = false;
  });

  document.getElementById("slGenerateBtn").addEventListener("click", function () {
    state.shoppingListResults = generateShoppingList();
    renderShoppingList(state.shoppingListResults);
    document.getElementById("shoppingListResultsSection").hidden = false;
  });

  document.getElementById("slCopyBtn").addEventListener("click", function () {
    copyToClipboard(shoppingListAsText(state.shoppingListResults));
    alert("Copied to clipboard.");
  });

  document.getElementById("slShareBtn").addEventListener("click", function () {
    var text = shoppingListAsText(state.shoppingListResults);
    if (navigator.share) {
      navigator.share({ title: "Depot shopping list", text: text }).catch(function () {});
    } else {
      copyToClipboard(text);
      alert("Sharing isn't available in this browser — copied to clipboard instead.");
    }
  });

  document.getElementById("shoppingListCloseBtn").addEventListener("click", function () { shoppingListSheet.hidden = true; });
  shoppingListSheet.addEventListener("click", function (e) { if (e.target === shoppingListSheet) shoppingListSheet.hidden = true; });

  // ---------- barcode scanning ----------

  var scanSheet = document.getElementById("scanSheet");
  var scanStream = null;
  var scanRAF = null;
  var barcodeDetector = null;

  function supportsBarcodeDetector() { return "BarcodeDetector" in window; }

  function showScanUnsupported(message) {
    document.getElementById("scanCameraWrap").hidden = true;
    var el = document.getElementById("scanUnsupported");
    el.hidden = false;
    el.textContent = message;
  }

  function startScanCamera() {
    document.getElementById("scanUnsupported").hidden = true;
    document.getElementById("scanResultWrap").hidden = true;
    document.getElementById("scanCameraWrap").hidden = false;
    document.getElementById("scanStatusLine").textContent = "Point the camera at a barcode.";

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (stream) {
      scanStream = stream;
      var video = document.getElementById("scanVideo");
      video.srcObject = stream;
      barcodeDetector = new window.BarcodeDetector();
      scanLoop();
    }).catch(function (err) {
      showScanUnsupported("Couldn't access the camera (" + err.message + "). Check camera permissions for this site in your browser settings.");
    });
  }

  function scanLoop() {
    if (!scanStream) return;
    if (state.scanPaused) { scanRAF = requestAnimationFrame(scanLoop); return; }
    var video = document.getElementById("scanVideo");
    if (video.readyState >= 2) {
      barcodeDetector.detect(video).then(function (codes) {
        if (codes && codes.length) { handleScanResult(codes[0].rawValue); return; }
        scanRAF = requestAnimationFrame(scanLoop);
      }).catch(function () {
        scanRAF = requestAnimationFrame(scanLoop);
      });
    } else {
      scanRAF = requestAnimationFrame(scanLoop);
    }
  }

  function stopScanCamera() {
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
  }

  function closeScanSheet() {
    stopScanCamera();
    scanSheet.hidden = true;
  }

  function openScanSheet(context) {
    state.scanContext = context || "global";
    state.scanMode = "single";
    state.scanPaused = false;
    state.scanSessionLog = [];
    state.scanLastHandledCode = null;
    document.getElementById("scanResultWrap").hidden = true;
    document.getElementById("scanUnsupported").hidden = true;
    document.getElementById("scanCameraWrap").hidden = true;
    document.getElementById("scanMultiOverlay").hidden = true;
    document.getElementById("scanSessionLog").hidden = true;
    document.querySelectorAll("#scanModeSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s.dataset.mode === "single"); });
    document.getElementById("scanModeSegmented").hidden = state.scanContext !== "global";
    scanSheet.hidden = false;

    if (!supportsBarcodeDetector()) {
      showScanUnsupported("Barcode scanning isn't supported in this browser. You can still type a barcode manually.");
      return;
    }
    startScanCamera();
  }

  document.getElementById("scanModeSegmented").addEventListener("click", function (e) {
    var btn = e.target.closest(".segment");
    if (!btn) return;
    document.querySelectorAll("#scanModeSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s === btn); });
    state.scanMode = btn.dataset.mode;
  });

  function renderScanSessionLog() {
    var el = document.getElementById("scanSessionLog");
    if (!state.scanSessionLog.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = state.scanSessionLog.map(function (entry) {
      return '<li class="batch-row"><span class="batch-qty">' + escapeHtml(entry.name) + '</span>' +
        '<span class="batch-expiry">' + formatQty(entry.qty) + (entry.unit ? " " + entry.unit : "") + '</span></li>';
    }).join("");
  }

  function showMultiOverlay(code) {
    var item = state.items.find(function (it) { return it.barcodes.indexOf(code) !== -1; });
    state.scanMultiCode = code;
    state.scanMultiMatchedItemId = item ? item.id : null;

    document.getElementById("scanMultiOverlay").hidden = false;
    var nameLabel = document.getElementById("scanMultiNameLabel");
    var nameInput = document.getElementById("scanMultiNameInput");

    if (item) {
      document.getElementById("scanMultiLabel").textContent = 'Matches "' + item.name + '".';
      nameLabel.hidden = true;
      nameInput.value = item.name;
    } else {
      document.getElementById("scanMultiLabel").textContent =
        "Barcode " + code + " — no item matches yet. Enter a name to create one, or type an existing item's name to attach this barcode to it.";
      nameLabel.hidden = false;
      nameInput.value = "";
      document.getElementById("scanMultiNameSuggestions").innerHTML =
        state.items.map(function (it) { return '<option value="' + escapeHtml(it.name) + '"></option>'; }).join("");
    }

    document.getElementById("scanMultiQty").value = "1";
    document.getElementById("scanMultiLocation").value = state.scanLastLocation || "";
    renderLocationSuggestions();
    document.getElementById("scanMultiQty").focus();
  }

  document.getElementById("scanMultiAddBtn").addEventListener("click", function () {
    var code = state.scanMultiCode;
    var qty = roundQty(Number(document.getElementById("scanMultiQty").value)) || 1;
    var location = document.getElementById("scanMultiLocation").value.trim() || null;
    if (location) state.scanLastLocation = location;

    var item = state.scanMultiMatchedItemId ? state.items.find(function (it) { return it.id === state.scanMultiMatchedItemId; }) : null;
    if (!item) {
      var typedName = document.getElementById("scanMultiNameInput").value.trim();
      if (!typedName) { alert("Enter a name for this item."); return; }
      item = state.items.find(function (it) { return it.name.toLowerCase() === typedName.toLowerCase(); });
      if (item) {
        if (item.barcodes.indexOf(code) === -1) item.barcodes.push(code);
      } else {
        var defaultCatId = state.categories.length ? state.categories[0].id : null;
        item = {
          id: uid(), name: typedName, categoryId: defaultCatId, subcategoryId: null, unit: "",
          reorderThreshold: null, openShelfLifeDays: null, barcodes: [code], batches: [], notes: "",
          updatedAt: new Date().toISOString()
        };
        state.items.push(item);
      }
    }

    item.batches.push({ id: uid(), quantity: qty, expiry: null, expiryType: null, openDate: null, location: location });
    item.updatedAt = new Date().toISOString();
    saveItems();
    render();

    state.scanSessionLog.unshift({ name: item.name, qty: qty, unit: item.unit });
    renderScanSessionLog();

    document.getElementById("scanMultiOverlay").hidden = true;
    state.scanPaused = false;
  });

  document.getElementById("scanMultiSkipBtn").addEventListener("click", function () {
    document.getElementById("scanMultiOverlay").hidden = true;
    state.scanPaused = false;
  });

  function handleScanResult(code) {
    if (state.scanContext === "fill-field") {
      stopScanCamera();
      if (state.formBarcodes.indexOf(code) === -1) state.formBarcodes.push(code);
      renderFormBarcodes();
      scanSheet.hidden = true;
      return;
    }

    if (state.scanContext === "fill-view-barcode") {
      stopScanCamera();
      var viewItem = state.items.find(function (it) { return it.id === state.viewingId; });
      if (viewItem) {
        if (viewItem.barcodes.indexOf(code) === -1) viewItem.barcodes.push(code);
        viewItem.updatedAt = new Date().toISOString();
        saveItems();
        renderViewBarcodes(viewItem);
      }
      scanSheet.hidden = true;
      return;
    }

    if (state.scanMode === "multi") {
      var now = Date.now();
      if (code === state.scanLastHandledCode && (now - state.scanLastHandledAt) < 3000) {
        scanRAF = requestAnimationFrame(scanLoop);
        return;
      }
      state.scanLastHandledCode = code;
      state.scanLastHandledAt = now;
      state.scanPaused = true;
      showMultiOverlay(code);
      return;
    }

    stopScanCamera();
    document.getElementById("scanCameraWrap").hidden = true;
    document.getElementById("scanResultWrap").hidden = false;

    var item = state.items.find(function (it) { return it.barcodes.indexOf(code) !== -1; });
    var actionsEl = document.getElementById("scanResultActions");

    if (item) {
      document.getElementById("scanResultLine").textContent = 'Matches "' + item.name + '".';
      actionsEl.innerHTML =
        '<button type="button" class="btn-secondary" id="scanAddBatchBtn">Add batch</button>' +
        '<button type="button" class="btn-secondary" id="scanWithdrawBtn">Withdraw</button>' +
        '<button type="button" class="btn-ghost" id="scanAgainBtn">Scan again</button>';
      document.getElementById("scanAddBatchBtn").onclick = function () {
        closeScanSheet();
        openBatchSheet(null, "direct", item.id);
      };
      document.getElementById("scanWithdrawBtn").onclick = function () {
        closeScanSheet();
        openWithdrawFor(item.id);
      };
    } else {
      document.getElementById("scanResultLine").textContent = "Barcode " + code + " — no item matches yet.";
      actionsEl.innerHTML =
        '<button type="button" class="btn-secondary" id="scanCreateBtn">Create new item</button>' +
        '<button type="button" class="btn-secondary" id="scanAttachBtn">Attach to existing item</button>' +
        '<button type="button" class="btn-ghost" id="scanAgainBtn">Scan again</button>';
      document.getElementById("scanCreateBtn").onclick = function () {
        closeScanSheet();
        openForm(null);
        state.formBarcodes = [code];
        renderFormBarcodes();
      };
      document.getElementById("scanAttachBtn").onclick = function () {
        var name = prompt("Which item should this barcode attach to? Type its exact name.");
        if (!name || !name.trim()) return;
        var match = state.items.find(function (it) { return it.name.toLowerCase() === name.trim().toLowerCase(); });
        if (!match) { alert('No item named "' + name.trim() + '" found.'); return; }
        if (match.barcodes.indexOf(code) === -1) match.barcodes.push(code);
        match.updatedAt = new Date().toISOString();
        saveItems();
        closeScanSheet();
        render();
      };
    }

    document.getElementById("scanAgainBtn").onclick = function () {
      document.getElementById("scanResultWrap").hidden = true;
      startScanCamera();
    };
  }

  document.getElementById("scanBtn").addEventListener("click", function () { openScanSheet("global"); });
  document.getElementById("newBarcodeScanBtn").addEventListener("click", function () { openScanSheet("fill-field"); });
  document.getElementById("scanCancelBtn").addEventListener("click", closeScanSheet);
  scanSheet.addEventListener("click", function (e) { if (e.target === scanSheet) closeScanSheet(); });

  // ---------- settings sheet ----------

  var settingsSheet = document.getElementById("settingsSheet");

  function renderSyncStatus() {
    document.getElementById("syncStatusLine").textContent =
      "Last backup: " + relativeTime(state.settings.lastExportAt) + ". Last import: " + relativeTime(state.settings.lastImportAt) + ".";
    document.getElementById("deviceNameInput").value = state.settings.deviceName || "";
    document.getElementById("buildVersionLine").textContent = "Build " + APP_VERSION + " — compare this between devices/tabs if something looks out of date.";
  }

  document.getElementById("settingsBtn").addEventListener("click", function () {
    renderSyncStatus();
    settingsSheet.hidden = false;
  });
  document.getElementById("settingsCloseBtn").addEventListener("click", function () { settingsSheet.hidden = true; });
  settingsSheet.addEventListener("click", function (e) { if (e.target === settingsSheet) settingsSheet.hidden = true; });

  document.getElementById("deviceNameInput").addEventListener("change", function (e) {
    state.settings.deviceName = e.target.value.trim();
    saveSettings();
  });

  function slugify(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  document.getElementById("exportBtn").addEventListener("click", function () {
    state.settings.lastExportAt = new Date().toISOString();
    saveSettings();

    var backup = {
      exportedAt: state.settings.lastExportAt,
      exportedBy: state.settings.deviceName || "",
      items: state.items, history: state.history, categories: state.categories, settings: state.settings
    };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    var namePart = slugify(state.settings.deviceName);
    a.download = "depot-backup-" + (namePart ? namePart + "-" : "") + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    renderSyncStatus();
  });

  document.getElementById("clearAllBtn").addEventListener("click", function () {
    if (!confirm("Delete every item in Depot? This can't be undone.")) return;
    state.items = [];
    saveItems();
    render();
    settingsSheet.hidden = true;
  });

  // ---------- offline support ----------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
        // Every time the app opens, explicitly ask the browser to check the
        // network for a newer sw.js, rather than waiting for it to notice on its own.
        reg.update();
      }).catch(function (err) { console.warn("Service worker registration failed", err); });

      // If a new service worker takes control (because a newer version was found
      // and activated), reload once so the fresh files are actually used.
      var reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }

  // ---------- boot ----------

  function boot() {
    return migrateFromLocalStorage().then(function () {
      return Promise.all([idbGetAll("items"), idbGetAll("history"), idbGetAll("categories"), idbGetKV("settings", null)]);
    }).then(function (results) {
      state.items = results[0];
      state.history = results[1];
      var catsFromDb = results[2];
      state.categories = catsFromDb.length ? catsFromDb : defaultCategories();
      state.settings = results[3] || { soonDays: 30, urgentDays: 7, depletionThreshold: 0, deviceName: "", lastExportAt: null, lastImportAt: null };
      if (state.settings.deviceName === undefined) state.settings.deviceName = "";
      if (state.settings.lastExportAt === undefined) state.settings.lastExportAt = null;
      if (state.settings.lastImportAt === undefined) state.settings.lastImportAt = null;

      var itemsChanged = migrateItems(state.items);
      var historyChanged = migrateHistory(state.history);
      if (itemsChanged) saveItems();
      if (historyChanged) saveHistory();
      if (!catsFromDb.length) saveCategories();

      render();
    }).catch(function (err) {
      console.error("Depot failed to initialize storage", err);
      alert("Depot couldn't load its storage. Try reloading the app. If this keeps happening, export whatever backup you can and let me know.");
    });
  }

  boot();
})();
