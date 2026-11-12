/**
*Code.gs
*/


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


const SH = {
 EMP: 'EMPLOYEE MASTER',
 EMD: 'EMPLOYEE DETAILS',
 APP: 'LEAVE APPLICATIONS',
 LED: 'LEAVE LEDGER',
 BON: 'DIWALI BONUS',
 UNA: 'UNAUTHORIZED LEAVE',
 HOL: 'PUBLIC HOLIDAYS',
 ADM: 'ADMINS',
 SET: 'SETTINGS',
 LOG: 'SYSTEM LOG',
 ATT: 'ATTENDANCE'
};
const SHEET_ORDER = ['EMP', 'EMD', 'APP', 'LED', 'BON', 'UNA', 'HOL', 'ADM', 'SET', 'LOG', 'ATT'];


const COLS = {
 EMP: ['Employee ID', 'Employee Name', 'Email', 'Phone', 'Department', 'Designation', 'Joining Date', 'Status',
   'CL Balance', 'SL Balance', 'Created At', 'Updated At', 'Allowed Leaves',
   'Deleted At', 'Deleted By', 'Prev Status', 'Source Sync', 'Punch In Only'],
   EMD: ['Employee ID', 'Full Name', 'Father/Spouse', 'DOB', 'Gender', 'Mobile', 'Email', 'Address', 'Aadhaar', 'PAN', 'EC Name', 'EC Phone',
   'Bank Name', 'Account No', 'IFSC', 'Branch',
   'Designation', 'Department', 'Manager', 'Joining Date', 'Emp Type', 'Probation', 'Contract End Date', 'Place of Work', 'Work Hours', 'Weekly Off', 'Notice Period',
   'Gross Salary', 'Pay Date', 'Pay Mode', 'Bonus',
   'Assets Issued', 'Agreement Date', 'Signatory',
   'Agreement ID', 'Review Date', 'Status', 'Doc Link', 'Updated'],
 ADM: ['Admin ID', 'Admin Name', 'Email', 'Phone', 'Role', 'Status', 'Created At', 'Updated At'],
 APP: ['Application ID', 'Submission Timestamp', 'Employee ID', 'Employee Name', 'Employee Email', 'Leave Type',
   'Duration Type', 'From Date', 'To Date', 'Duration', 'Reason', 'Medical Document ID', 'Medical Document URL',
   'Status', 'Admin Remarks', 'Reviewed By', 'Reviewed At', 'Notice Override', 'Override Reason', 'Created At',
   'Updated At', 'Entry Source', 'Request Key', 'Admin Notified', 'Employee Notified'],
 LED: ['Transaction ID', 'Employee ID', 'Leave Year', 'Month', 'Leave Type', 'Transaction Type', 'Credit', 'Debit',
   'Opening Balance', 'Closing Balance', 'Related Application ID', 'Remarks', 'Created At', 'Created By'],
 BON: ['Bonus Year', 'Employee ID', 'Employee Name', 'CL Lapsed Before Cutoff', 'Eligible CL Count', 'Cutoff Date',
   'Payment Date', 'Bonus Amount', 'Status', 'Remarks', 'Updated By', 'Updated At'],
 UNA: ['Incident ID', 'Employee ID', 'Employee Name', 'Incident Date', 'From Date', 'To Date', 'Duration',
   'Occurrence Number', 'Salary Deduction', 'Additional Penalty', 'Admin Remarks', 'Action Taken', 'Recorded By',
   'Created At', 'Updated At'],
 HOL: ['Holiday Date', 'Holiday Name', 'Year', 'Status', 'Notes'],
 SET: ['Group', 'Key', 'Value', 'Description'],
 LOG: ['Log ID', 'Timestamp', 'User Email', 'User Role', 'Action', 'Module', 'Record ID', 'Old Value', 'New Value',
   'Remarks', 'Result'],
 ATT: ['Attendance ID', 'Employee ID', 'Employee Name', 'Date', 'Punch In Time', 'In Lat', 'In Lng', 'In Accuracy',
   'In Distance (m)', 'In Photo File ID', 'In Photo URL', 'In Flag', 'Punch Out Time', 'Out Lat', 'Out Lng', 'Out Accuracy',
   'Out Distance (m)', 'Out Photo File ID', 'Out Photo URL', 'Out Flag', 'Status', 'Created At', 'Updated At',
   'In Request Key', 'Out Request Key',
   'Review Status', 'Reviewed By', 'Reviewed At', 'Review Remarks', 'Marked By', 'Mark Reason', 'Marked At',
   'Approval Status', 'Approved By', 'Approved At', 'Approval Remarks']
};


const DATE_COLS = {
 EMP: ['Joining Date'], APP: ['From Date', 'To Date'], BON: ['Cutoff Date', 'Payment Date'],
 UNA: ['Incident Date', 'From Date', 'To Date'], HOL: ['Holiday Date'], ATT: ['Date']
};
const DATETIME_COLS = {
 EMP: ['Created At', 'Updated At', 'Deleted At'], ADM: ['Created At', 'Updated At'],
 APP: ['Submission Timestamp', 'Reviewed At', 'Created At', 'Updated At'], LED: ['Created At'],
 BON: ['Updated At'], UNA: ['Created At', 'Updated At'], LOG: ['Timestamp'],
 ATT: ['Punch In Time', 'Punch Out Time', 'Created At', 'Updated At', 'Reviewed At', 'Marked At', 'Approved At']
};
const TEXT_COLS = { EMP: ['Phone'], ADM: ['Phone'], SET: ['Value'], EMD: ['Mobile', 'EC Phone', 'Aadhaar', 'Account No'] };


/* ------------------------------------------------------------------ */
/*  ERRORS / GLOBAL CACHES                                             */
/* ------------------------------------------------------------------ */
class UserError extends Error {
 constructor(msg, code) { super(msg); this.name = 'UserError'; this.code = code || 'ERR'; }
}
function fail_(msg, code) { throw new UserError(msg, code); }


let _SS = null;
let _SETTINGS = null;


