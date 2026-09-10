(function () {
  "use strict";

  var LS_ITEMS_KEY = "depot.items.v1";
  var LS_HISTORY_KEY = "depot.history.v1";
  var LS_CATEGORIES_KEY = "depot.categories.v1";
  var LS_SETTINGS_KEY = "depot.settings.v1";
  var APP_VERSION = "v19";
  var SWATCHES = ["#6B8F47", "#B23A48", "#3E6C8C", "#8A6E4B", "#B8912F", "#3E8C7E", "#7A4E7E", "#5B6770"];

  function showAppError(message, error) {
    console.error(message, error);
    var banner = document.getElementById("appErrorNotice");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "appErrorNotice";
      banner.setAttribute("role", "alert");
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100;padding:16px;background:var(--paper-raised);color:var(--ink);border-bottom:2px solid var(--warn-urgent)";
      var text = document.createElement("p"); text.id = "appErrorText"; banner.appendChild(text);
      var dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "Dismiss";
      dismiss.onclick = function () { banner.hidden = true; }; banner.appendChild(dismiss);
      document.body.appendChild(banner);
    }
    document.getElementById("appErrorText").textContent = message + " — " + APP_VERSION + ": " + (error && error.message ? error.message : String(error || "Unknown error"));
    banner.hidden = false;
  }
  window.addEventListener("error", function (event) { if (event.error) showAppError("The action could not finish", event.error); });
  window.addEventListener("unhandledrejection", function (event) { showAppError("The action could not finish", event.reason); });

  // Old cached HTML may outlive a script update. Restore missing controls without
  // touching inventory, photos or any other persisted data.
  function ensureCurrentControls() {
    var unitInput = document.getElementById("fieldUnit");
    if (unitInput) { unitInput.removeAttribute("list"); unitInput.setAttribute("autocomplete", "off"); }
    var oldUnitList = document.getElementById("unitSuggestions");
    if (oldUnitList) oldUnitList.remove();
    var controls = document.querySelector(".controls");
    if (!controls.querySelector(".filter-row")) {
      var row = document.createElement("div"); row.className = "filter-row";
      controls.insertBefore(row, document.getElementById("categoryChips"));
      ["categoryChips", "subCategoryChips", "locationChips"].forEach(function (id) { row.appendChild(document.getElementById(id)); });
    }
    ["categoryChips", "subCategoryChips", "locationChips"].forEach(function (id) { document.getElementById(id).className = "filter-control"; });
    if (!controls.querySelector(".stock-filters")) {
      var toggles = document.createElement("div"); toggles.className = "stock-filters";
      var soon = document.getElementById("soonToggle").closest("label");
      controls.insertBefore(toggles, soon);
      toggles.appendChild(soon); toggles.appendChild(document.getElementById("depletedToggle").closest("label"));
    }
  }
  ensureCurrentControls();

  var state = {
    items: [],
    history: [],
    categories: [],
    locations: [],
    units: [],
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
    auditPhotoDraft: [],
    auditPhotoDraftUrls: [],
    auditHeaderPhotoUrl: null,
    viewPhotoUrls: [],
    scanContext: "global",
    scanMode: "single",
    scanPaused: false,
    scanSessionLog: [],
    scanLastLocation: "",
    scanLastHandledCode: null,
    scanLastHandledAt: 0,
    multiScanEditor: null,
    editorSaving: false,
    shoppingListResults: []
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function roundQty(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function formatQty(n) { return String(parseFloat(roundQty(n).toFixed(2))); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var APPEARANCE_KEY = "depot.appearance.v1";
  var appearance = "system";
  try { appearance = localStorage.getItem(APPEARANCE_KEY) || "system"; } catch (err) {}
  var systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
  function applyAppearance() {
    if (["system", "light", "dark"].indexOf(appearance) === -1) appearance = "system";
    var dark = appearance === "dark" || (appearance === "system" && systemAppearance.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#171C18" : "#F2F1ED";
    var select = document.getElementById("appearanceSelect"); if (select) select.value = appearance;
  }
  function renderAppearanceControl() {
    var select = document.getElementById("appearanceSelect");
    if (!select) {
      var label = document.createElement("label"); label.textContent = "Appearance";
      select = document.createElement("select"); select.id = "appearanceSelect";
      [["system", "Use system setting"], ["light", "Light"], ["dark", "Dark"]].forEach(function (choice) {
        var option = document.createElement("option"); option.value = choice[0]; option.textContent = choice[1]; select.appendChild(option);
      });
      label.appendChild(select); document.querySelector("#settingsSheet .settings-actions").prepend(label);
      select.addEventListener("change", function () {
        appearance = select.value; applyAppearance();
        try { localStorage.setItem(APPEARANCE_KEY, appearance); } catch (err) { showAppError("Appearance changed, but the preference could not be saved", err); }
      });
    }
    applyAppearance();
  }
  systemAppearance.addEventListener("change", function () { if (appearance === "system") applyAppearance(); });
  window.addEventListener("storage", function (e) { if (e.key === APPEARANCE_KEY) { appearance = e.newValue || "system"; applyAppearance(); } });
  applyAppearance();

  // ---------- undo toast ----------

  var undoToast = document.getElementById("undoToast");
  var undoTimer = null;
  var lastUndoFn = null;

  function showUndoToast(label, restoreFn) {
    lastUndoFn = restoreFn;
    document.getElementById("undoToastLabel").textContent = label;
    undoToast.hidden = false;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoToast.hidden = true; lastUndoFn = null; }, 6000);
  }

  document.getElementById("undoToastBtn").addEventListener("click", function () {
    if (undoTimer) clearTimeout(undoTimer);
    undoToast.hidden = true;
    if (lastUndoFn) lastUndoFn();
    lastUndoFn = null;
  });

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
  var DB_VERSION = 3;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        ["items", "history", "categories", "locations", "photos", "units"].forEach(function (name) {
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

  function idbPutPhoto(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("photos", "readwrite");
        tx.objectStore("photos").put(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGetPhoto(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction("photos", "readonly").objectStore("photos").get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDeletePhoto(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("photos", "readwrite");
        tx.objectStore("photos").delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbReplaceStores(recordsByStore) {
    var snapshot = JSON.parse(JSON.stringify(recordsByStore));
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(Object.keys(snapshot), "readwrite");
        tx.oncomplete = resolve;
        tx.onabort = function () { reject(tx.error || new Error("Storage transaction aborted")); };
        tx.onerror = function () { /* The abort handler reports the failed transaction. */ };
        try {
          Object.keys(snapshot).forEach(function (name) {
            var store = tx.objectStore(name);
            store.clear();
            snapshot[name].forEach(function (record) { store.put(record); });
          });
        } catch (err) { tx.abort(); reject(err); }
      });
    });
  }

  function saveItems() { return idbReplaceStores({ items: state.items, units: state.units }).catch(function (e) { console.error("Save items failed", e); }); }
  function saveHistory() { idbClearAndPutAll("history", state.history).catch(function (e) { console.error("Save history failed", e); }); }
  function saveCategories() { idbClearAndPutAll("categories", state.categories).catch(function (e) { console.error("Save categories failed", e); }); }
  function saveLocations() { idbClearAndPutAll("locations", state.locations).catch(function (e) { console.error("Save locations failed", e); }); }
  function saveSettings() { idbSetKV("settings", state.settings).catch(function (e) { console.error("Save settings failed", e); }); }

  function migrateFromLocalStorage() {
    return idbGetKV("legacyMigrationComplete", false).then(function (done) {
      if (done) return;
      return Promise.all([idbGetAll("items"), idbGetAll("history"), idbGetAll("categories"), idbGetAll("locations"), idbGetKV("settings", null)])
        .then(function (existing) {
          // Older IndexedDB installations have no marker. Any existing DB data,
          // including categories after clearing items, means this is not a first run.
          if (existing.slice(0, 4).some(function (rows) { return rows.length; }) || existing[4]) {
            return idbSetKV("legacyMigrationComplete", true);
          }
          var oldRaw = localStorage.getItem(LS_ITEMS_KEY);
          if (!oldRaw) return idbSetKV("legacyMigrationComplete", true);
          var items = JSON.parse(oldRaw) || [];
          var history = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]");
          var categories = JSON.parse(localStorage.getItem(LS_CATEGORIES_KEY) || "[]");
          var settings = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || "null");
          var kv = [{ key: "legacyMigrationComplete", value: true }];
          if (settings) kv.push({ key: "settings", value: settings });
          return idbReplaceStores({ items: items, history: history, categories: categories, kv: kv });
        });
    });
  }

  // ---------- image compression ----------

  function compressImageFile(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob); else reject(new Error("Could not encode image"));
        }, "image/jpeg", quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not load image")); };
      img.src = url;
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
        if (b.location === undefined && b.locationId === undefined) { b.location = null; changed = true; }
        if (b.openDate === undefined) { b.openDate = null; changed = true; }
      });

      if (it.reorderThreshold === undefined) { it.reorderThreshold = null; changed = true; }
      if (it.openShelfLifeDays === undefined) { it.openShelfLifeDays = null; changed = true; }
      if (it.barcodes === undefined) {
        it.barcodes = it.barcode ? [it.barcode] : [];
        delete it.barcode;
        changed = true;
      }
      if (it.photoIds === undefined) { it.photoIds = []; changed = true; }
      if (it.heroPhotoId === undefined) { it.heroPhotoId = null; changed = true; }
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

  // Converts old free-text batch.location strings into real Location
  // records (creating one per distinct name) and points each batch at
  // its record via locationId instead.
  function migrateBatchLocations(items, locations) {
    var changed = false;
    function findOrCreate(name) {
      var existing = locations.find(function (l) { return l.name.toLowerCase() === name.toLowerCase(); });
      if (existing) return existing;
      var loc = { id: uid(), name: name, photoIds: [], heroPhotoId: null, photosUpdatedAt: null, updatedAt: new Date().toISOString() };
      locations.push(loc);
      changed = true;
      return loc;
    }
    items.forEach(function (item) {
      item.batches.forEach(function (b) {
        if (b.location !== undefined) {
          if (b.location) {
            var loc = findOrCreate(b.location);
            b.locationId = loc.id;
          } else {
            b.locationId = null;
          }
          delete b.location;
          changed = true;
        } else if (b.locationId === undefined) {
          b.locationId = null;
          changed = true;
        }
      });
    });
    return changed;
  }

  function normalizeLocations(locations) {
    var changed = false;
    locations.forEach(function (l) {
      if (l.photoIds === undefined) { l.photoIds = []; changed = true; }
      if (l.heroPhotoId === undefined) { l.heroPhotoId = null; changed = true; }
      if (l.photosUpdatedAt === undefined) { l.photosUpdatedAt = null; changed = true; }
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

  // ---------- location helpers ----------

  function getLocation(id) { return state.locations.find(function (l) { return l.id === id; }) || null; }
  function locationName(id) {
    var l = getLocation(id);
    return l ? l.name : null;
  }
  function allLocations() {
    return state.locations.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  // Finds a location by name (case-insensitive) or creates one on the fly —
  // this is what lets the Location field stay a plain text box while
  // locations are real records underneath.
  function resolveLocationByName(name) {
    if (!name) return null;
    var trimmed = name.trim();
    if (!trimmed) return null;
    var existing = state.locations.find(function (l) { return l.name.toLowerCase() === trimmed.toLowerCase(); });
    if (existing) return existing.id;
    var loc = { id: uid(), name: trimmed, photoIds: [], heroPhotoId: null, photosUpdatedAt: null, updatedAt: new Date().toISOString() };
    state.locations.push(loc);
    saveLocations();
    return loc.id;
  }
  function batchLocationNames(item) {
    var seen = {}; var out = [];
    item.batches.forEach(function (b) {
      var name = locationName(b.locationId);
      if (name && !seen[name]) { seen[name] = true; out.push(name); }
    });
    return out;
  }
  var locationPickers = [];

  function closeLocationSuggestions() {
    locationPickers.forEach(function (picker) { picker.close(); });
  }

  function ensureSuggestionPicker(input, getOptions, label) {
    if (input.dataset.suggestionPicker) { closeLocationSuggestions(); return; }
    input.dataset.suggestionPicker = "true";
    input.removeAttribute("list");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    var wrapper = document.createElement("div"); wrapper.className = "location-picker";
    input.parentNode.insertBefore(wrapper, input); wrapper.appendChild(input);
    var toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "location-toggle";
    toggle.textContent = "▾"; toggle.setAttribute("aria-label", "Show saved " + label);
    var list = document.createElement("div"); list.className = "location-options"; list.id = input.id + "Options";
    list.setAttribute("aria-label", "Saved " + label);
    list.setAttribute("role", "listbox"); list.hidden = true;
    input.setAttribute("aria-controls", list.id); toggle.setAttribute("aria-controls", list.id);
    wrapper.appendChild(toggle); wrapper.appendChild(list);
    var active = -1;
    function close() { list.hidden = true; active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
    function show(all) {
      var query = input.value.trim().toLowerCase();
      var matches = getOptions().filter(function (loc) { return all || (query && loc.name.toLowerCase().indexOf(query) !== -1); });
      list.replaceChildren(); active = -1; input.removeAttribute("aria-activedescendant");
      if (!matches.length) { close(); return; }
      matches.forEach(function (loc, index) {
        var option = document.createElement("button"); option.type = "button"; option.tabIndex = -1;
        option.id = list.id + "-" + index; option.setAttribute("role", "option"); option.setAttribute("aria-selected", "false");
        option.textContent = loc.name;
        option.addEventListener("pointerdown", function (e) { e.preventDefault(); });
        option.addEventListener("click", function (e) {
          e.preventDefault();
          var sheet = input.closest(".sheet-backdrop");
          if (list.hidden || !input.isConnected || (sheet && sheet.hidden)) return;
          input.value = loc.name; close(); input.focus();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          close();
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        list.appendChild(option);
      });
      var rect = input.getBoundingClientRect();
      var viewport = window.visualViewport;
      var bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      var roomBelow = bottom - rect.bottom - 12;
      var roomAbove = rect.top - (viewport ? viewport.offsetTop : 0) - 12;
      var above = roomBelow < 140 && roomAbove > roomBelow;
      list.classList.toggle("above", above);
      list.style.maxHeight = Math.max(44, Math.min(200, above ? roomAbove : roomBelow)) + "px";
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    }
    toggle.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    toggle.addEventListener("click", function (e) { e.preventDefault(); if (list.hidden) show(true); else close(); });
    input.addEventListener("input", function () { show(false); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); e.preventDefault(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (list.hidden) show(!input.value.trim());
        var options = list.querySelectorAll('[role="option"]'); if (!options.length || list.hidden) return;
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options.forEach(function (option, i) { option.setAttribute("aria-selected", String(i === active)); });
        input.setAttribute("aria-activedescendant", options[active].id); options[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); list.children[active].click(); }
    });
    wrapper.addEventListener("focusout", function (e) { if (!wrapper.contains(e.relatedTarget)) close(); });
    document.addEventListener("pointerdown", function (e) { if (!wrapper.contains(e.target)) close(); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", close);
    var sheet = input.closest(".sheet-backdrop");
    if (sheet) new MutationObserver(function () { if (sheet.hidden) close(); }).observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
    if (input.form) input.form.addEventListener("reset", close);
    locationPickers.push({ close: close });
  }

  function renderLocationSuggestions() {
    ensureSuggestionPicker(document.getElementById("batchLocation"), allLocations, "locations");
    closeLocationSuggestions();
  }

  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") closeLocationSuggestions(); });
  window.addEventListener("pagehide", closeLocationSuggestions);

  // ---------- unit records ----------

  function unitKey(name) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase(); }

  function resolveUnit(name) {
    var label = String(name || "").trim().replace(/\s+/g, " ");
    if (!label) return null;
    var key = unitKey(label);
    var unit = state.units.find(function (u) { return unitKey(u.name) === key; });
    if (!unit) { unit = { id: uid(), name: label }; state.units.push(unit); }
    return unit;
  }

  function normalizeItemUnits(items) {
    var changed = false;
    items.forEach(function (item) {
      var unit = resolveUnit(item.unit);
      var unitId = unit ? unit.id : null;
      var label = unit ? unit.name : "";
      if (item.unitId !== unitId || item.unit !== label) changed = true;
      item.unitId = unitId;
      item.unit = label;
    });
    return changed;
  }

  function renderUnitSuggestions() {
    ensureCurrentControls();
    ensureSuggestionPicker(document.getElementById("fieldUnit"), function () {
      return state.units.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    }, "units");
    closeLocationSuggestions();
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
      if (!worst || STATUS_RANK[s.cls] > STATUS_RANK[worst.status.cls] ||
          (STATUS_RANK[s.cls] === STATUS_RANK[worst.status.cls] && daysUntil(eff.date) < daysUntil(worst.eff.date))) worst = { batch: b, eff: eff, status: s };
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
        if (state.activeLocation !== "all" && !it.batches.some(function (b) { return b.locationId === state.activeLocation; })) return false;
        if (state.search) {
          var q = state.search.toLowerCase();
          var hay = (it.name + " " + batchLocationNames(it).join(" ") + " " + (it.notes || "") + " " + it.barcodes.join(" ")).toLowerCase();
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

  function closeFilterMenus() {
    document.querySelectorAll(".filter-options").forEach(function (menu) { menu.hidden = true; });
    document.querySelectorAll(".filter-trigger").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
  }

  function renderFilterMenu(container, title, choices, selected, attribute) {
    container.replaceChildren();
    var choice = choices.find(function (c) { return c.id === selected; });
    var trigger = document.createElement("button"); trigger.type = "button";
    trigger.id = container.id + "Trigger"; trigger.className = "filter-trigger";
    trigger.classList.toggle("is-active", selected !== "all");
    trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", title + ": " + (choice ? choice.name : "All"));
    trigger.title = title + ": " + (choice ? choice.name : "All");
    var label = document.createElement("span"); label.textContent = selected === "all" ? title : (choice ? choice.name : title);
    var arrow = document.createElement("span"); arrow.textContent = "▾"; arrow.setAttribute("aria-hidden", "true");
    trigger.appendChild(label); trigger.appendChild(arrow);
    var menu = document.createElement("div"); menu.className = "filter-options"; menu.id = container.id + "Menu"; menu.hidden = true;
    menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", title);
    trigger.setAttribute("aria-controls", menu.id);
    choices.forEach(function (c) {
      var option = document.createElement("button"); option.type = "button"; option.className = "chip filter-option";
      option.setAttribute("data-" + attribute, c.id); option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(c.id === selected));
      option.tabIndex = -1; option.textContent = c.name;
      option.addEventListener("click", function () { closeFilterMenus(); queueMicrotask(function () { var next = document.getElementById(trigger.id); if (next) next.focus(); }); });
      menu.appendChild(option);
    });
    function open() {
      closeFilterMenus(); closeLocationSuggestions(); menu.hidden = false; trigger.setAttribute("aria-expanded", "true");
      var selectedOption = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
      if (selectedOption) selectedOption.focus();
    }
    trigger.addEventListener("click", function () { if (menu.hidden) open(); else closeFilterMenus(); });
    trigger.addEventListener("keydown", function (e) { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeFilterMenus(); trigger.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault(); var options = Array.from(menu.children), current = options.indexOf(document.activeElement);
        var next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      }
    });
    container.onfocusout = function (e) { if (!container.contains(e.relatedTarget)) closeFilterMenus(); };
    container.appendChild(trigger); container.appendChild(menu);
  }
  document.addEventListener("pointerdown", function (e) { if (!e.target.closest(".filter-control")) closeFilterMenus(); });

  function renderCategoryFilters() {
    var choices = [{ id: "all", name: "All categories" }].concat(state.categories.map(function (cat) { return { id: cat.id, name: cat.name }; }));
    if (state.items.some(function (item) { return !getCategory(item.categoryId); })) choices.push({ id: "uncategorized", name: "Uncategorized" });
    if (!choices.some(function (c) { return c.id === state.activeCategory; })) { state.activeCategory = "all"; state.activeSubCategory = "all"; }
    renderFilterMenu(document.getElementById("categoryChips"), "Category", choices, state.activeCategory, "category");
  }

  function renderSubCategoryFilters() {
    var container = document.getElementById("subCategoryChips");
    var cat = getCategory(state.activeCategory);
    if (!cat || !cat.subcategories.length) { container.hidden = true; container.replaceChildren(); state.activeSubCategory = "all"; return; }
    container.hidden = false;
    var choices = [{ id: "all", name: "All subcategories" }].concat(cat.subcategories);
    if (!choices.some(function (c) { return c.id === state.activeSubCategory; })) state.activeSubCategory = "all";
    renderFilterMenu(container, "Subcategory", choices, state.activeSubCategory, "sub");
  }

  function renderLocationFilters() {
    var container = document.getElementById("locationChips"); container.hidden = false;
    var choices = [{ id: "all", name: "All locations" }].concat(allLocations());
    if (!choices.some(function (c) { return c.id === state.activeLocation; })) state.activeLocation = "all";
    renderFilterMenu(container, "Location", choices, state.activeLocation, "location");
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
      var locs = batchLocationNames(item);
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
      var locName = locationName(b.locationId);
      var locText = locName ? " · " + escapeHtml(locName) : "";
      return '<li class="batch-row" data-id="' + b.id + '">' +
        '<span class="batch-qty">' + escapeHtml(qtyText) + '</span>' +
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

  // ---------- item photos (view sheet) ----------

  function revokeViewPhotoUrls() {
    state.viewPhotoUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.viewPhotoUrls = [];
  }

  function renderItemPhotos(item) {
    revokeViewPhotoUrls();
    var galleryEl = document.getElementById("viewPhotoGallery");
    var thumbsEl = document.getElementById("viewPhotoThumbs");
    var ids = item.photoIds || [];
    if (!ids.length) { galleryEl.innerHTML = ""; thumbsEl.innerHTML = ""; return; }

    var ordered = (item.heroPhotoId && ids.indexOf(item.heroPhotoId) !== -1)
      ? [item.heroPhotoId].concat(ids.filter(function (id) { return id !== item.heroPhotoId; }))
      : ids.slice();

    Promise.all(ordered.map(function (id) { return idbGetPhoto(id); })).then(function (records) {
      var slidesHtml = "", thumbsHtml = "";
      records.forEach(function (rec) {
        if (!rec) return;
        var url = URL.createObjectURL(rec.blob);
        state.viewPhotoUrls.push(url);
        slidesHtml += '<img class="photo-slide" src="' + url + '" alt="">';
        var isHero = rec.id === item.heroPhotoId;
        thumbsHtml += '<div class="photo-thumb">' +
          '<img src="' + url + '" alt="">' +
          '<button type="button" class="icon-btn photo-hero-toggle" data-id="' + rec.id + '" title="' + (isHero ? "Hero photo" : "Make hero") + '">' + (isHero ? "★" : "☆") + '</button>' +
          '<button type="button" class="icon-btn photo-delete" data-id="' + rec.id + '" title="Delete">🗑</button>' +
        '</div>';
      });
      galleryEl.innerHTML = slidesHtml;
      thumbsEl.innerHTML = thumbsHtml;
    });
  }

  function handleViewPhotoFile(file) {
    if (!file) return;
    var item = state.items.find(function (it) { return it.id === state.viewingId; });
    if (!item) return;
    compressImageFile(file, 1280, 0.75).then(function (blob) {
      var photoId = uid();
      return idbPutPhoto({ id: photoId, blob: blob, createdAt: new Date().toISOString() }).then(function () {
        item.photoIds = (item.photoIds || []).concat([photoId]);
        if (!item.heroPhotoId) item.heroPhotoId = photoId;
        item.updatedAt = new Date().toISOString();
        saveItems();
        renderItemPhotos(item);
      });
    }).catch(function (err) { alert("Couldn't process that photo: " + err.message); });
  }

  document.getElementById("viewTakePhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0]; e.target.value = ""; handleViewPhotoFile(file);
  });
  document.getElementById("viewAddPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0]; e.target.value = ""; handleViewPhotoFile(file);
  });

  document.getElementById("viewPhotoThumbs").addEventListener("click", function (e) {
    var item = state.items.find(function (it) { return it.id === state.viewingId; });
    if (!item) return;
    var heroBtn = e.target.closest(".photo-hero-toggle");
    if (heroBtn) {
      item.heroPhotoId = heroBtn.dataset.id;
      item.updatedAt = new Date().toISOString();
      saveItems();
      renderItemPhotos(item);
      return;
    }
    var delBtn = e.target.closest(".photo-delete");
    if (delBtn) {
      var pid = delBtn.dataset.id;
      if (!confirm("Delete this photo?")) return;
      item.photoIds = (item.photoIds || []).filter(function (id) { return id !== pid; });
      if (item.heroPhotoId === pid) item.heroPhotoId = item.photoIds[0] || null;
      item.updatedAt = new Date().toISOString();
      saveItems();
      idbDeletePhoto(pid);
      renderItemPhotos(item);
      return;
    }
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
    renderItemPhotos(item);

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

  function deleteItemWithUndo(id, afterClose) {
    var item = state.items.find(function (it) { return it.id === id; });
    if (!item) return;
    var snapshot = state.items.slice();
    state.items = state.items.filter(function (it) { return it.id !== id; });
    saveItems();
    if (afterClose) afterClose();
    render();
    showUndoToast('Deleted "' + item.name + '".', function () {
      state.items = snapshot;
      saveItems();
      render();
    });
  }

  document.getElementById("viewDeleteBtn").addEventListener("click", function () {
    if (!state.viewingId) return;
    deleteItemWithUndo(state.viewingId, function () { itemViewSheet.hidden = true; });
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
      var locName = locationName(b.locationId);
      var locText = locName ? " · " + escapeHtml(locName) : "";
      return '<li class="batch-row" data-id="' + b.id + '">' +
        '<span class="batch-qty">' + escapeHtml(qtyText) + '</span>' +
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
    document.getElementById("batchLocation").value = batch ? (locationName(batch.locationId) || "") : (state.multiScanEditor ? state.scanLastLocation : "");
    renderLocationSuggestions();

    var type = batch && batch.expiryType ? batch.expiryType : "use_by";
    document.querySelectorAll("#batchExpiryTypeSegmented .segment").forEach(function (s) {
      s.classList.toggle("is-active", s.dataset.type === type);
    });

    batchSheet.hidden = false;
    batchQtyInput.focus();
  }

  function closeBatchSheet() {
    if (state.editorSaving) return;
    closeLocationSuggestions();
    batchSheet.hidden = true;
    batchForm.reset();
    state.editingBatchId = null;
    state.batchEditContext = "form";
    state.batchEditItemId = null;
    resumeMultiScan("batch");
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
    if (state.editorSaving || !batchForm.reportValidity()) return;
    var qty = roundQty(Number(batchQtyInput.value));
    if (!Number.isFinite(qty) || qty <= 0) return;
    var expiry = document.getElementById("batchExpiry").value || null;
    var activeSeg = document.querySelector("#batchExpiryTypeSegmented .segment.is-active");
    var type = expiry ? (activeSeg ? activeSeg.dataset.type : "use_by") : null;
    var openDate = document.getElementById("batchOpenDate").value || null;
    var typedLocation = document.getElementById("batchLocation").value.trim();
    var locationId = resolveLocationByName(typedLocation);
    if (state.batchEditContext !== "direct") {
      var draft = state.editingBatchId ? state.formBatches.find(function (b) { return b.id === state.editingBatchId; }) : null;
      var values = { quantity: qty, expiry: expiry, expiryType: type, openDate: openDate, locationId: locationId };
      if (draft) Object.assign(draft, values);
      else state.formBatches.push(Object.assign({ id: uid() }, values));
      if (state.multiScanEditor) state.scanLastLocation = typedLocation;
      renderFormBatches();
      closeBatchSheet();
      return;
    }
    var items = JSON.parse(JSON.stringify(state.items));
    var item = items.find(function (it) { return it.id === state.batchEditItemId; });
    if (!item) return;
    var batch = state.editingBatchId ? item.batches.find(function (b) { return b.id === state.editingBatchId; }) : null;
    var newBatch = !state.editingBatchId;
    if (!batch) { batch = { id: uid() }; item.batches.push(batch); }
    Object.assign(batch, { quantity: qty, expiry: expiry, expiryType: type, openDate: openDate, locationId: locationId });
    item.updatedAt = new Date().toISOString();
    state.editorSaving = true;
    batchForm.inert = true;
    idbReplaceStores({ items: items, locations: state.locations, units: state.units }).then(function () {
      state.items = items;
      if (state.multiScanEditor) state.scanLastLocation = typedLocation;
      renderViewBatches(item);
      render();
      if (newBatch && !locationAuditSheet.hidden && state.auditLocation) {
        state.auditChecked[batch.id] = true;
        renderAuditChecklist();
      }
      logMultiScan(item, qty);
      state.editorSaving = false;
      closeBatchSheet();
    }).catch(function (err) {
      showAppError("Couldn't save the batch. Your stock has not changed; try again", err);
    }).finally(function () { state.editorSaving = false; batchForm.inert = false; });
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

    renderUnitSuggestions();
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
    if (state.editorSaving) return;
    closeLocationSuggestions();
    itemSheet.hidden = true;
    itemForm.reset();
    state.editingId = null;
    state.formBatches = [];
    resumeMultiScan("item");
  }

  document.getElementById("fab").addEventListener("click", function () { openForm(null); });
  document.getElementById("emptyAddBtn").addEventListener("click", function () { openForm(null); });
  document.getElementById("cancelBtn").addEventListener("click", closeForm);
  itemSheet.addEventListener("click", function (e) { if (e.target === itemSheet) closeForm(); });

  itemForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.editorSaving || !itemForm.reportValidity()) return;
    var name = document.getElementById("fieldName").value.trim();
    if (!name) return;

    var reorderVal = document.getElementById("fieldReorderThreshold").value;
    var shelfLifeVal = document.getElementById("fieldOpenShelfLife").value;

    var unit = resolveUnit(document.getElementById("fieldUnit").value);
    var data = {
      name: name,
      categoryId: state.formCategoryId,
      subcategoryId: state.formSubCategoryId || null,
      unit: unit ? unit.name : "",
      unitId: unit ? unit.id : null,
      reorderThreshold: reorderVal === "" ? null : roundQty(Number(reorderVal)),
      openShelfLifeDays: shelfLifeVal === "" ? null : Math.max(1, Number(shelfLifeVal) || 1),
      barcodes: state.formBarcodes.slice(),
      batches: state.formBatches.map(function (b) { return Object.assign({}, b); }),
      notes: document.getElementById("fieldNotes").value.trim(),
      updatedAt: new Date().toISOString()
    };

    var items = state.items.slice();
    if (state.editingId) {
      var idx = items.findIndex(function (it) { return it.id === state.editingId; });
      if (idx !== -1) items[idx] = Object.assign({}, items[idx], data);
    } else {
      data.id = uid();
      data.photoIds = [];
      data.heroPhotoId = null;
      items.push(data);
    }

    closeLocationSuggestions();
    state.editorSaving = true;
    itemForm.inert = true;
    idbReplaceStores({ items: items, units: state.units, locations: state.locations }).then(function () {
      state.items = items;
      logMultiScan(data, itemTotalQty(data));
      render();
      state.editorSaving = false;
      closeForm();
    }).catch(function (err) {
      showAppError("Couldn't save the item. Your inventory has not changed; try again", err);
    }).finally(function () { state.editorSaving = false; itemForm.inert = false; });
  });

  deleteBtn.addEventListener("click", function () {
    if (!state.editingId) return;
    deleteItemWithUndo(state.editingId, closeForm);
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
    var snapshot = state.history.slice();
    state.history = state.history.filter(function (h) { return h.id !== btn.dataset.id; });
    saveHistory();
    renderHistory();
    showUndoToast("Deleted 1 withdrawal record.", function () { state.history = snapshot; saveHistory(); renderHistory(); });
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
    var snapshot = state.history.slice();
    var shownIds = {};
    shown.forEach(function (h) { shownIds[h.id] = true; });
    state.history = state.history.filter(function (h) { return !shownIds[h.id]; });
    saveHistory();
    renderHistory();
    showUndoToast("Cleared " + shown.length + " withdrawal record(s).", function () { state.history = snapshot; saveHistory(); renderHistory(); });
  });

  document.getElementById("historyClearAllBtn").addEventListener("click", function () {
    if (!state.history.length) return;
    var snapshot = state.history.slice();
    state.history = [];
    saveHistory();
    renderHistory();
    showUndoToast("Cleared all " + snapshot.length + " withdrawal record(s).", function () { state.history = snapshot; saveHistory(); renderHistory(); });
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
      var affected = state.items.filter(function (it) { return it.categoryId === id2; });
      var itemsSnapshot = state.items.map(function (it) { return Object.assign({}, it); });
      var categoriesSnapshot = state.categories.map(function (c) { return Object.assign({}, c, { subcategories: c.subcategories.slice() }); });
      state.items.forEach(function (it) { if (it.categoryId === id2) { it.categoryId = null; it.subcategoryId = null; } });
      state.categories = state.categories.filter(function (c) { return c.id !== id2; });
      if (state.activeCategory === id2) { state.activeCategory = "all"; state.activeSubCategory = "all"; }
      saveItems(); saveCategories();
      renderCategoryManageList(); render();
      showUndoToast(
        'Deleted "' + cat2.name + '"' + (affected.length ? " (" + affected.length + " item(s) moved to Uncategorized)" : "") + ".",
        function () {
          state.items = itemsSnapshot;
          state.categories = categoriesSnapshot;
          saveItems(); saveCategories();
          renderCategoryManageList(); render();
        }
      );
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

  // ---------- manage locations sheet ----------

  var locationsSheet = document.getElementById("locationsSheet");
  var locationManageList = document.getElementById("locationManageList");

  function renderLocationManageList() {
    if (!state.locations.length) {
      locationManageList.innerHTML = '<li class="batch-empty">No locations yet — one is created automatically the first time you type a name into a batch\'s Location field.</li>';
      return;
    }
    locationManageList.innerHTML = allLocations().map(function (loc) {
      var batchCount = 0;
      state.items.forEach(function (it) { it.batches.forEach(function (b) { if (b.locationId === loc.id) batchCount++; }); });
      return '<li class="category-row" data-id="' + loc.id + '">' +
        '<div class="category-row-main">' +
          '<span class="category-name">' + escapeHtml(loc.name) + '</span>' +
          '<span class="category-count">' + batchCount + " batch" + (batchCount === 1 ? "" : "es") + " · " + loc.photoIds.length + " photo" + (loc.photoIds.length === 1 ? "" : "s") + '</span>' +
          '<button type="button" class="icon-btn loc-rename" data-id="' + loc.id + '" title="Rename">✎</button>' +
          '<button type="button" class="icon-btn loc-delete" data-id="' + loc.id + '" title="Delete">🗑</button>' +
        '</div>' +
      '</li>';
    }).join("");
  }

  locationManageList.addEventListener("click", function (e) {
    var renameBtn = e.target.closest(".loc-rename");
    if (renameBtn) {
      var loc = getLocation(renameBtn.dataset.id); if (!loc) return;
      var name = prompt("Rename location", loc.name);
      if (name && name.trim()) { loc.name = name.trim(); loc.updatedAt = new Date().toISOString(); saveLocations(); renderLocationManageList(); render(); }
      return;
    }
    var delBtn = e.target.closest(".loc-delete");
    if (delBtn) {
      var id = delBtn.dataset.id; var loc2 = getLocation(id); if (!loc2) return;
      var itemsSnapshot = state.items.map(function (it) { return Object.assign({}, it, { batches: it.batches.map(function (b) { return Object.assign({}, b); }) }); });
      var locationsSnapshot = state.locations.map(function (l) { return Object.assign({}, l); });
      var affectedCount = 0;
      state.items.forEach(function (it) { it.batches.forEach(function (b) { if (b.locationId === id) { b.locationId = null; affectedCount++; } }); });
      state.locations = state.locations.filter(function (l) { return l.id !== id; });
      if (state.activeLocation === id) state.activeLocation = "all";
      saveItems(); saveLocations();
      renderLocationManageList(); render();
      showUndoToast(
        'Deleted location "' + loc2.name + '"' + (affectedCount ? " (" + affectedCount + " batch(es) unassigned)" : "") + ".",
        function () {
          state.items = itemsSnapshot;
          state.locations = locationsSnapshot;
          saveItems(); saveLocations();
          renderLocationManageList(); render();
        }
      );
      return;
    }
  });

  document.getElementById("manageLocationsBtn").addEventListener("click", function () {
    settingsSheet.hidden = true;
    renderLocationManageList();
    locationsSheet.hidden = false;
  });
  document.getElementById("locationsCloseBtn").addEventListener("click", function () { locationsSheet.hidden = true; });
  locationsSheet.addEventListener("click", function (e) { if (e.target === locationsSheet) locationsSheet.hidden = true; });

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
      ["Locations", state.locations.length],
      ["Expiring within " + state.settings.soonDays + " days", expiringSoon],
      ["Already past date", expired],
      ["Depleted (≤ " + formatQty(state.settings.depletionThreshold) + ")", depleted],
      ["Withdrawals logged", state.history.length],
      ["Units withdrawn all-time", formatQty(totalWithdrawn)],
      ["Storage used (approx., excl. photos)", kb + " KB"]
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

  function preserveLocalPhotos(incoming, existing) {
    var local = new Map(existing.map(function (record) { return [record.id, record]; }));
    return incoming.map(function (record) {
      var current = local.get(record.id);
      var photos = current && Array.isArray(current.photoIds) ? current.photoIds.slice() : [];
      return Object.assign({}, record, {
        photoIds: photos,
        heroPhotoId: current && photos.indexOf(current.heroPhotoId) !== -1 ? current.heroPhotoId : (photos[0] || null),
        photosUpdatedAt: current ? (current.photosUpdatedAt || null) : null
      });
    });
  }

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
        var importedLocations = Array.isArray(parsed) ? null : (parsed.locations || null);
        var importedSettings = Array.isArray(parsed) ? null : (parsed.settings || null);
        var importedUnits = Array.isArray(parsed) ? [] : (parsed.units || []);
        var exportedBy = Array.isArray(parsed) ? "" : (parsed.exportedBy || "");
        var exportedAt = Array.isArray(parsed) ? null : (parsed.exportedAt || null);
        if (!Array.isArray(importedItems)) throw new Error("File is not a valid backup");

        state.pendingImport = { items: importedItems, history: importedHistory, categories: importedCategories, locations: importedLocations, settings: importedSettings, units: importedUnits };

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
          "and " + importedHistory.length + " withdrawal record(s). Photos aren't included in backups, so imported items keep whatever photos they already have on this device.";

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

    var incomingItems = preserveLocalPhotos(state.pendingImport.items, state.items);
    state.items = itemsMode === "replace" ? incomingItems : mergeItemsLWW(state.items, incomingItems);
    state.history = historyMode === "replace" ? state.pendingImport.history : mergeById(state.history, state.pendingImport.history);

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

    if (state.pendingImport.locations) {
      preserveLocalPhotos(state.pendingImport.locations, state.locations).forEach(function (il) {
        if (!getLocation(il.id)) state.locations.push(il);
      });
    }

    if (itemsMode === "replace" && state.pendingImport.settings) {
      var myDeviceName = state.settings.deviceName;
      state.settings = Object.assign({}, state.pendingImport.settings, { deviceName: myDeviceName });
    }

    state.settings.lastImportAt = new Date().toISOString();

    migrateItems(state.items);
    migrateHistory(state.history);
    migrateBatchLocations(state.items, state.locations);
    normalizeLocations(state.locations);
    (state.pendingImport.units || []).forEach(function (unit) { resolveUnit(unit.name); });
    normalizeItemUnits(state.items);
    saveItems(); saveHistory(); saveCategories(); saveLocations(); saveSettings();

    state.pendingImport = null;
    importOptionsSheet.hidden = true;
    render();
  });

  // ---------- location audit ----------

  var locationAuditSheet = document.getElementById("locationAuditSheet");
  var auditListEl = document.getElementById("auditList");
  var auditMissingListEl = document.getElementById("auditMissingList");

  function getBatchesAtLocation(locationId) {
    var out = [];
    state.items.forEach(function (item) {
      item.batches.forEach(function (b) {
        if (b.locationId === locationId) out.push({ item: item, batch: b });
      });
    });
    return out;
  }

  function renderAuditLocationChips() {
    var container = document.getElementById("auditLocationChips");
    var locs = allLocations();
    if (!locs.length) {
      container.innerHTML = '<p class="settings-desc">No locations recorded yet — add a location to a batch first.</p>';
      return;
    }
    container.innerHTML = locs.map(function (loc) {
      return '<button type="button" class="chip" data-location="' + loc.id + '">' + escapeHtml(loc.name) + '</button>';
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
          '<span class="category-count">' + formatQty(e.batch.quantity) + (e.item.unit ? " " + escapeHtml(e.item.unit) : "") + '</span>' +
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
      'Checking "' + (locationName(state.auditLocation) || "") + '" — ' + checkedCount + " of " + entries.length + " found so far.";

    auditListEl.innerHTML = entries.map(function (e) {
      var checked = !!state.auditChecked[e.batch.id];
      var eff = getBatchEffectiveDate(e.item, e.batch);
      var status = eff ? expiryStatus(eff.date, eff.type, true) : { label: "", cls: "" };
      var qtyText = formatQty(e.batch.quantity) + (e.item.unit ? " " + e.item.unit : "");
      return '<li class="batch-row">' +
        '<input type="checkbox" class="audit-check" data-batch-id="' + e.batch.id + '"' + (checked ? " checked" : "") + '>' +
        '<span class="batch-qty">' + escapeHtml(e.item.name) + '</span>' +
        '<span class="batch-expiry ' + status.cls + '">' + escapeHtml(qtyText) + (status.label ? " · " + status.label : "") + '</span>' +
      '</li>';
    }).join("");

    renderAuditMissing(entries);
  }

  // ---------- location audit: photo header + update-photos flow ----------

  function renderAuditLocationHeader() {
    var loc = getLocation(state.auditLocation);
    var previewEl = document.getElementById("auditLocationPhotoPreview");
    var ageLine = document.getElementById("auditPhotoAgeLine");
    if (state.auditHeaderPhotoUrl) { URL.revokeObjectURL(state.auditHeaderPhotoUrl); state.auditHeaderPhotoUrl = null; }
    if (!loc) { previewEl.hidden = true; ageLine.textContent = ""; return; }

    if (loc.heroPhotoId) {
      idbGetPhoto(loc.heroPhotoId).then(function (rec) {
        if (rec) {
          var url = URL.createObjectURL(rec.blob);
          state.auditHeaderPhotoUrl = url;
          previewEl.src = url;
          previewEl.hidden = false;
        } else {
          previewEl.hidden = true;
        }
      });
    } else {
      previewEl.hidden = true;
    }
    ageLine.textContent = loc.photosUpdatedAt
      ? "Last photographed " + relativeTime(loc.photosUpdatedAt) + " (" + loc.photoIds.length + " photo" + (loc.photoIds.length === 1 ? "" : "s") + ")."
      : "No photos yet for this location.";
  }

  function renderAuditPhotoDraft() {
    document.getElementById("auditPhotoUpdateCount").textContent = "Photos to save: " + state.auditPhotoDraft.length;
    document.getElementById("auditPhotoUpdateThumbs").innerHTML = state.auditPhotoDraftUrls.map(function (url, i) {
      return '<div class="photo-thumb"><img src="' + url + '" alt="">' +
        '<button type="button" class="icon-btn audit-draft-remove" data-index="' + i + '" title="Remove">🗑</button></div>';
    }).join("");
  }

  document.getElementById("auditUpdatePhotosBtn").addEventListener("click", function () {
    state.auditPhotoDraft = [];
    state.auditPhotoDraftUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.auditPhotoDraftUrls = [];
    renderAuditPhotoDraft();
    document.getElementById("auditPhotoUpdatePanel").hidden = false;
  });

  function handleAuditPhotoFile(file) {
    if (!file) return;
    compressImageFile(file, 1600, 0.75).then(function (blob) {
      state.auditPhotoDraft.push(blob);
      state.auditPhotoDraftUrls.push(URL.createObjectURL(blob));
      renderAuditPhotoDraft();
    }).catch(function (err) { alert("Couldn't process that photo: " + err.message); });
  }

  document.getElementById("auditTakePhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0]; e.target.value = ""; handleAuditPhotoFile(file);
  });
  document.getElementById("auditAddPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0]; e.target.value = ""; handleAuditPhotoFile(file);
  });

  document.getElementById("auditPhotoUpdateThumbs").addEventListener("click", function (e) {
    var btn = e.target.closest(".audit-draft-remove");
    if (!btn) return;
    var i = Number(btn.dataset.index);
    URL.revokeObjectURL(state.auditPhotoDraftUrls[i]);
    state.auditPhotoDraft.splice(i, 1);
    state.auditPhotoDraftUrls.splice(i, 1);
    renderAuditPhotoDraft();
  });

  function closeAuditPhotoPanel() {
    state.auditPhotoDraftUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.auditPhotoDraft = [];
    state.auditPhotoDraftUrls = [];
    document.getElementById("auditPhotoUpdatePanel").hidden = true;
  }
  document.getElementById("auditPhotoCancelBtn").addEventListener("click", closeAuditPhotoPanel);

  function replaceLocationPhotos(loc, blobs) {
    var now = new Date().toISOString();
    var records = blobs.map(function (blob) { return { id: uid(), blob: blob, createdAt: now }; });
    var updated = Object.assign({}, loc, {
      photoIds: records.map(function (record) { return record.id; }),
      heroPhotoId: records[0].id, photosUpdatedAt: now, updatedAt: now
    });
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(["photos", "locations"], "readwrite");
        tx.oncomplete = function () { resolve(updated); };
        tx.onabort = function () { reject(tx.error || new Error("Photo update aborted")); };
        tx.onerror = function () {};
        try {
          var photos = tx.objectStore("photos");
          records.forEach(function (record) { photos.put(record); });
          tx.objectStore("locations").put(updated);
          loc.photoIds.forEach(function (id) { photos.delete(id); });
        } catch (err) { tx.abort(); reject(err); }
      });
    });
  }

  var auditPhotosSaving = false;
  document.getElementById("auditPhotoSaveBtn").addEventListener("click", function () {
    var loc = getLocation(state.auditLocation);
    if (!loc || auditPhotosSaving) return;
    if (!state.auditPhotoDraft.length) { alert("Add at least one photo, or Cancel."); return; }
    auditPhotosSaving = true;
    document.getElementById("auditPhotoSaveBtn").disabled = true;
    replaceLocationPhotos(loc, state.auditPhotoDraft.slice()).then(function (updated) {
      Object.assign(loc, updated);
      closeAuditPhotoPanel();
      if (state.auditLocation === loc.id) renderAuditLocationHeader();
      renderLocationManageList();
    }).catch(function (err) {
      alert("Couldn't save photos. Your previous photos are unchanged: " + err.message);
    }).finally(function () {
      auditPhotosSaving = false;
      document.getElementById("auditPhotoSaveBtn").disabled = false;
    });
  });

  function startAudit(locationId) {
    state.auditLocation = locationId;
    state.auditChecked = {};
    document.getElementById("auditPickLocation").hidden = true;
    document.getElementById("auditChecklist").hidden = false;
    renderAuditItemSuggestions();
    renderAuditChecklist();
    renderAuditLocationHeader();
  }

  function openLocationAudit() {
    settingsSheet.hidden = true;
    state.auditLocation = null;
    state.auditChecked = {};
    document.getElementById("auditPickLocation").hidden = false;
    document.getElementById("auditChecklist").hidden = true;
    closeAuditPhotoPanel();
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
    document.getElementById("batchLocation").value = locationName(state.auditLocation) || "";
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
          b2.locationId = resolveLocationByName(newLoc.trim());
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
          '<span class="category-count">' + formatQty(r.total) + (r.item.unit ? " " + escapeHtml(r.item.unit) : "") + '</span>' +
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
  var scanGeneration = 0;

  function supportsBarcodeDetector() { return "BarcodeDetector" in window; }

  function showScanUnsupported(message) {
    document.getElementById("scanCameraWrap").hidden = true;
    var el = document.getElementById("scanUnsupported");
    el.hidden = false;
    el.textContent = message;
  }

  function startScanCamera() {
    stopScanCamera();
    var generation = scanGeneration;
    document.getElementById("scanUnsupported").hidden = true;
    document.getElementById("scanResultWrap").hidden = true;
    document.getElementById("scanCameraWrap").hidden = false;
    document.getElementById("scanStatusLine").textContent = "Point the camera at a barcode.";

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (stream) {
      if (generation !== scanGeneration || scanSheet.hidden) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scanStream = stream;
      var video = document.getElementById("scanVideo");
      video.srcObject = stream;
      barcodeDetector = new window.BarcodeDetector();
      scanLoop();
    }).catch(function (err) {
      if (generation !== scanGeneration || scanSheet.hidden) return;
      stopScanCamera();
      showScanUnsupported("Couldn't access the camera (" + err.message + "). Check camera permissions for this site in your browser settings.");
    });
  }

  function scheduleScan() {
    if (scanStream && !scanSheet.hidden && !state.scanPaused && scanRAF === null) {
      scanRAF = requestAnimationFrame(scanLoop);
    }
  }

  function scanLoop() {
    scanRAF = null;
    if (!scanStream || scanSheet.hidden || state.scanPaused) return;
    var generation = scanGeneration;
    var video = document.getElementById("scanVideo");
    if (video.readyState < 2) { scheduleScan(); return; }
    barcodeDetector.detect(video).then(function (codes) {
      if (generation !== scanGeneration || scanSheet.hidden || !scanStream) return;
      if (codes && codes.length) handleScanResult(codes[0].rawValue);
      scheduleScan();
    }).catch(function () { if (generation === scanGeneration) scheduleScan(); });
  }

  function stopScanCamera() {
    scanGeneration++;
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
  }

  function closeScanSheet() {
    if (state.editorSaving) return;
    stopScanCamera();
    scanSheet.hidden = true;
    if (state.scanContext === "fill-field") itemSheet.hidden = false;
    if (state.scanContext === "fill-view-barcode") itemViewSheet.hidden = false;
  }

  function openScanSheet(context) {
    state.scanContext = context || "global";
    state.scanMode = "single";
    state.scanPaused = false;
    if (state.scanContext === "global") {
      state.multiScanEditor = null;
      state.scanSessionLog = [];
      state.scanLastHandledCode = null;
    }
    if (state.scanContext === "fill-field") itemSheet.hidden = true;
    if (state.scanContext === "fill-view-barcode") itemViewSheet.hidden = true;
    document.getElementById("scanResultWrap").hidden = true;
    document.getElementById("scanUnsupported").hidden = true;
    document.getElementById("scanCameraWrap").hidden = true;
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
    if (!btn || state.scanPaused || state.editorSaving) return;
    document.querySelectorAll("#scanModeSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s === btn); });
    state.scanMode = btn.dataset.mode;
  });

  function renderScanSessionLog() {
    var el = document.getElementById("scanSessionLog");
    if (!state.scanSessionLog.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = state.scanSessionLog.map(function (entry) {
      return '<li class="batch-row"><span class="batch-qty">' + escapeHtml(entry.name) + '</span>' +
        '<span class="batch-expiry">' + formatQty(entry.qty) + (entry.unit ? " " + escapeHtml(entry.unit) : "") + '</span></li>';
    }).join("");
  }

  function openMultiScanEditor(code) {
    var item = state.items.find(function (it) { return it.barcodes.indexOf(code) !== -1; });
    stopScanCamera();
    scanSheet.hidden = true;
    if (item) {
      state.multiScanEditor = "batch";
      openBatchSheet(null, "direct", item.id);
    } else {
      state.multiScanEditor = "item";
      openForm(null);
      state.formBarcodes = [code];
      renderFormBarcodes();
    }
  }

  function logMultiScan(item, qty) {
    if (!state.multiScanEditor) return;
    state.scanSessionLog.unshift({ name: item.name, qty: qty, unit: item.unit });
    renderScanSessionLog();
  }

  function resumeMultiScan(editor) {
    if (state.multiScanEditor !== editor) return;
    state.multiScanEditor = null;
    state.scanContext = "global";
    state.scanMode = "multi";
    state.scanLastHandledAt = Date.now();
    state.scanPaused = false;
    scanSheet.hidden = false;
    document.getElementById("scanModeSegmented").hidden = false;
    document.querySelectorAll("#scanModeSegmented .segment").forEach(function (s) { s.classList.toggle("is-active", s.dataset.mode === "multi"); });
    startScanCamera();
  }

  function handleScanResult(code) {
    if (state.scanContext === "fill-field") {
      stopScanCamera();
      if (state.formBarcodes.indexOf(code) === -1) state.formBarcodes.push(code);
      renderFormBarcodes();
      scanSheet.hidden = true;
      itemSheet.hidden = false;
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
      itemViewSheet.hidden = false;
      return;
    }

    if (state.scanMode === "multi") {
      var now = Date.now();
      if (code === state.scanLastHandledCode && (now - state.scanLastHandledAt) < 3000) {
        scheduleScan();
        return;
      }
      state.scanLastHandledCode = code;
      state.scanLastHandledAt = now;
      state.scanPaused = true;
      openMultiScanEditor(code);
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
    renderAppearanceControl();
    document.getElementById("syncStatusLine").textContent =
      "Last backup: " + relativeTime(state.settings.lastExportAt) + ". Last import: " + relativeTime(state.settings.lastImportAt) + ".";
    document.getElementById("deviceNameInput").value = state.settings.deviceName || "";
    var pageBuild = document.querySelector('meta[name="depot-build"]');
    document.getElementById("buildVersionLine").textContent = "Build " + APP_VERSION + " · Page " + (pageBuild ? pageBuild.content : "legacy (controls repaired)");
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
      items: state.items, history: state.history, categories: state.categories, locations: state.locations, units: state.units, settings: state.settings
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
    if (!state.items.length) return;
    if (!confirm("Delete every item in Depot? This wipes all " + state.items.length + " item(s).")) return;
    var snapshot = state.items.slice();
    state.items = [];
    saveItems();
    render();
    settingsSheet.hidden = true;
    showUndoToast("Deleted all " + snapshot.length + " item(s).", function () { state.items = snapshot; saveItems(); render(); });
  });

  // ---------- offline support ----------

  if ("serviceWorker" in navigator) {
    var appRegistration = null;
    var lastUpdateCheck = 0;
    var reloaded = false;
    var updateNotice = document.createElement("div"); updateNotice.id = "updateNotice"; updateNotice.hidden = true;
    updateNotice.setAttribute("role", "status");
    updateNotice.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:50;padding:14px;background:var(--ink);color:var(--paper);gap:12px;align-items:center";
    var updateText = document.createElement("span");
    updateText.textContent = "An app update is ready. Reload when you have finished editing. ";
    var reloadButton = document.createElement("button"); reloadButton.type = "button"; reloadButton.textContent = "Reload app";
    reloadButton.onclick = function () { window.location.reload(); };
    updateNotice.appendChild(updateText); updateNotice.appendChild(reloadButton); document.body.appendChild(updateNotice);

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloaded) return;
      reloaded = true;
      var activeSheet = Array.from(document.querySelectorAll(".sheet-backdrop")).some(function (sheet) {
        return !sheet.hidden && sheet.id !== "settingsSheet";
      });
      if (activeSheet) { updateNotice.hidden = false; return; }
      window.location.reload();
    });

    function checkForAppUpdate(force) {
      if (!appRegistration || (!force && Date.now() - lastUpdateCheck < 60000)) return Promise.resolve();
      lastUpdateCheck = Date.now();
      return appRegistration.update();
    }
    var updateButton = document.createElement("button"); updateButton.type = "button";
    updateButton.className = "btn-secondary"; updateButton.textContent = "Check for app update";
    var updateStatus = document.createElement("p"); updateStatus.id = "appUpdateStatus";
    updateStatus.className = "settings-desc"; updateStatus.setAttribute("role", "status");
    updateButton.onclick = function () {
      if (!appRegistration) { showAppError("Update check unavailable", new Error("Reopen the app online and try again.")); return; }
      updateButton.disabled = true;
      updateStatus.textContent = "Checking for an update…";
      checkForAppUpdate(true).then(function () {
        updateStatus.textContent = appRegistration.installing ? "Downloading the update…" : "Update check finished. Current build: " + APP_VERSION + ".";
      }).catch(function (err) { updateStatus.textContent = "Update check unavailable. Try again when online."; showAppError("Could not check for an update", err); })
        .finally(function () { updateButton.disabled = false; });
    };
    document.querySelector("#settingsSheet .settings-actions").appendChild(updateButton);
    document.querySelector("#settingsSheet .settings-actions").appendChild(updateStatus);
    function backgroundUpdate(force) {
      checkForAppUpdate(force).catch(function (err) { console.warn("Update check unavailable", err); });
    }
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
        appRegistration = reg;
        backgroundUpdate(true);
      }).catch(function (err) { console.warn("Service worker registration failed", err); });
    });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") backgroundUpdate(false); });
    window.addEventListener("online", function () { backgroundUpdate(true); });
  }

  // ---------- boot ----------

  function boot() {
    return migrateFromLocalStorage().then(function () {
      return Promise.all([idbGetAll("items"), idbGetAll("history"), idbGetAll("categories"), idbGetKV("settings", null), idbGetAll("locations"), idbGetAll("units")]);
    }).then(function (results) {
      state.items = results[0];
      state.history = results[1];
      var catsFromDb = results[2];
      state.categories = catsFromDb.length ? catsFromDb : defaultCategories();
      state.settings = results[3] || { soonDays: 30, urgentDays: 7, depletionThreshold: 0, deviceName: "", lastExportAt: null, lastImportAt: null };
      if (state.settings.deviceName === undefined) state.settings.deviceName = "";
      if (state.settings.lastExportAt === undefined) state.settings.lastExportAt = null;
      if (state.settings.lastImportAt === undefined) state.settings.lastImportAt = null;
      state.locations = results[4] || [];
      state.units = results[5] || [];

      var itemsChanged = migrateItems(state.items);
      var historyChanged = migrateHistory(state.history);
      var locChanged1 = migrateBatchLocations(state.items, state.locations);
      var locChanged2 = normalizeLocations(state.locations);

      var unitsChanged = normalizeItemUnits(state.items);
      if (itemsChanged || locChanged1 || unitsChanged) saveItems();
      if (historyChanged) saveHistory();
      if (!catsFromDb.length) saveCategories();
      if (locChanged1 || locChanged2) saveLocations();

      render();
    }).catch(function (err) {
      console.error("Depot failed to initialize storage", err);
      alert("Depot couldn't load its storage. Try reloading the app. If this keeps happening, export whatever backup you can and let me know.");
    });
  }

  boot();
})();
