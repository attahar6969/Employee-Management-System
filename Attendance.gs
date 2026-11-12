/**
* Attendance.gs
*/


/** Returns the selfie folder ID, creating the folder once and saving its ID in Settings. */
function attFolderId_() {
 const cur = S_('ATTENDANCE_PHOTO_FOLDER_ID').trim();
 if (cur) { try { DriveApp.getFolderById(cur); return cur; } catch (e) { /* recreate */ } }
 const fname = ss_().getName() + ' - Attendance Photos';
 const it = DriveApp.getFoldersByName(fname);
 const f = it.hasNext() ? it.next() : DriveApp.createFolder(fname);
 withLock_(() => setSettingRaw_({ email: 'SETUP', role: 'OWNER' }, 'ATTENDANCE_PHOTO_FOLDER_ID', f.getId()));
 return f.getId();
}


/** Owner runs ONCE from the editor. Safe to run again. */
function attSetup() {
 assertOwnerRun_();
 initializeSheets_(ss_());      // creates the ATTENDANCE sheet and its headers
 seedSettings_();               // adds the five Attendance settings
 const id = attFolderId_();
 protectSheets_();              // protects the new sheet like the others
 log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'ATTENDANCE_SETUP', 'SYSTEM', '', '', { folder: id }, 'Attendance sheet, settings and folder ready', 'SUCCESS');
 const msg = 'Attendance setup done. Photo folder ID: ' + id + '\nNext: set OFFICE_LAT and OFFICE_LNG in Settings > Attendance.';
 Logger.log(msg);
 try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor */ }
 return msg;
}


/* ================= STAGE 3: EMPLOYEE ATTENDANCE ================= */
const ATT_STATUSES_ = ['Present', 'Pending approval', 'Absent', 'Half day', 'CL', 'SL', 'Other leave', 'Paid holiday', 'Weekly off'];
const DOW_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];


function attOffice_() {
 const lat = parseFloat(S_('OFFICE_LAT')), lng = parseFloat(S_('OFFICE_LNG'));
 const ok = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
 const r = SN_('OFFICE_RADIUS_M');
 return { set: ok, lat: lat, lng: lng, radius: r > 0 ? r : 100 };
}
/** Haversine distance in metres. Always calculated on the server. */
function attDistance_(lat1, lng1, lat2, lng2) {
 const R = 6371000, rad = x => x * Math.PI / 180;
 const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
 const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
 return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}
function attTime_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'hh:mm a') : ''; }
function attHours_(a, b) {
 if (!(a instanceof Date) || !(b instanceof Date) || b < a) return '';
 const m = Math.round((b - a) / 60000);
 return Math.floor(m / 60) + ' h ' + pad_(m % 60, 2) + ' m';
}
function attFindRow_(empId, ymd) {
 return readWhere_('ATT', 'Employee ID', empId).filter(r => r['Date'] instanceof Date && iso_(r['Date']) === ymd)[0] || null;
}
let _PIO = null;
function pioIds_() {
 if (_PIO) return _PIO;
 const m = {};
 readAll_('EMP').forEach(e => { if (String(e['Punch In Only'] || '').toUpperCase() === 'YES') m[String(e['Employee ID'])] = true; });
 _PIO = m;
 return m;
}
function punchInOnly_(emp) { return String(emp['Punch In Only'] || '').toUpperCase() === 'YES'; }


/** One day as plain data for the screen. r may be null. */
function attDayOut_(r, ymd, todayIso) {
 const inT = r && r['Punch In Time'] instanceof Date ? r['Punch In Time'] : null;
 const outT = r && r['Punch Out Time'] instanceof Date ? r['Punch Out Time'] : null;
 const num = v => (v === '' || v === null || v === undefined) ? null : Number(v);
 const g = k => r ? r[k] : '';
 return {
   date: ymd, inTime: attTime_(inT), outTime: attTime_(outT), hours: attHours_(inT, outT),
   inDist: num(g('In Distance (m)')), outDist: num(g('Out Distance (m)')), inAcc: num(g('In Accuracy')), outAcc: num(g('Out Accuracy')),
   inFlag: attCleanFlag_(g('In Flag')), outFlag: attCleanFlag_(g('Out Flag')),
   inLat: num(g('In Lat')), inLng: num(g('In Lng')), outLat: num(g('Out Lat')), outLng: num(g('Out Lng')),
   hasInPhoto: !!g('In Photo File ID'), hasOutPhoto: !!g('Out Photo File ID'),
   marked: !!g('Marked By'), markReason: String(g('Mark Reason') || ''),
   approval: String(g('Approval Status') || ''), approvalNote: String(g('Approval Remarks') || ''),
   missingOut: !!(inT && !outT && ymd < todayIso && !(r && pioIds_()[String(r['Employee ID'])]))
 };
}