/* ------------------------------------------------------------------ */
/*  SETTINGS  (edited from the Admin Portal > Settings page)           */
/*  [group, key, default, type, description]                           */
/* ------------------------------------------------------------------ */
function defaultSettings_() {
 const yr = String(new Date().getFullYear());
 return [
   ['General', 'COMPANY_NAME', 'My Company', 'text', 'Company name shown on the login page, the top bar, the browser tab and in emails.'],
   ['General', 'SYSTEM_ACTIVE', 'TRUE', 'bool', 'No = the Employee Portal is closed for everyone (Admin still works). Use only for maintenance.'],
   ['General', 'TIMEZONE', 'Asia/Kolkata', 'readonly', 'Fixed. Also set the Apps Script project time zone to Asia/Kolkata.'],
   ['General', 'DATE_FORMAT', 'DD/MM/YYYY', 'readonly', 'Fixed display format.'],
   ['General', 'LEAVE_YEAR', 'Calendar Year (January to December)', 'readonly', 'Fixed leave year.'],
   ['General', 'WEB_APP_URL', '', 'text', 'Web app link used inside emails. Leave blank to auto-detect.'],
   ['Admin Access', 'ADMIN_SESSION_MINUTES', '30', 'number', 'An Admin is signed out after this many idle minutes.'],
   ['Admin Access', 'EMPLOYEE_SESSION_MINUTES', '60', 'number', 'An employee is signed out after this many idle minutes.'],
   ['Admin Access', 'MAX_LOGIN_ATTEMPTS', '5', 'number', 'Wrong sign-in attempts allowed before the account is locked for a while.'],
   ['Admin Access', 'LOCKOUT_MINUTES', '15', 'number', 'How long the lock lasts after too many wrong attempts.'],
   ['Admin Access', 'OTP_VALID_MINUTES', '10', 'number', 'How long an emailed setup code stays valid, in minutes (used by "Email me a code").'],
   ['Admin Access', 'OTP_MAX_ATTEMPTS', '5', 'number', 'Wrong code entries allowed before that code is cancelled and a new one is needed.'],
   ['Admin Access', 'PASSWORD_MIN_LENGTH', '8', 'number', 'Minimum password length for Admins and Employees (letters and numbers required).'],
   ['Admin Access', 'EMPLOYEE_LOGIN_MODE', 'EMAIL_OTP', 'select:IDENTIFIER|EMAIL_OTP',
     'How employees sign in. IDENTIFIER = registered email or mobile only, no code (quick, but anyone who knows the number could punch attendance as that employee). EMAIL_OTP = a 6-digit code is emailed at every sign-in (recommended because attendance uses selfie and location).'],   
    
     ['Admin Access', 'RESET_SELF_SERVICE', 'ALL', 'select:ALL|EMPLOYEE_ONLY|OFF', 'Who can use "Email me a code" on the sign-in page. ALL = Admins and Employees. EMPLOYEE_ONLY = Admin accounts must get a code from the Owner. OFF = nobody; codes come only from Admin.'],
   ['Leave Policy', 'CL_MONTHLY_CREDIT', '1', 'number', 'Casual Leave (CL) credited to each employee every month.'],
   ['Leave Policy', 'SL_MONTHLY_CREDIT', '1', 'number', 'Sick Leave (SL) credited to each employee every month.'],
   ['Leave Policy', 'CL_ANNUAL_MAX', '12', 'number', 'Maximum CL credited in one calendar year.'],
   ['Leave Policy', 'SL_ANNUAL_MAX', '12', 'number', 'Maximum SL credited in one calendar year.'],
   ['Leave Policy', 'CL_CARRY_FORWARD', 'FALSE', 'bool', 'No = unused CL lapses at the end of each month (current policy; the lapsed CL decides the Diwali bonus). Yes = unused CL carries forward within the year.'],
   ['Leave Policy', 'SL_CARRY_FORWARD', 'TRUE', 'bool', 'Yes = unused SL carries forward month to month and expires on 31 December (current policy). No = unused SL lapses at month end.'],
   ['Leave Policy', 'MEDICAL_PROOF_THRESHOLD_DAYS', '2', 'number', 'Sick Leave longer than this many days needs a medical certificate (PDF, JPG or PNG) with the application.'],
   ['Leave Policy', 'MAX_UPLOAD_MB', '10', 'number', 'Maximum size (MB) of a medical certificate upload.'],
   ['Leave Policy', 'DURATION_MODE', 'CALENDAR', 'select:CALENDAR|WORKING', 'CALENDAR = every date between From and To counts as leave. WORKING = weekly-off days (and holidays, if enabled below) are skipped.'],
   ['Leave Policy', 'WEEKLY_OFF_DAYS', '0', 'text', 'Only for WORKING duration mode. Day numbers, comma separated (0 = Sunday ... 6 = Saturday). Attendance and payslips use the separate Weekly Off setting under Attendance.'],
   ['Leave Policy', 'EXCLUDE_HOLIDAYS_FROM_DURATION', 'FALSE', 'bool', 'Only for WORKING duration mode. Yes = active public holidays do not count as leave days.'],
   ['Leave Policy', 'OTHER_LEAVE_TREATMENT', 'Unpaid', 'select:Paid|Unpaid', 'How Other Leave counts for salary. Unpaid = the day is a loss-of-pay day on the payslip. Paid = no deduction.'],
   ['Leave Policy', 'ADMIN_NEGATIVE_OVERRIDE', 'TRUE', 'bool', 'Yes = Admin may approve or enter leave beyond the balance (or without a medical certificate) using the Override option, with a mandatory reason.'],
   ['Leave Policy', 'MAX_BACKDATE_DAYS', '7', 'number', 'Employees cannot apply for leave dated more than this many days in the past (Sick Leave).'],
   ['Leave Policy', 'LEAVE_START_TIME', '09:00', 'time', 'Time the leave day starts. Used to calculate the notice period. Format HH:mm.'],
   ['Leave Policy', 'PUBLIC_HOLIDAY_ALLOWANCE', '8', 'number', 'Public holidays allowed per year. Shown on the Public Holidays pages.'],
   ['Leave Policy', 'PUBLIC_HOLIDAY_TREATMENT', 'Kept separate. Not deducted from CL or SL.', 'text', 'Policy note shown on the Public Holidays pages (information only). Active holidays count as Paid holiday in attendance and payslips.'],
   ['Notice Rules', 'CL_NOTICE_HOURS', '24', 'number', 'Casual Leave needs at least this many hours of advance notice.'],
   ['Notice Rules', 'OTHER_NOTICE_HOURS', '24', 'number', 'Other Leave needs at least this many hours of advance notice.'],
   ['Notice Rules', 'SL_NOTICE_HOURS', '0', 'number', 'Sick Leave advance notice in hours (0 = no notice needed).'],
   ['Notice Rules', 'SHORT_NOTICE_BLOCK', 'TRUE', 'bool', 'Yes = employees cannot submit leave inside the notice period; they must contact Admin. No = they can submit and Admin decides.'],
   ['Notice Rules', 'ADMIN_NOTICE_OVERRIDE', 'TRUE', 'bool', 'Yes = Admin may enter or approve leave inside the notice period from Manual Leave Entry or the application, with a mandatory reason.'],
   ['Notice Rules', 'ADDITIONAL_NOTICE_ENABLED', 'FALSE', 'bool', 'Company form wording: 1-2 days notice for short leave, 1 week for long leave. Off until the company finalises it. When Yes, the stricter rule wins over the hours rule above.'],
   ['Notice Rules', 'ADDITIONAL_NOTICE_APPLIES_TO', 'CL,OTHER', 'text', 'Leave types the additional notice rule applies to (CL, SL, OTHER), comma separated.'],
   ['Notice Rules', 'SHORT_LEAVE_NOTICE_DAYS', '2', 'number', 'Additional rule: notice days for shorter leave.'],
   ['Notice Rules', 'LONG_LEAVE_NOTICE_DAYS', '7', 'number', 'Additional rule: notice days for longer leave.'],
   ['Notice Rules', 'LONG_LEAVE_MIN_DAYS', '3', 'number', 'Additional rule: leave of this many days or more counts as longer leave.'],
   ['Diwali Bonus', 'BONUS_YEAR', yr, 'number', 'Year whose bonus is being processed. The Diwali Bonus page can also change it.'],
   ['Diwali Bonus', 'BONUS_CUTOFF_DATE', '', 'date', 'Only CL that actually lapsed on or before this date counts towards the bonus. Set it once the Diwali date is known.'],
   ['Diwali Bonus', 'BONUS_PAYMENT_DATE', '', 'date', 'Expected payment date. Done bonuses appear on the payslip of the month this date falls in.'],
   ['Diwali Bonus', 'BONUS_ACTIVE_RULE', 'R-MANUAL', 'hidden', 'Rule in use (managed from the Bonus rules list).'],
   ['Diwali Bonus', 'BONUS_RULES', '[{"id":"R-MANUAL","name":"Manual","type":"MANUAL","value":0},{"id":"R-PCT","name":"Percent of salary","type":"PCT_SALARY","value":0},{"id":"R-DAYS","name":"Salary days per CL","type":"SALARY_DAYS_PER_CL","value":0}]', 'hidden', 'Bonus rules (managed from the Bonus rules list).'],
   ['Payslip', 'PAYSLIP_ADMIN_VIEW', 'FALSE', 'bool', 'Yes = normal Admins can see Payslips. No = only the Owner can. Only the Owner can change this.'],
   ['Payslip', 'PAYSLIP_EMP_ACCESS', '', 'hidden', 'Employees who may see their own payslip (managed from Payslips > Employee payslip access).'],
   ['Payslip', 'PAYSLIP_ACCOUNTANT', '', 'hidden', 'Employee who marks salaries as paid (managed from Payslips > Accountant).'],
   ['Payslip', 'PAYSLIP_DAY_BASIS', '30', 'select:30|MONTH_DAYS', 'Payslips are calculated live from Attendance. 30 = one day of pay is salary / 30 every month. MONTH_DAYS = salary / actual days in that month.'],
   ['Payslip', 'PAYSLIP_INCLUDE_BONUS', 'TRUE', 'bool', 'Yes = a Diwali bonus marked Done (or Paid) is added to the payslip of the month of its Payment Date, only for employees with eligible CL.'],
   ['Payslip', 'PAYSLIP_INCLUDE_PENALTY', 'TRUE', 'bool', 'Yes = unauthorized leave penalties recorded in that month are deducted on the payslip.'],
   ['Diwali Bonus', 'BONUS_ADMIN_VIEW', 'FALSE', 'bool', 'Yes = normal Admins can see Diwali Bonus details. No = only the Owner can. Only the Owner can change this.'],
   ['Employees', 'EMP_ID_PREFIX', 'EMP', 'text', 'Letters at the start of every new Employee ID. A new employee gets PREFIX-YEAR-001, then 002 and so on. Owner only.'],
   ['Employees', 'BIN_DAYS', '30', 'number', 'Days a deleted employee stays in the Bin (restorable). After this, all their records, including personal details, are permanently removed.'],
   ['Employees', 'DESIGNATION_LIST', 'Manager,Executive,Accountant,Supervisor,Driver,Helper', 'text', 'Designations offered in the new employee form, separated by commas. "Other" is always available.'],
   ['Employees', 'DEFAULT_MANAGER', '', 'text', 'Pre-filled Reporting Manager in the new employee form.'],
   ['Employees', 'DEFAULT_PLACE_OF_WORK', '', 'text', 'Pre-filled Place of Work in the new employee form.'],
   ['Employees', 'DEFAULT_WORK_HOURS', '10:00 AM to 6:00 PM', 'text', 'Pre-filled Working Hours in the new employee form.'],
   ['Employees', 'DEFAULT_SIGNATORY', '', 'text', 'Pre-filled Authorized Signatory in the new employee form.'],
   ['Notifications', 'ADMIN_NOTIFICATION_EMAIL', ownerMail_(), 'emails', 'Admin email(s) for alerts. Separate several with commas.'],
   ['Notifications', 'NOTIFY_ADMIN_INSTANT', 'TRUE', 'bool', 'Yes = email Admin immediately for each new leave application.'],
   ['Notifications', 'DAILY_REMINDER_ENABLED', 'TRUE', 'bool', 'Yes = email Admin a daily list of pending leave applications.'],
   ['Notifications', 'DAILY_REMINDER_HOUR', '9', 'number', 'Hour of the daily reminder (0-23, India time).'],
   ['Notifications', 'NOTIFY_EMPLOYEE_DECISION', 'TRUE', 'bool', 'Yes = email the employee when a leave application is approved, rejected or cancelled.'],
   ['Attendance', 'OFFICE_LAT', '', 'text', 'Office latitude, for example 21.2514. In Google Maps, press and hold on the office and copy the first number.'],
   ['Attendance', 'OFFICE_LNG', '', 'text', 'Office longitude, for example 81.6296 (the second number).'],
   ['Attendance', 'OFFICE_RADIUS_M', '100', 'number', 'A punch within this many metres of the office is "Inside premises". A punch outside is still saved but flagged "Outside premises" for Admin review.'],
   ['Attendance', 'WEEKLY_OFF', 'Sunday', 'select:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday', 'Weekly off day for attendance, the calendar, the monthly register and payslips.'],
   ['Attendance', 'ATTENDANCE_APPROVAL', 'ALL', 'select:ALL|FLAGGED_ONLY|AUTO_HOURS', 'ALL = Admin approves every day under Attendance > Pending approval. FLAGGED_ONLY = a clean punch inside the office is approved automatically. AUTO_HOURS = approved automatically only if the punches are clean AND the hours worked reach the minimum below; otherwise it waits for Admin. Days waiting for approval are not counted as Present.'],
   ['Attendance', 'ATTENDANCE_MIN_HOURS', '9', 'number', 'Only for AUTO_HOURS. Minimum hours between punch in and punch out for automatic approval (9 = 9 hours; 9.5 = 9 h 30 m).'],
   ['Attendance', 'ATTENDANCE_PHOTO_FOLDER_ID', '', 'readonly', 'Google Drive folder that stores punch selfies. Created automatically by setup. Do not change.'],
   ['Penalty', 'PEN1_DAYS', '1', 'number', '1st unauthorized leave: days of salary deducted.'],
   ['Penalty', 'PEN1_AMOUNT', '800', 'number', '1st unauthorized leave: additional penalty (Rs).'],
   ['Penalty', 'PEN2_DAYS', '1', 'number', '2nd occurrence: days of salary deducted.'],
   ['Penalty', 'PEN2_AMOUNT', '1000', 'number', '2nd occurrence: additional penalty (Rs).'],
   ['Penalty', 'PEN3_DAYS', '1', 'number', '3rd occurrence: days of salary deducted.'],
   ['Penalty', 'PEN3_AMOUNT', '1500', 'number', '3rd occurrence: additional penalty (Rs).'],
   ['Penalty', 'PEN_CONSEC_THRESHOLD', '3', 'number', 'More than this many consecutive unauthorized days needs Admin review.'],
   ['Penalty', 'PEN_POLICY_TEXT', 'More than 3 consecutive unauthorized days: Admin review, possible termination under company policy.', 'text', 'Policy text shown to Admin in the Unauthorized Leave register. The system only suggests amounts; it never deducts salary or terminates automatically.']
 ];
}
/** Email of the spreadsheet owner (the account that runs the web app). */
function ownerMail_() {
 try { return normEmail_(Session.getEffectiveUser().getEmail()) || ''; } catch (e) { return ''; }
}
function settingsMap_() {
 if (_SETTINGS) return _SETTINGS;
 try {
   const hit = CacheService.getScriptCache().get('SETTINGS_MAP');
   if (hit) { _SETTINGS = JSON.parse(hit); return _SETTINGS; }
 } catch (e) { /* ignore */ }
 const m = {};
 defaultSettings_().forEach(d => { m[d[1]] = d[2]; });
 const sh = ss_().getSheetByName(SH.SET);
 if (sh && sh.getLastRow() > 1) {
   sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(r => {
     if (r[1] !== '') m[String(r[1])] = String(r[2]);
   });
 }
 _SETTINGS = m;
 try { CacheService.getScriptCache().put('SETTINGS_MAP', JSON.stringify(m), 300); } catch (e) { /* ignore */ }
 return m;
}


