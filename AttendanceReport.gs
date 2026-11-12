/**
* AttendanceReport.gs
*/
const REG_CODE_ = { 'Present': 'P', 'Pending approval': 'PA', 'Half day': 'H', 'Absent': 'A', 'CL': 'CL', 'SL': 'SL',
 'Other leave': 'OL', 'Unauthorized leave': 'UL', 'Paid holiday': 'PH', 'Weekly off': 'W' };


function attFinal_(ym) {
 try { const s = PropertiesService.getScriptProperties().getProperty('ATTFIN_' + ym); return s ? JSON.parse(s) : null; }
 catch (e) { return null; }
}
/** Call with a yyyy-mm-dd date. Stops any change inside a finalized month. */
function attAssertOpen_(ymd) {
 const ym = String(ymd).slice(0, 7);
 if (attFinal_(ym)) fail_('Attendance for ' + MONTHS_LONG_[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4) + ' is finalized. Ask the Owner to reopen the month first.');
}
function attParseMonth_(p) {
 const t = today_();
 let y = t.getFullYear(), m = t.getMonth() + 1;
 const mm = /^(\d{4})-(\d{2})$/.exec(String(p.month || ''));
 if (mm) { y = Number(mm[1]); m = Number(mm[2]); }
 if (m < 1 || m > 12 || y < 2020) fail_('Please choose a valid month.');
 if (y > t.getFullYear() || (y === t.getFullYear() && m > t.getMonth() + 1)) { y = t.getFullYear(); m = t.getMonth() + 1; }
 return { y: y, m: m, ym: y + '-' + pad_(m, 2) };
}


/** One read of every sheet, then one row per employee. */
function attRegisterData_(y, m) {
 const todayIso = iso_(new Date()), n = new Date(y, m, 0).getDate();
 const firstIso = iso_(new Date(y, m - 1, 1)), lastIso = iso_(new Date(y, m, 0));
 const hol = {}, rowsBy = {}, leaveBy = {};
 readAll_('HOL').forEach(h => { if (h['Status'] === 'Active' && h['Holiday Date'] instanceof Date) hol[iso_(h['Holiday Date'])] = String(h['Holiday Name']); });
 const wo = DOW_.indexOf(S_('WEEKLY_OFF') || 'Sunday'), woi = wo < 0 ? 0 : wo;
 readAll_('ATT').forEach(r => {
   if (!(r['Date'] instanceof Date)) return;
   const k = iso_(r['Date']);
   if (k < firstIso || k > lastIso) return;
   const id = String(r['Employee ID']);
   (rowsBy[id] = rowsBy[id] || {})[k] = r;
 });
 readAll_('APP').forEach(a => {
   if (a['Status'] !== 'APPROVED' || !(a['From Date'] instanceof Date) || !(a['To Date'] instanceof Date)) return;
   if (iso_(a['To Date']) < firstIso || iso_(a['From Date']) > lastIso) return;
   const id = String(a['Employee ID']);
   leaveDays_(a['From Date'], a['To Date']).forEach(d => {
     const k = iso_(d);
     if (k >= firstIso && k <= lastIso) (leaveBy[id] = leaveBy[id] || {})[k] = a['Leave Type'];
   });
 });
 const unaBy = {}, um = unaDateMap_();
 Object.keys(um).forEach(k => { const q = k.split('|'); if (q[1] >= firstIso && q[1] <= lastIso) (unaBy[q[0]] = unaBy[q[0]] || {})[q[1]] = um[k]; });
 const days = [];
 for (let i = 1; i <= n; i++) { const d = new Date(y, m - 1, i); days.push({ day: i, dow: d.getDay(), date: iso_(d) }); }
 const rows = [];
 readAll_('EMP').forEach(e => {
   const id = String(e['Employee ID']);
   if (e['Status'] === 'Deleted') return;
   if (e['Status'] !== 'Active' && !rowsBy[id]) return;
   const joining = e['Joining Date'] instanceof Date ? iso_(e['Joining Date']) : '';
   if (joining && joining > lastIso) return;
   const c = { rows: rowsBy[id] || {}, leave: leaveBy[id] || {}, una: unaBy[id] || {}, hol: hol, wo: woi, joining: joining };
   const t = { present: 0, absent: 0, half: 0, cl: 0, sl: 0, ol: 0, holidays: 0, weekOff: 0, pending: 0, ul: 0 };
   const codes = days.map(dd => {
     const st = attStatusOf_(c, new Date(y, m - 1, dd.day), dd.date, todayIso);
     if (st === 'Present') t.present += 1;
     else if (st === 'Pending approval') t.pending += 1;
     else if (st === 'Half day') { t.present += 0.5; t.absent += 0.5; t.half += 1; }
     else if (st === 'Unauthorized leave') t.ul += 1;
     else if (st === 'Absent') t.absent += 1;
     else if (st === 'CL') t.cl += 1;
     else if (st === 'SL') t.sl += 1;
     else if (st === 'Other leave') t.ol += 1;
     else if (st === 'Paid holiday') t.holidays += 1;
     else if (st === 'Weekly off') t.weekOff += 1;
     return REG_CODE_[st] || '';
   });
   rows.push({ id: id, name: String(e['Employee Name']), dept: String(e['Department'] || ''), status: String(e['Status']), c: codes, t: t });
 });
 rows.sort((a, b) => a.name.localeCompare(b.name));
 return { days: days, rows: rows, pending: rows.reduce((s, r) => s + r.t.pending, 0), ended: lastIso < todayIso };
}