/** Everything needed to decide the status of each day of one month, read once. */
function attContext_(emp, y, m) {
 const empId = String(emp['Employee ID']);
 const firstIso = iso_(new Date(y, m - 1, 1)), lastIso = iso_(new Date(y, m, 0));
 const rows = {};
 readWhere_('ATT', 'Employee ID', empId).forEach(r => { if (r['Date'] instanceof Date) rows[iso_(r['Date'])] = r; });
 const leave = {};
 readWhere_('APP', 'Employee ID', empId).forEach(a => {
   if (a['Status'] !== 'APPROVED') return;
   if (!(a['From Date'] instanceof Date) || !(a['To Date'] instanceof Date)) return;
   if (iso_(a['To Date']) < firstIso || iso_(a['From Date']) > lastIso) return;
   leaveDays_(a['From Date'], a['To Date']).forEach(d => { leave[iso_(d)] = a['Leave Type']; });
 });
 const hol = {};
 readAll_('HOL').forEach(h => { if (h['Status'] === 'Active' && h['Holiday Date'] instanceof Date) hol[iso_(h['Holiday Date'])] = String(h['Holiday Name']); });
 const wo = DOW_.indexOf(S_('WEEKLY_OFF') || 'Sunday');
 const una = {}; const unaAll = unaDateMap_(empId); Object.keys(unaAll).forEach(k => { una[k.split('|')[1]] = unaAll[k]; });
 return { rows: rows, leave: leave, hol: hol, una: una, wo: wo < 0 ? 0 : wo, joining: emp['Joining Date'] instanceof Date ? iso_(emp['Joining Date']) : '' };
}
/** Order: attendance row, approved leave, public holiday, weekly off, then Absent for past days. */
function attStatusOf_(c, d, ymd, todayIso) {
 const r = c.rows[ymd];
 if (c.una && c.una[ymd]) return 'Unauthorized leave';
 if (r && ATT_STATUSES_.indexOf(String(r['Status'])) > -1 && (r['Punch In Time'] instanceof Date || r['Status'] !== 'Present' || r['Marked By'])) return String(r['Status']);
 if (c.joining && ymd < c.joining) return '';
 if (c.leave[ymd]) return c.leave[ymd] === 'CL' ? 'CL' : c.leave[ymd] === 'SL' ? 'SL' : 'Other leave';
 if (c.hol[ymd]) return 'Paid holiday';
 if (d.getDay() === c.wo) return 'Weekly off';
 return ymd < todayIso ? 'Absent' : '';
}
function attMonthData_(emp, y, m) {
 const c = attContext_(emp, y, m), todayIso = iso_(new Date()), n = new Date(y, m, 0).getDate();
 const days = [], s = { present: 0, onLeave: 0, absent: 0, holidays: 0, weeklyOff: 0, missingOut: 0, halfDay: 0, pending: 0, ul: 0 };
 for (let i = 1; i <= n; i++) {
   const d = new Date(y, m - 1, i), ymd = iso_(d), st = attStatusOf_(c, d, ymd, todayIso);
   const o = attDayOut_(c.rows[ymd] || null, ymd, todayIso);
   o.day = i; o.dow = d.getDay(); o.status = st; o.holiday = c.hol[ymd] || ''; o.today = ymd === todayIso; o.future = ymd > todayIso;
   days.push(o);
   if (st === 'Present') s.present += 1;
   else if (st === 'Pending approval') s.pending += 1;      // not counted until Admin approves
   else if (st === 'Half day') { s.present += 0.5; s.absent += 0.5; s.halfDay += 1; }
   else if (st === 'CL' || st === 'SL' || st === 'Other leave') s.onLeave += 1;
   else if (st === 'Unauthorized leave') s.ul += 1;
   else if (st === 'Absent') s.absent += 1;
   else if (st === 'Paid holiday') s.holidays += 1;
   else if (st === 'Weekly off') s.weeklyOff += 1;
   if (o.missingOut) s.missingOut += 1;
 }
 const base = s.present + s.absent + s.ul;                       // leave, holidays and weekly off do not lower the percentage
 s.percent = base > 0 ? Math.round(s.present / base * 100) : 0;
 ['present', 'onLeave', 'absent'].forEach(k => { s[k] = r2_(s[k]); });
 return { days: days, summary: s };
}