function resetSettingsCache_() {
 _SETTINGS = null;
 try { CacheService.getScriptCache().remove('SETTINGS_MAP'); } catch (e) { /* ignore */ }
}


function S_(k) { const m = settingsMap_(); return m[k] === undefined ? '' : String(m[k]); }
function SN_(k) {
 const n = parseFloat(S_(k));
 if (!isNaN(n)) return n;
 const d = defaultSettings_().filter(x => x[1] === k)[0];
 return d ? (parseFloat(d[2]) || 0) : 0;
}
function SB_(k) { return String(S_(k)).trim().toLowerCase() === 'true'; }




/* ------------------------------------------------------------------ */
/*  SHEET HELPERS                                                      */
/* ------------------------------------------------------------------ */
function ss_() {
 if (_SS) return _SS;
 const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
 let last = null;
 for (let i = 0; i < 3; i++) {          // Google sometimes refuses to open the file for a moment: try again
   try {
     _SS = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
     if (_SS) return _SS;
     last = new Error('Spreadsheet not linked. Run setupSystem() from the spreadsheet.');
     break;
   } catch (e) { last = e; _SS = null; Utilities.sleep(400 * (i + 1)); }
 }
 throw last;
}
/* ------------------------------------------------------------------ */
/*  FAST SHEET CACHE  (speed layer)                                    */
/*  - Each sheet is read from Google Sheets once, then served from      */
/*    memory (same request) and CacheService (next requests).          */
/*  - ANY code that touches a sheet through sh_(key) (every write does) */
/*    automatically invalidates that sheet's cache, before AND after   */
/*    the request finishes, so screens never show stale data.          */
/*  - Safety net: cached data also expires by itself after 2 minutes,  */
/*    so a manual edit made directly in the spreadsheet shows up soon. */
/* ------------------------------------------------------------------ */
const RC_ENABLED_ = true;            // set to false to switch the sheet cache off completely (everything then works as before)
const RC_TTL_ = 120;                 // seconds a cached sheet may live
const RC_CHUNK_ = 90000;             // characters per cache entry (cache limit is 100 KB)
const RC_MAX_CHUNKS_ = 40;           // bigger sheets are only kept in memory for the current request
const RC_KEYS_ = { EMP: 1, ADM: 1, APP: 1, LED: 1, BON: 1, UNA: 1, HOL: 1, ATT: 1 };
let _RAW = {};                       // key -> { ver, vals }  (this request only)
let _RAWV = {};                      // key -> version already checked in this request
let _DIRTY = {};                     // keys touched for writing in this request


