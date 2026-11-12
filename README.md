# Attahar EMS
Link:https://script.google.com/macros/s/AKfycbx9dQjU0DUILB5l-9X44QTtejueBFczCgzSoJPYVXMb0uFMyPI5yYjiXPbEdcQjon_yjQ/exec
Android version:I have added the EMS.apk file in code.

**Employee Management Portal** built on Google Apps Script and Google Sheets. Employees mark attendance with a selfie and GPS location and manage their leave. Admins approve attendance, handle leave, run payslips and control every company rule from a Settings page, with no code changes.

> Mobile-first web app. It also runs inside an Android WebView wrapper.

---

## Live demo / demo logins

Open the deployed Web App URL and use the tabs on the login page.

| Side | ID | Password |
|------|----|----------|
| Employee | `testuser1byatf@gmail.com` | `password123` |
| Admin | `testuser2byatf@gmail.com` | `password123` |

The login page shows these credentials in a box under the form, with a **Fill these in** button.

> **Warning:** these are public demo accounts with dummy data. Make the demo admin an `ADMIN` role (not `OWNER`). Remove the demo box and change the passwords before putting real employee data in the system.

---

## Features

### Employee portal
- **Dashboard** with three views: Attendance, Leave and Calendar
- **Punch in / punch out** with a live front-camera selfie and GPS location
  - Distance from the office is checked on the server
  - Punches outside the allowed radius, without location, or with weak GPS are saved and flagged for Admin review
  - Punch-in-only mode for staff such as field workers
- **Attendance calendar** with day details, selfies and map view
- **Leave**: Casual (CL), Sick (SL) and Other leave
  - Live balance and notice-period check before submitting
  - Medical certificate upload for long sick leave (PDF/JPG/PNG)
  - Leave details by month, with lapsed and expired leave shown
  - Cancel pending applications
- **Public holidays** list
- **Wages tracker** and **monthly payslips** (view, print, PDF), when Admin gives access
- **Salary Payments** screen for the designated accountant (mark salaries as paid)
- Leave policy pop-up that must be accepted

### Admin portal
- **Dashboard**: Attendance and Leave side by side, a running "on leave today" banner, a pending-items badge and a leave report with charts
- **Attendance**: daily list, pending approval, flagged punches, monthly register (table and calendar view, CSV export), month finalize and reopen, mark attendance, set a forgotten punch time
- **Leave applications**: approve, reject, edit and cancel approved leave, with overrides logged
- **Manual leave entry** for historical entries and short-notice leave
- **Balances and ledger** with balance adjustments and print
- **Unauthorized leave register** with suggested penalties from policy
- **Employees**: directory, full employee profile, add/edit, Bin with restore and permanent delete
- **Payslips**: calculated live from attendance, with penalty toggle, print and PDF
- **Diwali bonus**: eligibility from lapsed CL, bonus rules, Done/Undo flow into payslips
- **Public holidays**, **Administrators**, **System log** and **Change password**
- **Settings**: every company rule in one place, plus company logo upload

### Platform
- Role-based access: Owner, Admin and Employee
- Password login with session timeouts, lockout after failed attempts, and emailed one-time codes for first sign-in and reset
- Append-only system log of every important action
- Sheet-level cache for speed, with automatic invalidation on writes
- Email notifications for new leave requests and decisions, plus a daily pending-requests reminder

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Google Apps Script (`Code.gs` and related `.gs` modules) |
| Database | Google Sheets |
| File storage | Google Drive (selfies, medical certificates) |
| Frontend | Single-page `Index.html` (vanilla JS and CSS, no framework) |
| Mail | `MailApp` |
| Caching and locking | `CacheService`, `LockService`, `PropertiesService` |

All browser calls go through three gateway functions (`apiPublic`, `apiEmployee`, `apiAdmin`) that expose only whitelisted actions.

---

## Sheets created by setup

`EMPLOYEE MASTER`, `EMPLOYEE DETAILS`, `LEAVE APPLICATIONS`, `LEAVE LEDGER`, `DIWALI BONUS`, `UNAUTHORIZED LEAVE`, `PUBLIC HOLIDAYS`, `ADMINS`, `SETTINGS`, `SYSTEM LOG`, `ATTENDANCE`

The sheets are protected so that only the web app writes to them.

---

## Setup

1. **Create a Google Sheet** and open **Extensions > Apps Script**.
2. **Add the project files** to the script project: `Code.gs`, the other `.gs` modules, and `Index.html` (plus any other HTML files the project includes).
3. Set the project **time zone to `Asia/Kolkata`** (Project Settings).
4. Run **`setupSystem()`** once, from the script editor or the sheet menu **Leave Management > 1. Initial setup**. It creates the sheets, default settings, the Owner admin, the Drive folder and the triggers, and protects the sheets.
5. **Deploy** as a Web App: **Deploy > New deployment > Web app**. Execute as *Me*, and set access to whoever should reach it.
6. **Get your first login code**: run `quickAdminCode()` in the editor and read the code in the Execution log. On the login page choose the **Admin** tab, tap **Forgot password? / First-time sign in**, enter the code and set a password.
7. Sign in and open **Settings** to set the company name, office latitude/longitude and radius, leave policy, notice rules, notifications and everything else.

### Creating the demo accounts
1. Add `testuser1byatf@gmail.com` to **EMPLOYEE MASTER** with Status `Active`.
2. Add `testuser2byatf@gmail.com` to **ADMINS** with Role `ADMIN` and Status `Active`.
3. For each, use **Forgot password? / First-time sign in** with a code and set the password to `password123`.

---

## Key settings (Settings page)

| Group | Examples |
|-------|----------|
| General | Company name, system on/off |
| Admin Access | Session minutes, max login attempts, lockout, password length |
| Leave Policy | CL/SL monthly credit and annual max, carry-forward, medical proof threshold, duration mode |
| Notice Rules | Notice hours per leave type, short-notice block, admin override |
| Attendance | Office location and radius, weekly off, approval mode (all / flagged only / auto by hours) |
| Payslip | Day basis (30 or actual month days), include bonus and penalty |
| Diwali Bonus | Cutoff date, payment date, bonus rules |
| Penalty | Salary days and amount for 1st, 2nd and 3rd unauthorized leave |
| Notifications | Admin emails, instant alerts, daily reminder hour |

---

## Owner-only actions

Some actions are limited to the Owner admin: Admin Access settings, adding or editing administrators, payslip and Diwali bonus visibility, employee payslip access, the accountant selection, deleting employees, finalizing and reopening attendance months, and company logo changes.

---

## Security notes

- Passwords are stored hashed, never in plain text.
- Employee login mode can require an emailed 6-digit code on every sign in (recommended, since attendance uses selfie and location).
- Selfies are compressed small and stored in a private Drive folder.
- The system only records penalties. It never deducts salary or terminates anyone automatically.
- The "Remember my login info" option stores credentials in the browser's local storage. Use it only on personal devices.

---

## Project structure

```
.
├── Code.gs          # Settings, sheet helpers, cache, API gateway, setup, triggers
├── *.gs             # Feature modules (auth, leave, attendance, payslip, bonus, logo, etc.)
├── Index.html       # Whole frontend (UI, styles, client logic)
└── README.md
```

---

## Author

**Attahar Faizan** - [@attahar6969](https://github.com/attahar6969)

---

## License

Add a license of your choice (for example MIT) before making the repository public.
