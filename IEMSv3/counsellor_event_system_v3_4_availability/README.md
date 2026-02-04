# Event Submission System — v3.4.1 (Counsellor Accounts + Availability)

## Key feature
When Admin finalizes staffing, they see a live list of counsellor accounts with:
- **Available** (green) — no overlapping confirmed assignments
- **Busy** (red) — already assigned to a confirmed event overlapping the selected date range

Availability is dates-only (no times).

## Default logins
- Admin: admin / admin123
- Seeded counsellor: counsellor / counsellor123

## Run
```powershell
npm install
npm start
```
Open: http://localhost:3000


## v3.4.1 UI change
- Admin dashboard is now **vertical** (Event submissions first, then Counsellor accounts) to avoid side-by-side layout.


## v3.5 changes
- Light theme (white background) for readability
- Counsellor can suggest staffing from available counsellors (checkbox list)
- Admin can re-open and edit staffing even after confirmation (existing assignments are pre-selected)


## v3.5.1 changes
- Counsellor proposed staffing is now **one-click**: loads all available counsellors for the selected date range.
- All displayed dates use the format: **29 January 2026**.


## v3.5.2 changes
- Counsellor suggested staffing now opens a popup showing *available* counsellors to tick.
- Suggestions are stored and shown to Admin in a separate SUGGESTED column.