function rawSheet_(key) {
 const s = ss_().getSheetByName(SH[key]);
 if (!s) throw new Error('Sheet missing: ' + SH[key] + '. Run setupSystem().');
 return s;
}
/** Use this to get a sheet object for writing (or any direct access). It marks the sheet's cache as changed. */
function sh_(key) {
 if (RC_ENABLED_ && RC_KEYS_[key]) { _DIRTY[key] = 1; rcBump_(key); }
 return rawSheet_(key);
}
function rcBump_(key) {
 delete _RAW[key]; delete _RAWV[key];
 try { CacheService.getScriptCache().put('RV_' + key, Utilities.getUuid().slice(0, 8), 21600); } catch (e) { /* ignore */ }
}
/** Call when a request / trigger finishes: makes sure writes are saved, then invalidates once more. */
function rcFlush_() {
 const ks = Object.keys(_DIRTY);
 if (!ks.length) return;
 try { SpreadsheetApp.flush(); } catch (e) { /* ignore */ }
 ks.forEach(rcBump_);
 _DIRTY = {};
}
/** Owner menu: drop every cached sheet. */
function clearSpeedCache_() { Object.keys(RC_KEYS_).forEach(rcBump_); resetSettingsCache_(); }
function menuClearSpeedCache() { assertOwnerRun_(); clearSpeedCache_(); SpreadsheetApp.getUi().alert('Speed cache cleared.'); }