/* ---------- API: today (also returns the current month, so the dashboard needs one call) ---------- */
function attMonthPayload_(mo, y, m) {
 const t = today_();
 const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
 const key = d => d.getFullYear() + '-' + pad_(d.getMonth() + 1, 2);
 return {
   month: y + '-' + pad_(m, 2), label: MONTHS_LONG_[m - 1] + ' ' + y, days: mo.days, summary: mo.summary,
   prev: key(prev), next: next.getFullYear() > t.getFullYear() + 1 ? '' : key(next), firstDow: new Date(y, m - 1, 1).getDay()
 };
}
function attToday_(ctx) {
 const now = new Date(), ymd = iso_(now), p = ymd.split('-').map(Number);
 const mo = attMonthData_(ctx.emp, p[0], p[1]);
 const day = mo.days[p[2] - 1], off = attOffice_();
 return plain_({
   serverNow: now.getTime(), serverText: Utilities.formatDate(now, tz_(), 'hh:mm:ss a'), date: ymd,
   dateText: Utilities.formatDate(now, tz_(), 'EEE, d MMM yyyy'),
   today: day, canIn: !day.inTime, canOut: !!day.inTime && !day.outTime && !punchInOnly_(ctx.emp), pio: punchInOnly_(ctx.emp),
   office: { set: off.set, radius: off.radius }, summary: mo.summary, monthLabel: MONTHS_LONG_[p[1] - 1] + ' ' + p[0],
   cal: attMonthPayload_(mo, p[0], p[1])
 });
}


/* ---------- API: month ---------- */
function attMonth_(ctx, p) {
 const t = today_();
 let y = t.getFullYear(), m = t.getMonth() + 1;
 const mm = /^(\d{4})-(\d{2})$/.exec(String(p.month || ''));
 if (mm) { y = Number(mm[1]); m = Number(mm[2]); }
 if (m < 1 || m > 12 || y < 2020 || y > t.getFullYear() + 1) fail_('Please choose a valid month.');
 return plain_(attMonthPayload_(attMonthData_(ctx.emp, y, m), y, m));
}


