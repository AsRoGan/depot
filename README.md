# Depot

An offline-first inventory tracker for food, medical supplies, and devices.
Everything is stored on-device (browser localStorage) — there's no server
and no network calls, so it works exactly the same with wifi off.

## 1. Try it right now (no install needed)

Just open `www/index.html` directly in a browser. Everything works —
add items, filter, search, export/import — except the offline
service worker, which browsers only activate over `http(s)://`, not
`file://`.

## 2. Run it as a proper local website (activates offline caching)

From the `depot` folder:

```bash
cd www
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser. Now the service worker
will register, and if you go into airplane mode and reload, it still
loads instantly from cache. This is also exactly what you'd copy onto
a Raspberry Pi — just serve the `www` folder with any lightweight
static server (`python3 -m http.server`, `busybox httpd`, `nginx`, etc.)
and open it in a browser on that device.

## 3. Wrap it as an Android APK (Capacitor)

You'll need Node.js and Android Studio installed for this part — I can't
run these commands myself since I don't have network access in this
environment, but each step below is copy-paste ready.

```bash
cd depot
npm install
npx cap add android
npx cap sync android
npx cap open android
```

That last command opens the project in Android Studio. From there:

1. Let Gradle finish syncing (first time takes a few minutes).
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Android Studio will generate an unsigned debug APK automatically —
   fine for testing on your own device via USB debugging.
4. For a version you'll keep reinstalling over time (so your data and
   app updates survive), generate a proper keystore once via
   **Build → Generate Signed Bundle / APK**, and keep that keystore
   file somewhere safe — you'll reuse it for every future build of
   this app.
5. To install without the Play Store, either run `npx cap run android`
   with your phone connected via USB debugging, or copy the built
   `.apk` file to your phone and open it (you'll need to allow
   "install unknown apps" for whichever app you use to open it).

### Before your first real build

- **App icon**: `manifest.json` currently has an empty `icons` array.
  Capacitor will use a placeholder icon until you drop your own into
  `android/app/src/main/res/` (Android Studio's Image Asset Studio,
  right-click `res` → New → Image Asset, makes this easy).
- Re-run `npx cap sync android` any time you change files in `www/`
  before rebuilding, so Android picks up the changes.

## Categories

Food / Medical / Devices / Other are no longer fixed — they're your
starting point. Add, rename, or delete top-level categories from
**Settings → Manage categories**, and give each one any number of
subcategories underneath it (e.g. Food → Tinned, Dried, Water). The
item form and the main filter bar both follow this two-level
structure. Deleting a category doesn't delete its items — they fall
back to "Uncategorized" instead.

## Use by / Best before

Each expiry date carries a flag: **Use by** (a safety cut-off — shows
red once inside 7 days) or **Best before** (a quality guide only — never
shows red, just the softer "soon" colour, since it's still fine to use).
"Expiring soon only" catches both kinds the same way, within 30 days.

## Fractional quantities

Quantities support up to 2 decimal places — useful for a "1 pack" item
where you consume it in fractions (e.g. withdraw 0.25 of a pack of
biscuits). Everything (batch quantities, withdrawals, totals, the
depletion threshold) accepts and displays decimals; trailing zeros are
trimmed for display (1.50 shows as "1.5", 1.00 shows as "1").

## Batches

Each item can hold multiple batches — separate quantity + expiry date
pairs, so "Tinned Tuna" can have 3 units expiring in March, 5 in June,
and 15 with no date at all, all under one item. The main list shows
the combined total, but the expiry badge always reflects whichever
batch is most at risk, with that batch's quantity shown alongside it
(e.g. "In 5d (3)") — so you can see what needs attention without
opening the item.

Items are never deleted automatically. Withdrawing stock (see below)
draws from the soonest-expiring batch first and removes a batch once
it hits zero, but the item itself stays — even at zero total — so it
doesn't get forgotten when it's time to restock.

## Depleted filter

Toggle **Depleted only** to see every item at or below your depletion
threshold (0 by default, meaning fully out) — useful for a restock
list precisely because depleted items are retained rather than
deleted.

## Thresholds

**Settings → Adjust thresholds** controls, app-wide: the "expiring
soon" window (default 30 days), the "urgent" window inside that
(default 7 days, only affects Use By dates — Best Before never goes
red), and the depletion threshold used by the Depleted filter.

## Use by / Best before

Each batch's expiry date carries a flag: **Use by** (a safety cut-off
— turns red once inside the urgent window) or **Best before** (a
quality guide only — never red, just the softer "soon" colour, since
it's still fine to use). "Expiring soon only" catches both kinds the
same way.

## Withdrawal history

**Settings → View withdrawal history** now has a search box (matches
item name, reason, category name, and the displayed date) and a
category filter, the same "Uncategorized" bucket applies here as
everywhere else if a withdrawal's original category was later deleted.

## Importing backups

Choosing a backup file no longer merges immediately — it opens an
**Import backup** screen showing how many items and withdrawal
records are in the file versus what's already on your device, with
independent Merge/Replace choices for items and for history. Merge
adds only records with an id you don't already have (matched by
each record's internal id, not its content), so re-importing the
same backup, or importing after only wiping items, can't create
duplicates in either list.

Open an existing item and tap **Withdraw** to take some of it out of
stock — enter how much, and optionally why (used in dinner, expired,
broke, gave away). The amount is deducted from the soonest-expiring
batch(es) first; any batch that reaches zero is removed, but the item
itself is retained regardless of its resulting total. Every withdrawal
is recorded in **Settings → View withdrawal history**, including for
items that are now fully depleted.

## Data model

Items are stored as a flat JSON array in `localStorage` under the key
`depot.items.v1`. Each item:

```json
{
  "id": "string",
  "name": "string",
  "categoryId": "string or null",
  "subcategoryId": "string or null",
  "unit": "string",
  "batches": [
    {
      "id": "string",
      "quantity": 0,
      "expiry": "YYYY-MM-DD or null",
      "expiryType": "use_by | best_before | null"
    }
  ],
  "location": "string",
  "notes": "string",
  "updatedAt": "ISO timestamp"
}
```

Categories are stored under `depot.categories.v1`:

```json
{
  "id": "string",
  "name": "string",
  "color": "#hex",
  "subcategories": [{ "id": "string", "name": "string" }]
}
```

Thresholds are stored under `depot.settings.v1`:

```json
{ "soonDays": 30, "urgentDays": 7, "depletionThreshold": 0 }
```

Withdrawals are stored separately (so they outlive a deleted item)
as a flat JSON array under `depot.history.v1`, newest first:

```json
{
  "id": "string",
  "itemId": "string",
  "name": "string",
  "categoryId": "string or null",
  "unit": "string",
  "amount": 0,
  "reason": "string",
  "remainingAfter": 0,
  "date": "ISO timestamp"
}
```

Use **Settings → Export backup** regularly — since this is local-only
storage, uninstalling the app or clearing browser data deletes it.
The exported file contains `items`, `history`, `categories`, and
`settings`; older backups still import fine.

## Pass 2 changes (storage engine, open shelf life, batch-level location)

- **Storage moved from localStorage to IndexedDB.** Existing data migrates automatically and non-destructively on first load — old localStorage keys are left in place untouched as a safety net, they're just no longer read after migration. This removes the ~5-10MB ceiling localStorage had and gives room for photos or larger datasets later without another migration.
- **Location moved from the item to each batch.** A single item can now have stock in multiple places at once; the main list shows the distinct set of locations across its batches.
- **Reorder threshold** (per item) and **Open Shelf Life** (days, per item) plus **Open Date** (per batch) are new fields. Reorder threshold will feed the shopping list in a later pass. Open Shelf Life + Open Date let a batch's *actual* risk be "opened 3 days ago, good for 5" rather than only a printed date — whichever limit is sooner is what's shown and used everywhere (sorting, filters, FIFO withdrawal).
- **Barcode** field added to items (manual entry for now) — camera scanning comes in a later pass; this just avoids another schema migration when it lands.
- **Location autocomplete** on the batch location field, suggesting from locations you've already used, to avoid near-duplicate strings ("Garage Shelf 2" vs "garage shelf 2") fragmenting things later.
- **Main list rows restructured** into two lines (name + category on top, quantity + expiry below) so a long expiry/quantity string never squeezes the item name.
- **Orientation lock removed** — landscape now works.

Still to come in later passes: location filter chips, shopping list generation (using reorder threshold + depleted + near-expiry), Web Share for the shopping list, CSV export, the location audit/stocktake workflow, and camera-based barcode scanning.

## Location check (audit)

**Settings → Location check** — pick a location, and every batch currently
recorded there shows as a tickable checklist that stays on screen the whole
time (no per-item popups breaking your flow). Tick off what you physically
find; anything left unticked gets a **Remove** or **Move** button right in
the same list. "Add batch here" logs something you found that wasn't
expected — type an existing item's name and it opens straight to adding a
batch with this location pre-filled, auto-marked as found.

## Location filter

A location chip row (mirroring the category chips) appears on the main list
whenever any batch has a location set — filters to items with at least one
batch there.

## Shopping list

**Settings → Generate shopping list** — choose which criteria count (depleted,
at/below reorder threshold, expiring soon), generate, and the results group
by category with the reason each item was included. **Copy** puts a plain-text
version on the clipboard; **Share** uses the device's native share sheet
(texting it, emailing it, dropping it in a notes app) where supported, and
falls back to clipboard copy elsewhere.

## Barcode scanning

Tap the camera icon in the top bar to scan. Uses Chrome's built-in
`BarcodeDetector` — no external library, fully offline, Android/Chrome only
(not supported in Safari). On a match it offers **Add batch** or **Withdraw**
for that item; on no match, **Create new item** (barcode pre-filled) or
**Attach to existing item**. The camera icon next to the Barcode field in the
item form scans straight into that field instead, for when you're just
tagging an item you're already editing.

## Multiple barcodes per item

`barcode` (single value) is now `barcodes` (a list) — old data migrates
automatically. Add several to the same item from the item form, or via
Attach to existing item during a scan, so different brands/packagings of
"the same thing" can share one entry.

## Clearing withdrawal history

In the history sheet: **Clear shown** removes whatever the current
search/category filter has narrowed to (search an item's name first to
clear just its records), **Clear all** wipes the whole log, and each row
now has its own delete button for one-off corrections.

## Export/Import improvements for household use

- **Device name** (Settings) is embedded in backups you export and used in
  the filename, so a shared folder of backups from multiple phones stays
  distinguishable, and imports show whose backup it is and how old it is.
- **True merge for items**: when the same item exists on both sides, the
  one with the more recent edit timestamp wins — an edit from another
  device is no longer silently dropped just because you already had that
  item. Withdrawal history stays purely additive (a past withdrawal is a
  fact, not something to reconcile). This is item-level, not batch-level —
  if both sides edited the same item differently since the last sync, one
  side's edit still wins wholesale rather than merging field-by-field.
- **Categories merge subcategories too**, not just whole categories.
- **Settings only come along on a full Replace**, never on Merge — your
  thresholds aren't silently overwritten by someone else's backup — and
  your device name is never overwritten by an import either way.
- **Settings shows last backup / last import times** so it's obvious when
  a sync is overdue.

This remains manual (export → send the file → import), not live sync —
see the conversation history for why live P2P sync was considered and
deliberately set aside for now.

## Edit barcodes from the view sheet

The view sheet now has its own Barcodes list (add, remove, or scan-to-add)
right alongside the batches — no need to open full Edit just to fix a
mis-scanned or reassigned barcode.

## Multi-scan mode

The scan sheet now has a Single scan / Scan multiple toggle. In multi mode
the camera never stops between scans: each detected barcode pauses
detection and shows a quick inline form (quantity, optional location,
and a name field if it's an unrecognized barcode) with **Add & keep
scanning** or **Skip**. A running log below shows everything added this
session so you don't lose track partway through. Location remembers the
last one you typed, since a scanning session is usually one shelf at a
time. The same barcode won't re-trigger the overlay for 3 seconds, so
holding the camera steady on one item doesn't spam repeat prompts.

## Undo

Deleting an item, a category, or clearing withdrawal history now shows a
6-second "Undo" toast instead of (or alongside) a confirmation dialog.
Design choice: for single-item and single-record deletes, the confirm
dialog is gone entirely — delete-then-undo is faster day-to-day than
confirm-then-delete, and the undo window covers the mis-tap case just as
well. "Delete all items" keeps its confirm dialog too, on top of undo,
since wiping the whole inventory is a different order of consequence
than removing one thing.

## Locations are now records (not free text)

Every batch's Location field now points at a real Location record instead
of storing a plain string. Typing a name still works exactly as before —
type it, and a matching record is found or created automatically. This
unlocks:

- **Manage locations** (Settings): rename or delete a location; renaming
  updates every batch that points at it in one go.
- **Location photos**: each location can hold a hero photo plus extras
  (useful for large or awkward spaces). Managed from the Location Audit
  screen, since that's the moment you're physically there with a phone
  out. "Update photos" replaces the whole set at once — it does not
  append to what's there, so a stale photo never lingers.

## Item photos

Each item can hold multiple photos: front of pack, back label, a
manual page, whatever's useful. One is marked the "hero" photo (★) and
shows first in a swipeable gallery in the item's View screen; add or
remove photos there too. Photos are captured or picked via the browser's
own file/camera chooser — no capture-only restriction, so a gallery photo
or an existing scan works just as well as a fresh shot.

Photos are compressed on the way in (resized + re-encoded as JPEG) to
keep storage reasonable, and are stored locally in the browser's
IndexedDB — **they are not included in JSON export/import**. A backup
restores all your items, batches, categories, and locations, but not
photos; those live only on the device that took them.

## Undo

Deleting an item, a category, a location, or clearing withdrawal history
now shows a 6-second "Undo" toast instead of (or alongside) a
confirmation dialog. Single-item and single-record deletes drop the
confirm dialog entirely in favour of delete-then-undo. "Delete all
items" keeps its confirm dialog on top of undo, since wiping the whole
inventory is a different order of consequence than removing one thing.