function rcRead_(key) {
 const sh = rawSheet_(key), n = COLS[key].length, last = sh.getLastRow();
 if (last < 2) return [];
 return sh.getRange(2, 1, last - 1, n).getValues();
}
function rcEnc_(vals) {
 return vals.map(r => r.map(x => x instanceof Date ? '\u0001' + x.getTime() : x));
}
function rcDec_(rows) {
 for (let i = 0; i < rows.length; i++) {
   const r = rows[i];
   for (let j = 0; j < r.length; j++) {
     const x = r[j];
     if (typeof x === 'string' && x.charCodeAt(0) === 1) r[j] = new Date(Number(x.slice(1)));
   }
 }
 return rows;
}
/** Raw 2-D values of a sheet (without the header). */
function rcVals_(key) {
 if (!RC_ENABLED_ || !RC_KEYS_[key]) return rcRead_(key);
 if (_RAW[key] && _RAWV[key]) return _RAW[key].vals;
 const c = CacheService.getScriptCache();
 let ver = null;
 try { ver = c.get('RV_' + key); } catch (e) { /* ignore */ }
 if (!ver) { ver = Utilities.getUuid().slice(0, 8); try { c.put('RV_' + key, ver, 21600); } catch (e) { /* ignore */ } }
 _RAWV[key] = true;
 if (_RAW[key] && _RAW[key].ver === ver) return _RAW[key].vals;
 try {
   const cnt = Number(c.get('RM_' + key + '_' + ver)) || 0;
   if (cnt > 0) {
     const names = []; for (let i = 0; i < cnt; i++) names.push('RD_' + key + '_' + ver + '_' + i);
     const got = c.getAll(names);
     let txt = '', ok = true;
     for (let i = 0; i < cnt; i++) { const p = got[names[i]]; if (p === undefined || p === null) { ok = false; break; } txt += p; }
     if (ok) {
       const vals = rcDec_(JSON.parse(txt));
       _RAW[key] = { ver: ver, vals: vals };
       return vals;
     }
   }
 } catch (e) { /* fall through to a fresh read */ }
 const vals = rcRead_(key);            // the version was read BEFORE the sheet, so a newer write can never be hidden
 _RAW[key] = { ver: ver, vals: vals };
 try {
   const txt = JSON.stringify(rcEnc_(vals)), cnt = Math.ceil(txt.length / RC_CHUNK_);
   if (cnt > 0 && cnt <= RC_MAX_CHUNKS_) {
     const o = {};
     for (let i = 0; i < cnt; i++) o['RD_' + key + '_' + ver + '_' + i] = txt.substr(i * RC_CHUNK_, RC_CHUNK_);
     o['RM_' + key + '_' + ver] = String(cnt);
     c.putAll(o, RC_TTL_);
   }
 } catch (e) { /* too big or cache busy: memory only */ }
 return vals;
}
function rcBuild_(key, vals, test) {
 const cols = COLS[key], n = cols.length, out = [];
 for (let i = 0; i < vals.length; i++) {
   const v = vals[i];
   if (test && !test(v)) continue;
   let empty = true;
   for (let j = 0; j < n; j++) { if (v[j] !== '') { empty = false; break; } }
   if (empty) continue;
   const o = { _row: i + 2 };
   for (let j = 0; j < n; j++) o[cols[j]] = v[j];
   out.push(o);
 }
 return out;
}
function readAll_(key) { return rcBuild_(key, rcVals_(key)); }
/** Like readAll_ but builds objects only for rows whose column equals value (faster on big sheets). */
function readWhere_(key, col, value) {
 const idx = COLS[key].indexOf(col), want = String(value);
 return rcBuild_(key, rcVals_(key), v => String(v[idx]) === want);
}
function objToArr_(key, o) {
 return COLS[key].map(c => (o[c] === undefined || o[c] === null) ? '' : o[c]);
}
function ensureRows_(sh, lastNeeded) {
 const max = sh.getMaxRows();
 if (lastNeeded > max) sh.insertRowsAfter(max, lastNeeded - max + 200);
}
function appendObj_(key, o) {
 const sh = sh_(key);
 const row = sh.getLastRow() + 1;
 ensureRows_(sh, row);
 sh.getRange(row, 1, 1, COLS[key].length).setValues([objToArr_(key, o)]);
 return row;
}
function appendMany_(key, objs) {
 if (!objs.length) return;
 const sh = sh_(key);
 const row = sh.getLastRow() + 1;
 ensureRows_(sh, row + objs.length - 1);
 sh.getRange(row, 1, objs.length, COLS[key].length).setValues(objs.map(o => objToArr_(key, o)));
}
function updateObj_(key, row, changes) {
 const sh = sh_(key), n = COLS[key].length;
 const cur = sh.getRange(row, 1, 1, n).getValues()[0];
 COLS[key].forEach((c, j) => {
   if (Object.prototype.hasOwnProperty.call(changes, c)) cur[j] = (changes[c] === null || changes[c] === undefined) ? '' : changes[c];
 });
 sh.getRange(row, 1, 1, n).setValues([cur]);
}


/* ------------------------------------------------------------------ */
/*  DATE / ID / LOCK HELPERS                                           */
/* ------------------------------------------------------------------ */
function tz_() { return S_('TIMEZONE') || 'Asia/Kolkata'; }
function iso_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : ''; }
function dmy_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'dd/MM/yyyy') : ''; }
function dt_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'dd/MM/yyyy HH:mm') : ''; }
function parseYmd_(s) {
 const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
 if (!m) return null;
 const d = new Date(+m[1], +m[2] - 1, +m[3]);
 if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
 return d;
}
function today_() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function r2_(n) { return Math.round(n * 100) / 100; }
function pad_(n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }
function esc_(s) {
 return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid_(prefix) {
 return prefix + '-' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmmss') + '-' +
   Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}
function nextSeq_(name) {
 const p = PropertiesService.getScriptProperties();
 const k = 'SEQ_' + name;
 let n = parseInt(p.getProperty(k) || '0', 10) || 0;
 const m = /^APP(\d{4})$/.exec(name);
 if (m) {   // application IDs: never go below the highest ID already in the sheet
   const sh = sh_('APP'), last = sh.getLastRow();
   if (last > 1) {
     const re = new RegExp('^LV-' + m[1] + '-(\\d+)$');
     sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
       const x = re.exec(String(r[0]).trim());
       if (x) n = Math.max(n, parseInt(x[1], 10));
     });
   }
 }
 n += 1;
 p.setProperty(k, String(n));
 return n;
}
function withLock_(fn) {
 const lock = LockService.getScriptLock();
 lock.waitLock(30000);
 try { return fn(); } finally { try { rcFlush_(); } catch (e) { /* ignore */ } lock.releaseLock(); }
}
function normPhone_(s) { return String(s || '').replace(/\D/g, '').slice(-10); }
function normEmail_(s) { return String(s || '').trim().toLowerCase(); }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }


/* ------------------------------------------------------------------ */
/*  SYSTEM LOG  (append-only through server code)                      */
/* ------------------------------------------------------------------ */
function log_(ctx, action, module, recordId, oldV, newV, remarks, result) {
 try {
   const c = ctx || {};
   const cut = v => {
     if (v === null || v === undefined) return '';
     const s = typeof v === 'string' ? v : JSON.stringify(v);
     return s.length > 1500 ? s.slice(0, 1500) + '...' : s;
   };
   appendObj_('LOG', {
     'Log ID': uid_('LOG'), 'Timestamp': new Date(), 'User Email': c.email || '', 'User Role': c.role || 'SYSTEM',
     'Action': action, 'Module': module, 'Record ID': recordId || '', 'Old Value': cut(oldV), 'New Value': cut(newV),
     'Remarks': cut(remarks), 'Result': result || 'SUCCESS'
   });
 } catch (e) {
   console.error('Log write failed: ' + e);
 }
}