/* ---------- API: own selfie, returned as data (Drive links are private) ---------- */
function attPhoto_(ctx, p) {
 const ymd = String(p.date || ''), type = String(p.type || '').toUpperCase();
 if (!parseYmd_(ymd) || (type !== 'IN' && type !== 'OUT')) fail_('Invalid request.');
 const r = attFindRow_(ctx.emp['Employee ID'], ymd);
 const id = r ? r[type === 'IN' ? 'In Photo File ID' : 'Out Photo File ID'] : '';
 if (!id) fail_('No photo for this punch.');
 let blob;
 try { blob = DriveApp.getFileById(id).getBlob(); } catch (e) { fail_('The photo could not be opened.'); }
 return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
/* ---------- API: distance preview for the warning (nothing is saved) ---------- */
function attCheck_(ctx, p) {
 if (!throttle_('CHK_' + ctx.id, 40, 600)) fail_('Too many checks. Please wait a few minutes.', 'LOCK');
 const lat = parseFloat(p.lat), lng = parseFloat(p.lng), off = attOffice_();
 const ok = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
 if (!ok) return { located: false, officeSet: off.set, radius: off.radius };
 if (!off.set) return { located: true, officeSet: false, radius: off.radius };
 const d = attDistance_(lat, lng, off.lat, off.lng);
 return { located: true, officeSet: true, distance: d, inside: d <= off.radius, radius: off.radius };
}
/* ---------- API: punch ---------- */
function attCheckState_(row, type, reqKey) {
 if (type === 'IN') {
   if (row && row['Punch In Time'] instanceof Date) {
     if (String(row['In Request Key']) === reqKey) return 'DUP';
     fail_('You have already punched in today at ' + attTime_(row['Punch In Time']) + '.');
   }
 } else {
   if (!row || !(row['Punch In Time'] instanceof Date)) fail_('Please punch in first.');
   if (row['Punch Out Time'] instanceof Date) {
     if (String(row['Out Request Key']) === reqKey) return 'DUP';
     fail_('You have already punched out today at ' + attTime_(row['Punch Out Time']) + '.');
   }
 }
 return 'OK';
}
function attSavePhoto_(photo, emp, ymd, type) {
 const b64 = photo && typeof photo.data === 'string' ? photo.data : '';
 if (b64.length < 400) fail_('The selfie is missing. Please take the photo again.');
 if (b64.length > 400000) fail_('The photo is too large. Please take it again.');
 let bytes;
 try { bytes = Utilities.base64Decode(b64); } catch (e) { fail_('The photo could not be read. Please take it again.'); }
 const b = bytes.slice(0, 3).map(x => x & 255);
 if (bytes.length < 300 || !(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) fail_('The photo must be a JPEG image. Please take it again.');
 const file = DriveApp.getFolderById(attFolderId_()).createFile(Utilities.newBlob(bytes, 'image/jpeg', emp['Employee ID'] + '_' + ymd + '_' + type + '.jpg'));
 return { id: file.getId(), url: file.getUrl() };
}
function attPunch_(ctx, p) {
 const emp = ctx.emp, empId = String(emp['Employee ID']);
 const type = String(p.type || '').toUpperCase();
 if (type !== 'IN' && type !== 'OUT') fail_('Invalid punch type.');
if (type === 'OUT' && punchInOnly_(emp)) fail_('Punch-out is not needed for your account. Punching in is enough.');
 const reqKey = String(p.requestId || '').slice(0, 60);
 if (reqKey.length < 8) fail_('Invalid request. Please refresh the page and try again.');
 if (!throttle_('PUNCH_' + empId, 12, 600)) fail_('Too many attempts. Please wait a few minutes.', 'LOCK');


 // browser values are only the raw GPS reading; time and distance are never taken from the browser
 const lat = parseFloat(p.lat), lng = parseFloat(p.lng), acc = parseFloat(p.accuracy);
 const locOk = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
 if (!locOk && !p.noLocation) fail_('Your location could not be read. Turn on location and try again, or choose to continue without location.', 'NOLOC');


 const ymd = iso_(new Date());
 const pre = attFindRow_(empId, ymd);
 if (attCheckState_(pre, type, reqKey) === 'DUP')
   return plain_({ duplicate: true, message: 'This punch was already saved.', today: attDayOut_(pre, ymd, ymd) });


 const photo = attSavePhoto_(p.photo, emp, ymd, type);     // before the lock, so slow Drive work does not block others
 let res = null;
 try {
   withLock_(() => {
     const row = attFindRow_(empId, ymd);
     if (attCheckState_(row, type, reqKey) === 'DUP') { res = { duplicate: true, today: attDayOut_(row, ymd, ymd) }; return; }
     const now = new Date(), off = attOffice_();           // SERVER time
     let dist = '', flag = '';
     if (!locOk) flag = 'Location unavailable';
     else if (!off.set) flag = 'Office location not set';
     else {
       dist = attDistance_(lat, lng, off.lat, off.lng);
       const maxAcc = 100;   // metres. GPS worse than this is flagged "Weak GPS"
       if (dist > off.radius) flag = 'Outside premises';
       else if (!isFinite(acc) || acc > maxAcc) flag = 'Weak GPS';
     
     }
     let saved = null;
     const P = type === 'IN' ? 'In' : 'Out', rnd = x => Math.round(x * 1e6) / 1e6;
     const ch = {};
     ch['Punch ' + P + ' Time'] = now;
     ch[P + ' Lat'] = locOk ? rnd(lat) : ''; ch[P + ' Lng'] = locOk ? rnd(lng) : '';
     ch[P + ' Accuracy'] = (locOk && isFinite(acc)) ? Math.round(acc) : '';
     ch[P + ' Distance (m)'] = dist; ch[P + ' Photo File ID'] = photo.id; ch[P + ' Photo URL'] = photo.url;
     ch[P + ' Flag'] = flag; ch[P + ' Request Key'] = reqKey; ch['Updated At'] = now;
     // every day with a punch waits for Admin approval (ATTENDANCE_APPROVAL = ALL) or only when flagged (FLAGGED_ONLY)
let auto = null;
if (punchInOnly_(emp) && type === 'IN' && S_('ATTENDANCE_APPROVAL') !== 'ALL' && !flag && dist !== '') {
 auto = { 'Status': 'Present', 'Approval Status': 'Approved', 'Approved By': 'Auto', 'Approved At': now,
   'Approval Remarks': 'Auto-approved: punch-in inside the office (punch-in-only employee)' };
}
     if (row) {
       if (type === 'IN' && !row['Status']) { ch['Status'] = 'Pending approval'; ch['Approval Status'] = 'Pending'; }
       if (auto) Object.assign(ch, auto);
       if (type === 'OUT' && row['Status'] === 'Pending approval') {
 const mode = S_('ATTENDANCE_APPROVAL');
 const inT = row['Punch In Time'];
 const worked = inT instanceof Date ? (now.getTime() - inT.getTime()) / 3600000 : 0;
 const minH = SN_('ATTENDANCE_MIN_HOURS') || 9;
 const clean = !attCleanFlag_(row['In Flag']) && !flag && dist !== '';
 const hoursOk = worked >= minH;
 if (clean && (mode === 'FLAGGED_ONLY' || (mode === 'AUTO_HOURS' && hoursOk))) {
   ch['Status'] = 'Present'; ch['Approval Status'] = 'Approved'; ch['Approved By'] = 'Auto'; ch['Approved At'] = now;
   ch['Approval Remarks'] = mode === 'AUTO_HOURS'
     ? 'Auto-approved: both punches inside the office and ' + attHours_(inT, now) + ' worked (minimum ' + minH + ' h)'
     : 'Auto-approved: both punches inside the office area';
 }
}
       updateObj_('ATT', row._row, ch);
       saved = Object.assign({}, row, ch);
     }
     else {
       saved = Object.assign({ 'Attendance ID': uid_('ATT'), 'Employee ID': empId, 'Employee Name': emp['Employee Name'],
         'Date': parseYmd_(ymd), 'Status': 'Pending approval', 'Approval Status': 'Pending', 'Created At': now }, ch, auto || {});
       appendObj_('ATT', saved);
     }
     log_(ctx, 'ATTENDANCE_PUNCH_' + type, 'ATTENDANCE', saved ? saved['Attendance ID'] : '', '', { distance: dist, flag: flag, accuracy: ch[P + ' Accuracy'] }, flag || 'Inside premises', 'SUCCESS');
     res = { duplicate: false, today: attDayOut_(saved, ymd, ymd) };
   });
 } catch (e) {
   try { DriveApp.getFileById(photo.id).setTrashed(true); } catch (x) { /* ignore */ }
   throw e;
 }
 if (res.duplicate) {
   try { DriveApp.getFileById(photo.id).setTrashed(true); } catch (x) { /* ignore */ }
   res.message = 'This punch was already saved.';
   return plain_(res);
 }
 const d = res.today, flagNow = type === 'IN' ? d.inFlag : d.outFlag;
 res.message = (type === 'IN' ? 'Punched in at ' + d.inTime : 'Punched out at ' + d.outTime) + '.' +
   (flagNow ? ' Saved with a flag for Admin review: ' + flagNow + '.' : '');
 return plain_(res);
}


/** Owner runs from the editor to check the maths and settings without the web app. */
function attSelfTest() {
 assertOwnerRun_();
 const off = attOffice_(), out = [];
 out.push('Office set: ' + off.set + ' (' + off.lat + ', ' + off.lng + '), radius ' + off.radius + ' m');
 out.push('Distance for 1 degree of latitude (expect about 111195): ' + attDistance_(0, 0, 1, 0));
 const emp = readAll_('EMP').filter(e => e['Status'] === 'Active')[0];
 if (emp) { const t = today_(), mo = attMonthData_(emp, t.getFullYear(), t.getMonth() + 1); out.push(emp['Employee Name'] + ' summary: ' + JSON.stringify(mo.summary)); }
 const msg = out.join('\n');
 Logger.log(msg);
 return msg;
}
function attCleanFlag_(f) { f = String(f || ''); return f === 'Near boundary' ? '' : f; }