function adminAttRegister_(ctx, p) {
 const pm = attParseMonth_(p), d = attRegisterData_(pm.y, pm.m), t = today_();
 const prev = new Date(pm.y, pm.m - 2, 1), next = new Date(pm.y, pm.m, 1);
 const key = x => x.getFullYear() + '-' + pad_(x.getMonth() + 1, 2);
 const isCur = pm.y === t.getFullYear() && pm.m === t.getMonth() + 1;
 return plain_({
   month: pm.ym, label: MONTHS_LONG_[pm.m - 1] + ' ' + pm.y, prev: key(prev), next: isCur ? '' : key(next),
   days: d.days, rows: d.rows, pending: d.pending, ended: d.ended, finalized: attFinal_(pm.ym), owner: ctx.adminRole === 'OWNER'
 });
}


function adminAttFinalize_(ctx, p) {
 needOwner_(ctx);
 const pm = attParseMonth_(p);
 let msg = '';
 withLock_(() => {
   if (attFinal_(pm.ym)) fail_('This month is already finalized.');
   const d = attRegisterData_(pm.y, pm.m);
   if (!d.ended) fail_('A month can be finalized only after it has ended.');
   if (d.pending > 0) fail_(d.pending + ' day(s) are still waiting for approval. Approve or adjust them first (Pending approval tab).');
   const rec = { by: ctx.email, at: dt_(new Date()), ts: Date.now(), employees: d.rows.length };
   PropertiesService.getScriptProperties().setProperty('ATTFIN_' + pm.ym, JSON.stringify(rec));
   penSnapSave_(pm.ym, pm.y, pm.m);
   log_(ctx, 'ATTENDANCE_MONTH_FINALIZED', 'ATTENDANCE', pm.ym, '', rec, 'Month finalized', 'SUCCESS');
   msg = MONTHS_LONG_[pm.m - 1] + ' ' + pm.y + ' finalized. Its attendance can no longer be changed unless the Owner reopens it.';
 });
 return { message: msg };
}


function adminAttReopen_(ctx, p) {
 needOwner_(ctx);
 const pm = attParseMonth_(p), reason = String(p.reason || '').trim();
 if (reason.length < 3) fail_('Please enter the reason for reopening.');
 withLock_(() => {
   const f = attFinal_(pm.ym);
   if (!f) fail_('This month is not finalized.');
   PropertiesService.getScriptProperties().deleteProperty('ATTFIN_' + pm.ym);
   PropertiesService.getScriptProperties().deleteProperty('PENSNAP_' + pm.ym);
   log_(ctx, 'ATTENDANCE_MONTH_REOPENED', 'ATTENDANCE', pm.ym, f, '', reason, 'SUCCESS');
 });
 return { message: 'Month reopened. Finalize it again after the corrections.' };
}