/* ------------------------------------------------------------------ */
/*  WEB APP ENTRY                                                      */
/* ------------------------------------------------------------------ */
function doGet(e) {
 let company = 'Company';
 try { company = S_('COMPANY_NAME') || company; } catch (x) { /* not set up yet */ }
 const t = HtmlService.createTemplateFromFile('Index');
 t.company = company;
   return t.evaluate()
   .setTitle(company + ' - Leave Management')
   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
   .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
function include(name) {
 return HtmlService.createHtmlOutputFromFile(name).getContent();
}


/* ------------------------------------------------------------------ */
/*  API GATEWAY - the only server functions the browser may use        */
/* ------------------------------------------------------------------ */
function apiPublic(action, payload) {
 return runApi_(publicApi_(), action, payload, () => ({ email: '', role: 'ANONYMOUS' }));
}
function apiEmployee(action, token, payload) {
 return runApi_(employeeApi_(), action, payload, () => employeeCtx_(token));
}
function apiAdmin(action, token, payload) {
 return runApi_(adminApi_(), action, payload, () => adminCtx_(token));
}


function runApi_(map, action, payload, authFn) {
 try {
   const fn = Object.prototype.hasOwnProperty.call(map, String(action)) ? map[String(action)] : null;
   if (!fn) fail_('Unknown request.', 'BAD');
   const ctx = authFn();
   const p = (payload && typeof payload === 'object') ? payload : {};
   return { ok: true, data: fn(ctx, p), lv: logoVer_() };
 } catch (e) {
   if (e instanceof UserError) return { ok: false, error: e.message, code: e.code, lv: logoVer_() };
   try { console.error('API FAILED [' + String(action) + ']: ' + String(e && e.stack ? e.stack : e)); } catch (x) { /* ignore */ }
   log_({ role: 'SYSTEM' }, 'UNEXPECTED_ERROR', 'SYSTEM', String(action), '', '', String(e && e.stack ? e.stack : e), 'ERROR');
   return { ok: false, error: 'Something went wrong. Please try again, or contact Admin if it continues.', code: 'SYS' };
 } finally {
   try { rcFlush_(); } catch (x) { /* ignore */ }
 }
}


/* ------------------------------------------------------------------ */
/*  COMPANY LOGO  (versioned, so every open screen updates by itself)  */
/*  Uses the same stored logo as before (LOGO_N / LOGO_0 ...).         */
/*  Every response carries the logo version "lv"; when it changes the  */
/*  screen downloads the new logo and repaints it. No refresh needed.  */
/* ------------------------------------------------------------------ */
function logoVer_() {
 try {
   const c = CacheService.getScriptCache();
   let v = c.get('LOGO_V');
   if (v === null || v === undefined) {
     v = PropertiesService.getScriptProperties().getProperty('LOGO_V') || '0';
     c.put('LOGO_V', v, 21600);
   }
   return v;
 } catch (e) { return '0'; }
}
function logoBump_() {
 const v = String(Date.now());
 PropertiesService.getScriptProperties().setProperty('LOGO_V', v);
 try { CacheService.getScriptCache().put('LOGO_V', v, 21600); } catch (e) { /* ignore */ }
 return v;
}
function logoGet_() {
 const ver = logoVer_();
 let logo = '';
 try { logo = logoDataUri_(); } catch (e) { logo = ''; }
 return { ver: ver, logo: logo };
}
function adminLogoSave2_(ctx, p) {
 const r = adminLogoSave_(ctx, p);      // validation + storage stay in Logo.gs
 return { message: r.message, logo: r.logo, ver: logoBump_() };
}
function adminLogoRemove2_(ctx, p) {
 const r = adminLogoRemove_(ctx, p);
 return { message: r.message, logo: '', ver: logoBump_() };
}


function publicApi_() {
 return {
   getPublicInfo: () => ({ company: S_('COMPANY_NAME'), empMode: 'PASSWORD', active: SB_('SYSTEM_ACTIVE'), logoVer: logoVer_() }),
   getLogo: () => logoGet_(),
   employeeLogin: employeeLogin_,
   adminLogin: adminLogin_,
   firstSignIn: firstSignIn_,
   requestReset: requestResetCode_,
 };
}


function employeeApi_() {
 return {
   home: empHome_, applications: empApplications_, holidays: empHolidays_, preview: empPreview_,
   submit: empSubmit_, cancel: empCancel_, logout: sessionLogout_, ackPolicy: empAckPolicy_, myLeaves: empMyLeaves_,
   attToday: attToday_, attPunch: attPunch_, attMonth: attMonth_, attPhoto: attPhoto_, attCheck: attCheck_, payslip: empPayslip_, payslipPdf: empPayslipPdf_, wageTracker: empWageTracker_, payAccList: empPayAccList_, payAccMark: empPayAccMark_
 };
}


function adminApi_() {
 return {
   logout: sessionLogout_, changePassword: adminChangePassword_, me: adminMe_,
   dashboard: adminDashboard_, listApplications: adminListApplications_, getApplication: adminGetApplication_,
   getDocument: adminGetDocument_, approve: adminApprove_, reject: adminReject_, cancelApproved: adminCancelApproved_,
   manualLeave: adminManualLeave_, updateLeave: adminUpdateLeave_,
   listEmployees: adminListEmployees_, saveEmployee: adminSaveEmployee_, deleteEmployee: adminDeleteEmployee_,
   keProfile: adminKeProfile_, keSaveProfile: adminKeSaveProfile_,
   binList: adminBinList_, binRestore: adminBinRestore_, binPurgeNow: adminBinPurgeNow_, binDelete: adminBinDelete_,
   balanceSummary: adminBalanceSummary_, ledger: adminLedger_, adjustBalance: adminAdjustBalance_,
   listUnauthorized: adminListUnauthorized_, suggestPenalty: adminSuggestPenalty_, saveUnauthorized: adminSaveUnauthorized_,
   bonusList: adminBonusList_, bonusCompute: adminBonusCompute_, bonusSave: adminBonusSave_,
   bonusRules: adminBonusRules_, bonusRuleSave: adminBonusRuleSave_, bonusRuleUse: adminBonusRuleUse_, bonusRuleDelete: adminBonusRuleDelete_,
   listHolidays: adminListHolidays_, saveHoliday: adminSaveHoliday_,
   getSettings: adminGetSettings_, saveSettings: adminSaveSettings_,
   listAdmins: adminListAdmins_, saveAdmin: adminSaveAdmin_, deleteAdmin: adminDeleteAdmin_, issueCode: adminIssueCode_,
   listLog: adminListLog_, runMaintenance: adminRunMaintenance_, sendReminderNow: adminSendReminderNow_,
   attList: adminAttList_, attFlags: adminAttFlags_, attDetail: adminAttDetail_, attPhoto: adminAttPhoto_, attMark: adminAttMark_, attReview: adminAttReview_,
   attPending: adminAttPending_, attApprove: adminAttApprove_, attSetPunch: adminAttSetPunch_,
   attRegister: adminAttRegister_, attFinalize: adminAttFinalize_, attReopen: adminAttReopen_,
   logoSave: adminLogoSave2_, logoRemove: adminLogoRemove2_,
   payslipList: adminPayslipList_, payslip: adminPayslip_, payslipPdf: adminPayslipPdf_, payslipAccess: adminPayslipAccess_, payslipAccessSave: adminPayslipAccessSave_, bonusDone: adminBonusDone_, payAccGet: adminPayAccGet_, payAccSave: adminPayAccSave_
 };
}


function clientConfig_() {
 return {
   company: S_('COMPANY_NAME'),
   clMonthly: SN_('CL_MONTHLY_CREDIT'), slMonthly: SN_('SL_MONTHLY_CREDIT'),
   clAnnual: SN_('CL_ANNUAL_MAX'), slAnnual: SN_('SL_ANNUAL_MAX'), clCarry: SB_('CL_CARRY_FORWARD'),
   clNotice: SN_('CL_NOTICE_HOURS'), otherNotice: SN_('OTHER_NOTICE_HOURS'), slNotice: SN_('SL_NOTICE_HOURS'),
   medThreshold: SN_('MEDICAL_PROOF_THRESHOLD_DAYS'), maxUploadMb: SN_('MAX_UPLOAD_MB'),
   durationMode: S_('DURATION_MODE'), otherTreatment: S_('OTHER_LEAVE_TREATMENT'),
   penaltyPolicy: S_('PEN_POLICY_TEXT'), holidayAllowance: SN_('PUBLIC_HOLIDAY_ALLOWANCE'),
   holidayTreatment: S_('PUBLIC_HOLIDAY_TREATMENT'),
   pen: [1, 2, 3].map(n => ({ days: SN_('PEN' + n + '_DAYS'), amount: SN_('PEN' + n + '_AMOUNT') }))
 };
}


/* ------------------------------------------------------------------ */
/*  SETUP  (owner runs ONCE from the Apps Script editor or sheet menu) */
/* ------------------------------------------------------------------ */
function assertOwnerRun_() {
 let a = '', e = '';
 try { a = Session.getActiveUser().getEmail(); e = Session.getEffectiveUser().getEmail(); } catch (x) { /* ignore */ }
 if (!a || !e || a.toLowerCase() !== e.toLowerCase()) throw new Error('Only the spreadsheet owner can run this function.');
}


function setupSystem() {
 assertOwnerRun_();
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
 _SS = ss;
 ss.setSpreadsheetTimeZone('Asia/Kolkata');
 initializeSheets_(ss);
 seedSettings_();
 seedPrimaryAdmin_();
 docFolderId_();
 pepper_();
 createTriggers_();
 protectSheets_();
 log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'SETUP_COMPLETED', 'SYSTEM', '', '', APP_VERSION_, 'Setup run');
 let msg = 'Setup complete. Next: deploy as a Web App, then in the sheet menu use "Owner: generate login code for an Admin" to get the first code for the primary Admin.';
 if (Session.getScriptTimeZone() !== 'Asia/Kolkata') {
   msg += '\n\nWARNING: Project time zone is "' + Session.getScriptTimeZone() + '". Set it to Asia/Kolkata (Project Settings) so dates are exact.';
 }
 try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
 return msg;
}
const APP_VERSION_ = 'Leave Management v1.0';


function initializeSheets_(ss) {
 SHEET_ORDER.forEach((k, i) => {
   let sh = ss.getSheetByName(SH[k]);
   if (!sh) sh = ss.insertSheet(SH[k], i);
   const n = COLS[k].length;
   sh.getRange(1, 1, 1, n).setValues([COLS[k]])
     .setBackground('#0f3d5e').setFontColor('#ffffff').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
   sh.setFrozenRows(1);
   sh.setRowHeight(1, 34);
   const rows = Math.max(sh.getMaxRows() - 1, 1);
   (DATE_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('dd/mm/yyyy'));
   (DATETIME_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('dd/mm/yyyy hh:mm'));
   (TEXT_COLS[k] || []).forEach(c => sh.getRange(2, COLS[k].indexOf(c) + 1, rows, 1).setNumberFormat('@'));
   sh.setColumnWidths(1, n, 135);
 });
 const def = ss.getSheetByName('Sheet1');
 if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);


 const listRule = vals => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build();
 const setList = (key, col, vals) => sh_(key).getRange(2, COLS[key].indexOf(col) + 1, Math.max(sh_(key).getMaxRows() - 1, 1), 1).setDataValidation(listRule(vals));
 setList('EMP', 'Status', ['Active', 'Inactive', 'Deleted']);
 setList('APP', 'Status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
 setList('APP', 'Leave Type', ['CL', 'SL', 'OTHER']);
 setList('BON', 'Status', ['Pending', 'Processed', 'Paid']);
 setList('HOL', 'Status', ['Active', 'Inactive']);
 setList('ADM', 'Status', ['Active', 'Inactive']);
 setList('ADM', 'Role', ['OWNER', 'ADMIN']);
 sh_('SET').setColumnWidth(3, 260);
 sh_('SET').setColumnWidth(4, 520);
 sh_('LOG').setColumnWidth(8, 260);
 sh_('LOG').setColumnWidth(9, 260);
 sh_('LOG').setColumnWidth(10, 320);
}


function seedSettings_() {
 const sh = sh_('SET');
 const have = {};
 if (sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(r => { have[String(r[0])] = 1; });
 const add = defaultSettings_().filter(d => !have[d[1]]).map(d => ({ 'Group': d[0], 'Key': d[1], 'Value': d[2], 'Description': d[4] }));
 appendMany_('SET', add);
 resetSettingsCache_();
}


function seedPrimaryAdmin_() {
 const admins = readAll_('ADM');
 if (admins.some(a => a['Role'] === 'OWNER')) return;          // an Owner already exists
 const email = ownerMail_();
 if (!isEmail_(email)) throw new Error('The owner email could not be read. Run setupSystem() from the spreadsheet owner account.');
 const now = new Date();
 appendObj_('ADM', {
   'Admin ID': 'ADM-' + pad_(nextSeq_('ADM'), 3), 'Admin Name': 'Owner', 'Email': email, 'Phone': '',
   'Role': 'OWNER', 'Status': 'Active', 'Created At': now, 'Updated At': now
 });
}


function docFolderId_() {
 const p = PropertiesService.getScriptProperties();
 let id = p.getProperty('DOC_FOLDER_ID');
 if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) { /* recreate */ } }
 const fname = ss_().getName() + ' - Leave Documents';
 const it = DriveApp.getFoldersByName(fname);
 const f = it.hasNext() ? it.next() : DriveApp.createFolder(fname);
 id = f.getId();
 p.setProperty('DOC_FOLDER_ID', id);
 return id;
}


function protectSheets_() {
 const ss = ss_();
 const me = Session.getEffectiveUser();
 Object.keys(SH).forEach(k => {
   const sh = ss.getSheetByName(SH[k]);
   if (!sh) return;
   sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
   const p = sh.protect().setDescription('System managed. Use the Leave Management web app.');
   p.addEditor(me);
   p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
   if (p.canDomainEdit()) p.setDomainEdit(false);
 });
}


function createTriggers_() {
 ScriptApp.getProjectTriggers().forEach(t => {
   const f = t.getHandlerFunction();
   if (f === 'triggerDailyMaintenance' || f === 'triggerDailyReminder' || f === 'keepWarm') ScriptApp.deleteTrigger(t);
 });
 ScriptApp.newTrigger('triggerDailyMaintenance').timeBased().everyDays(1).atHour(1).nearMinute(10).create();
 ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
 if (SB_('DAILY_REMINDER_ENABLED')) {
   let h = Math.round(SN_('DAILY_REMINDER_HOUR'));
   if (h < 0 || h > 23) h = 9;
   ScriptApp.newTrigger('triggerDailyReminder').timeBased().everyDays(1).atHour(h).nearMinute(0).create();
 }
}


/* ------------------------------------------------------------------ */
/*  TRIGGER ENTRY POINTS (idempotent, safe to run more than once)      */
/* ------------------------------------------------------------------ */
function triggerDailyMaintenance() {
 try { runMaintenance_('SYSTEM'); }
 catch (e) { log_({ role: 'SYSTEM' }, 'MAINTENANCE_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
 try { dailyEmployeeJobs_(); }
 catch (e) { log_({ role: 'SYSTEM' }, 'EMPLOYEE_DAILY_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
 try { rcFlush_(); clearSpeedCache_(); } catch (e) { /* ignore */ }
}
function triggerDailyReminder() {
 try { sendDailyPendingReminder_(false); }
 catch (e) { log_({ role: 'SYSTEM' }, 'REMINDER_FAILED', 'SYSTEM', '', '', '', String(e), 'ERROR'); }
 try { rcFlush_(); } catch (e) { /* ignore */ }
}


/* ------------------------------------------------------------------ */
/*  SPREADSHEET MENU (owner only)                                      */
/* ------------------------------------------------------------------ */
function onOpen() {
 try {
   SpreadsheetApp.getUi().createMenu('Leave Management')
     .addItem('1. Initial setup (run once)', 'setupSystem')
     .addItem('Show web app link', 'menuShowUrl')
     .addSeparator()
     .addItem('Run daily maintenance now', 'menuRunMaintenance')
     .addItem('Re-create triggers', 'menuCreateTriggers')
     .addItem('Update settings descriptions', 'menuSyncSettingDescriptions_')
     .addItem('Re-apply sheet protection', 'menuProtect')
     .addItem('Clear speed cache', 'menuClearSpeedCache')
     .addSeparator()
     .addItem('Owner recovery: reset an Admin password', 'menuOwnerReset')
     .addToUi();
 } catch (e) { /* ignore */ }
}
function menuShowUrl() {
 assertOwnerRun_();
 let url = '';
 try { url = S_('WEB_APP_URL') || ScriptApp.getService().getUrl() || ''; } catch (e) { /* ignore */ }
 const html = HtmlService.createHtmlOutput(
   '<div style="font-family:Arial;padding:8px"><p>Open the web app, sign in as Admin, then use <b>Settings</b> in the left menu to change all settings.</p>' +
   (url ? '<p><a href="' + esc_(url) + '" target="_blank">' + esc_(url) + '</a></p>' : '<p>Deploy the web app first (Deploy > New deployment > Web app).</p>') + '</div>')
   .setWidth(520).setHeight(180);
 SpreadsheetApp.getUi().showModalDialog(html, 'Leave Management web app');
}
function menuRunMaintenance() { assertOwnerRun_(); runMaintenance_('OWNER'); SpreadsheetApp.getUi().alert('Maintenance completed.'); }
function menuCreateTriggers() { assertOwnerRun_(); createTriggers_(); SpreadsheetApp.getUi().alert('Triggers re-created.'); }
function menuProtect() { assertOwnerRun_(); protectSheets_(); SpreadsheetApp.getUi().alert('Sheets protected.'); }
function menuOwnerReset() {
 assertOwnerRun_();
 const ui = SpreadsheetApp.getUi();
 const r = ui.prompt('Generate login code', 'Enter the Admin email or mobile number.', ui.ButtonSet.OK_CANCEL);
 if (r.getSelectedButton() !== ui.Button.OK) return;
 const admin = findAdminByIdent_(r.getResponseText());
 if (!admin) { ui.alert('No Admin found for that email/mobile.'); return; }
 if (String(admin['Status']) !== 'Active') { ui.alert('This Admin is not Active.'); return; }
 const code = issueSetupCode_(admin['Admin ID']);
 log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'OWNER_ISSUED_SETUP_CODE', 'SECURITY', admin['Admin ID'], '', '', 'Setup code issued from the sheet menu', 'SUCCESS');
 ui.alert('Login code for ' + admin['Admin Name'] + ':\n\n' + code + '\n\nValid for ' + SETUP_HOURS + ' hours, works once.\nOn the login page: Admin tab > "Forgot password? / First-time sign in".');
}


/** FASTEST WAY IN: select this function in the editor, press Run, open the Execution log. It issues a login code for the Owner (you). */
function quickAdminCode() {
 assertOwnerRun_();
 const ident = Session.getEffectiveUser().getEmail();
 const admin = findAdminByIdent_(ident);
 if (!admin) { Logger.log('NO ADMIN FOUND for ' + ident + '. Check the ADMINS sheet.'); return; }
 if (String(admin['Status']) !== 'Active') { Logger.log('Admin found but Status is "' + admin['Status'] + '". It must be exactly Active.'); return; }
 const code = issueSetupCode_(admin['Admin ID']);
 Logger.log('LOGIN CODE for ' + admin['Admin Name'] + ' (' + admin['Admin ID'] + '): ' + code + '  (valid ' + SETUP_HOURS + ' hours, works once)');
}


function diagEmployeeMail() {
 assertOwnerRun_();
 const ident = 'PUT THE EMPLOYEE EMAIL OR MOBILE HERE';
 const out = [];
 out.push('Mail quota left today: ' + MailApp.getRemainingDailyQuota());
 const emp = findEmployeeByIdent_(ident);
 if (!emp) { out.push('NO EMPLOYEE FOUND for "' + ident + '". Check the Email and Phone columns in EMPLOYEE MASTER.'); }
 else {
   out.push('Found: ' + emp['Employee Name'] + ' (' + emp['Employee ID'] + '), Status: ' + emp['Status']);
   out.push('Email on file: "' + emp['Email'] + '"  valid: ' + isEmail_(emp['Email']));
   if (isEmail_(emp['Email'])) {
     const r = sendSecMail_(emp['Email'], emp['Employee Name'], 'Mail test', ['This is a test mail from the portal.']);
     out.push('Send result: ' + r);
   }
 }
 const msg = out.join('\n');
 Logger.log(msg);
 return msg;
}






/** Rewrites ONLY the Description column of the SETTINGS sheet from defaultSettings_(). Values are untouched. */
function syncSettingDescriptions_() {
 const sh = sh_('SET');
 const last = sh.getLastRow();
 if (last < 2) return 0;
 const desc = {};
 defaultSettings_().forEach(d => { desc[d[1]] = d[4]; });
 const rows = sh.getRange(2, 2, last - 1, 3).getValues();   // columns B (Key), C (Value), D (Description)
 let changed = 0;
 const out = rows.map(r => {
   const k = String(r[0]);
   if (desc[k] !== undefined && String(r[2]) !== desc[k]) { changed++; return [desc[k]]; }
   return [r[2]];
 });
 if (changed) sh.getRange(2, 4, out.length, 1).setValues(out);
 resetSettingsCache_();
 return changed;
}
function menuSyncSettingDescriptions_() {
 assertOwnerRun_();
 seedSettings_();                       // adds any missing keys with their default values
 const n = syncSettingDescriptions_();
 log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'SETTINGS_DESCRIPTIONS_UPDATED', 'SETTINGS', '', '', n + ' descriptions', 'Descriptions refreshed; values unchanged', 'SUCCESS');
 SpreadsheetApp.getUi().alert('Done. ' + n + ' setting description(s) updated. Values were not changed.');
}
function fixDuplicateAppIds() {
 assertOwnerRun_();
 return withLock_(function () {
   const rows = readAll_('APP'), seen = {}, out = [];
   rows.forEach(function (a) {
     const id = String(a['Application ID']);
     if (!seen[id]) { seen[id] = 1; return; }
     if (a['Status'] !== 'PENDING') {
       out.push(id + ' (row ' + a._row + ') is ' + a['Status'] + ' - NOT changed, check manually');
       return;
     }
     const yr = id.split('-')[1] || String(new Date().getFullYear());
     const newId = 'LV-' + yr + '-' + pad_(nextSeq_('APP' + yr), 4);
     setCell_('APP', a._row, 'Application ID', newId);
     log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'APP_ID_DUPLICATE_FIXED', 'LEAVE', newId, id, newId, 'Row ' + a._row + ' renumbered', 'SUCCESS');
     out.push('Row ' + a._row + ': ' + id + ' -> ' + newId);
   });
   const msg = out.length ? out.join('\n') : 'No duplicate application IDs found.';
   Logger.log(msg);
   return msg;
 });
}


/** Keeps the web app warm so the first open after idle is faster. Runs from a 5-minute trigger. */
function keepWarm() {
 try { S_('COMPANY_NAME'); } catch (e) { /* ignore */ }
 return 1;
}

