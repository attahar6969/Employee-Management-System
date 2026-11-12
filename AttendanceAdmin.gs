/**
* AttendanceAdmin.gs
*/


/** Everything needed to decide the status of ONE date for ALL employees, read once. */
function attBulkContext_(ymd) {
 const hol = {}, leave = {}, rows = {};
 readAll_('HOL').forEach(h => { if (h['Status'] === 'Active' && h['Holiday Date'] instanceof Date) hol[iso_(h['Holiday Date'])] = String(h['Holiday Name']); });
 readAll_('APP').forEach(a => {
   if (a['Status'] !== 'APPROVED' || !(a['From Date'] instanceof Date) || !(a['To Date'] instanceof Date)) return;
   if (iso_(a['From Date']) > ymd || iso_(a['To Date']) < ymd) return;
   if (leaveDays_(a['From Date'], a['To Date']).some(d => iso_(d) === ymd)) leave[String(a['Employee ID'])] = a['Leave Type'];
 });
 readAll_('ATT').forEach(r => { if (r['Date'] instanceof Date && iso_(r['Date']) === ymd) rows[String(r['Employee ID'])] = r; });
 const wo = DOW_.indexOf(S_('WEEKLY_OFF') || 'Sunday');
 const una = {}, um = unaDateMap_();
 Object.keys(um).forEach(k => { const q = k.split('|'); if (q[1] === ymd) una[q[0]] = um[k]; });
 return { hol: hol, leave: leave, rows: rows, una: una, wo: wo < 0 ? 0 : wo };
}


/** [group, label] for the screen. */
function attGroup_(st, ymd, todayIso, joined) {
 if (st === 'Present') return ['present', 'Present'];
 if (st === 'Pending approval') return ['approval', 'Pending approval'];
 if (st === 'Half day') return ['half', 'Half day'];
 if (st === 'Absent') return ['absent', 'Absent'];
 if (st === 'CL') return ['leave', 'Casual leave'];
 if (st === 'SL') return ['leave', 'Sick leave'];
 if (st === 'Other leave') return ['leave', 'Other leave'];
 if (st === 'Unauthorized leave') return ['unauth', 'Unauthorized leave'];
 if (st === 'Paid holiday') return ['holiday', 'Paid holiday'];
 if (st === 'Weekly off') return ['weekoff', 'Weekly off'];
 if (!joined) return ['none', 'Not joined'];
 return ymd === todayIso ? ['pending', 'Not punched yet'] : ['none', '-'];
}
function attIsFlagged_(o, reviewed) {
 return !!(o.inFlag || o.outFlag || o.missingOut) && reviewed !== 'Reviewed';
}


/* ================= DAILY LIST ================= */
function adminAttList_(ctx, p) {
 const todayIso = iso_(new Date());
 let ymd = String(p.date || '').trim();
 if (!parseYmd_(ymd)) ymd = todayIso;
 if (ymd > todayIso) ymd = todayIso;
 const d = parseYmd_(ymd), b = attBulkContext_(ymd);
 const counts = { total: 0, present: 0, approval: 0, half: 0, absent: 0, leave: 0, pending: 0, holiday: 0, weekoff: 0, flagged: 0 };
 const rows = [];
 readAll_('EMP').filter(e => e['Status'] === 'Active').forEach(e => {
   const id = String(e['Employee ID']), r = b.rows[id] || null;
   const joining = e['Joining Date'] instanceof Date ? iso_(e['Joining Date']) : '';
   const c = { rows: {}, leave: {}, hol: b.hol, wo: b.wo, joining: joining };
   c.rows[ymd] = r; if (b.leave[id]) c.leave[ymd] = b.leave[id];
   c.una = {}; if (b.una[id]) c.una[ymd] = b.una[id];
   const st = attStatusOf_(c, d, ymd, todayIso), g = attGroup_(st, ymd, todayIso, !joining || ymd >= joining);
   const o = attDayOut_(r, ymd, todayIso);
   const reviewed = r ? String(r['Review Status'] || '') : '';
   const flagged = attIsFlagged_(o, reviewed);
   rows.push({
     id: id, name: String(e['Employee Name']), dept: String(e['Department'] || ''), status: st, group: g[0], label: g[1],
     inTime: o.inTime, outTime: o.outTime, hours: o.hours, inDist: o.inDist, outDist: o.outDist, inFlag: o.inFlag, outFlag: o.outFlag,
     missingOut: o.missingOut, marked: o.marked, flagged: flagged, reviewed: reviewed
   });
   counts.total++; if (counts[g[0]] !== undefined) counts[g[0]]++; if (flagged) counts.flagged++;
 });
 rows.sort((a, b2) => a.name.localeCompare(b2.name));
 return plain_({ date: ymd, today: todayIso, pendingTotal: attPendingRows_(todayIso).length, dateText: Utilities.formatDate(d, tz_(), 'EEE, d MMM yyyy'), counts: counts, rows: rows });
}


/* ================= FLAGGED PUNCHES ================= */
function adminAttFlags_(ctx, p) {
 const t = today_(), todayIso = iso_(t);
 let to = parseYmd_(p.to) ? String(p.to) : todayIso;
 let from = parseYmd_(p.from) ? String(p.from) : iso_(addDays_(t, -30));
 if (to > todayIso) to = todayIso;
 if (from > to) from = to;
 if ((parseYmd_(to) - parseYmd_(from)) / 86400000 > 366) fail_('Please choose a period of at most one year.');
 const showReviewed = !!p.showReviewed, list = [];
 readAll_('ATT').forEach(r => {
   if (!(r['Date'] instanceof Date)) return;
   const ymd = iso_(r['Date']);
   if (ymd < from || ymd > to) return;
   const o = attDayOut_(r, ymd, todayIso), reviewed = String(r['Review Status'] || '');
   if (!(o.inFlag || o.outFlag || o.missingOut)) return;
   if (reviewed === 'Reviewed' && !showReviewed) return;
   list.push({
     attId: r['Attendance ID'], empId: r['Employee ID'], name: r['Employee Name'], date: ymd, inTime: o.inTime, outTime: o.outTime,
     inDist: o.inDist, outDist: o.outDist, inFlag: o.inFlag, outFlag: o.outFlag, missingOut: o.missingOut,
     reviewed: reviewed === 'Reviewed', reviewedBy: String(r['Reviewed By'] || ''), reviewRemarks: String(r['Review Remarks'] || '')
   });
 });
 list.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.name).localeCompare(String(b.name)));
 return plain_({ from: from, to: to, showReviewed: showReviewed, list: list.slice(0, 400), more: list.length > 400 });
}


/* ================= ONE DAY: details ================= */
function adminAttDetail_(ctx, p) {
 const emp = getEmpById_(p.empId);
 if (!emp) fail_('Employee not found.');
 const ymd = String(p.date || '').trim(), d = parseYmd_(ymd);
 if (!d) fail_('Invalid date.');
 const todayIso = iso_(new Date());
 const c = attContext_(emp, d.getFullYear(), d.getMonth() + 1);
 const st = attStatusOf_(c, d, ymd, todayIso), g = attGroup_(st, ymd, todayIso, !c.joining || ymd >= c.joining);
 const r = attFindRow_(emp['Employee ID'], ymd), o = attDayOut_(r, ymd, todayIso);
 return plain_({
   emp: { id: emp['Employee ID'], name: emp['Employee Name'], dept: emp['Department'], desig: emp['Designation'], status: emp['Status'] },
   date: ymd, dateText: Utilities.formatDate(d, tz_(), 'EEE, d MMM yyyy'), status: st, label: g[1], holiday: c.hol[ymd] || '', day: o,
   attId: r ? r['Attendance ID'] : '', markedBy: r ? String(r['Marked By'] || '') : '', markReason: r ? String(r['Mark Reason'] || '') : '',
   markedAt: r ? dt_(r['Marked At']) : '', reviewed: r ? String(r['Review Status'] || '') === 'Reviewed' : false,
   reviewedBy: r ? String(r['Reviewed By'] || '') : '', reviewRemarks: r ? String(r['Review Remarks'] || '') : '',
   flagged: attIsFlagged_(o, r ? String(r['Review Status'] || '') : ''),
   pending: st === 'Pending approval' && !!r, approval: o.approval, approvalNote: o.approvalNote,
   approvedBy: r ? String(r['Approved By'] || '') : '', approvedAt: r ? dt_(r['Approved At']) : '',
   canMark: emp['Status'] === 'Active' && ymd <= todayIso && (!c.joining || ymd >= c.joining)
 });
}


/* ================= SELFIE (admin view, logged) ================= */
function adminAttPhoto_(ctx, p) {
 const ymd = String(p.date || ''), type = String(p.type || '').toUpperCase();
 if (!parseYmd_(ymd) || (type !== 'IN' && type !== 'OUT')) fail_('Invalid request.');
 const r = attFindRow_(p.empId, ymd);
 const id = r ? r[type === 'IN' ? 'In Photo File ID' : 'Out Photo File ID'] : '';
 if (!id) fail_('No photo for this punch.');
 let blob;
 try { blob = DriveApp.getFileById(id).getBlob(); } catch (e) { fail_('The photo could not be opened from Drive.'); }
 log_(ctx, 'ATTENDANCE_PHOTO_VIEWED', 'ATTENDANCE', r['Attendance ID'], '', { type: type }, '', 'SUCCESS');
 return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}


/* ================= MARK Present / Absent / Half day (Owner and Admin) ================= */
function adminAttMark_(ctx, p) {
 const want = String(p.status || '').trim();
 if (['Present', 'Absent', 'Half day', 'AUTO'].indexOf(want) < 0) fail_('Please choose Present, Absent or Half day.');
 const reason = String(p.reason || '').trim();
 if (reason.length < 3) fail_('Please enter the reason (at least 3 characters).');
 if (reason.length > 300) fail_('The reason is too long (maximum 300 characters).');
 let msg = '';
 withLock_(() => {
   const emp = getEmpById_(p.empId);
   if (!emp) fail_('Employee not found.');
   if (emp['Status'] !== 'Active') fail_('Attendance can be marked only for Active employees.');
   const ymd = String(p.date || '').trim(), d = parseYmd_(ymd), todayIso = iso_(new Date());
   if (!d) fail_('Invalid date.');
   if (ymd > todayIso) fail_('Attendance cannot be marked for a future date.');
   attAssertOpen_(ymd);
   const joining = emp['Joining Date'] instanceof Date ? iso_(emp['Joining Date']) : '';
   if (joining && ymd < joining) fail_('This date is before the employee joined (' + dmy_(emp['Joining Date']) + ').');
   const row = attFindRow_(emp['Employee ID'], ymd);
   const c = attContext_(emp, d.getFullYear(), d.getMonth() + 1);
   const before = attStatusOf_(c, d, ymd, todayIso) || '-', now = new Date();
   const hadPunch = !!(row && row['Punch In Time'] instanceof Date);
   const flagged = !!row && attIsFlagged_(attDayOut_(row, ymd, todayIso), String(row['Review Status'] || ''));
   const ch = { 'Updated At': now };
   let after = want;
   if (want === 'AUTO') {
     if (!row || !row['Marked By']) fail_('This day has no Admin mark to remove.');
     after = hadPunch ? 'Pending approval' : '';
     ch['Status'] = after; ch['Marked By'] = ''; ch['Mark Reason'] = ''; ch['Marked At'] = '';
     if (hadPunch) { ch['Approval Status'] = 'Pending'; ch['Approved By'] = ''; ch['Approved At'] = ''; ch['Approval Remarks'] = ''; }
   } else {
     if (before === want && !(row && row['Marked By'])) fail_('This day is already shown as ' + want + '. Nothing to change.');
     ch['Status'] = want; ch['Marked By'] = ctx.email; ch['Mark Reason'] = reason; ch['Marked At'] = now;
     if (row && row['Status'] === 'Pending approval') { ch['Approval Status'] = want === 'Present' ? 'Approved' : 'Adjusted'; ch['Approved By'] = ctx.email; ch['Approved At'] = now; ch['Approval Remarks'] = reason; }
   }
   if (flagged) { ch['Review Status'] = 'Reviewed'; ch['Reviewed By'] = ctx.email; ch['Reviewed At'] = now; ch['Review Remarks'] = 'Resolved by marking ' + (after || 'automatic') + ': ' + reason; }
   let id;
   if (row) { updateObj_('ATT', row._row, ch); id = row['Attendance ID']; }
   else {
     id = uid_('ATT');
     appendObj_('ATT', Object.assign({ 'Attendance ID': id, 'Employee ID': emp['Employee ID'], 'Employee Name': emp['Employee Name'], 'Date': d, 'Created At': now }, ch));
   }
   log_(ctx, want === 'AUTO' ? 'ATTENDANCE_MARK_REMOVED' : 'ATTENDANCE_MARKED', 'ATTENDANCE', id,
     { employee: emp['Employee ID'], date: ymd, status: before }, { status: after || 'automatic' }, reason, 'SUCCESS');
   msg = want === 'AUTO' ? 'Admin mark removed. The day now follows the punches and leave records.'
     : emp['Employee Name'] + ' marked ' + want + ' for ' + dmy_(d) + '.';
 });
 return { message: msg };
}


/* ================= REVIEW a flagged punch ================= */
function adminAttReview_(ctx, p) {
 const remarks = String(p.remarks || '').trim();
 if (remarks.length < 3) fail_('Please enter a short remark for the review.');
 withLock_(() => {
   const r = readAll_('ATT').filter(x => String(x['Attendance ID']) === String(p.id))[0];
   if (!r) fail_('Attendance record not found.');
   updateObj_('ATT', r._row, { 'Review Status': 'Reviewed', 'Reviewed By': ctx.email, 'Reviewed At': new Date(), 'Review Remarks': remarks, 'Updated At': new Date() });
   log_(ctx, 'ATTENDANCE_FLAG_REVIEWED', 'ATTENDANCE', r['Attendance ID'], '', { employee: r['Employee ID'], date: iso_(r['Date']) }, remarks, 'SUCCESS');
 });
 return { message: 'Marked as reviewed.' };
}


/* ================= APPROVAL of punched days (Owner and Admin) ================= */
/** Days with a punch that still wait for approval. A day is listed after punch-out, or once the day is over (punch-out missing). */
function attPendingRows_(todayIso) {
 return readAll_('ATT').filter(r => r['Date'] instanceof Date && String(r['Status']) === 'Pending approval');
}
function adminAttPending_(ctx, p) {
 const todayIso = iso_(new Date()), list = [];
 attPendingRows_(todayIso).forEach(r => {
   const ymd = iso_(r['Date']), o = attDayOut_(r, ymd, todayIso);
   list.push({
     attId: r['Attendance ID'], empId: r['Employee ID'], name: r['Employee Name'], date: ymd, inTime: o.inTime, outTime: o.outTime, hours: o.hours,
     inDist: o.inDist, outDist: o.outDist, inFlag: o.inFlag, outFlag: o.outFlag, missingOut: o.missingOut,
     pio: !!pioIds_()[String(r['Employee ID'])]
   });
 });
 list.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name)));
 return plain_({ list: list.slice(0, 500), total: list.length, more: list.length > 500 });
}
/** p.ids = Attendance IDs, p.status = Present (approve) / Half day / Absent (adjust, reason mandatory). */
function adminAttApprove_(ctx, p) {
 const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
 if (!ids.length) fail_('Please select at least one day.');
 if (ids.length > 200) fail_('Please approve at most 200 days at a time.');
 const want = String(p.status || 'Present').trim();
 if (['Present', 'Half day', 'Absent'].indexOf(want) < 0) fail_('Please choose Present, Half day or Absent.');
 const reason = String(p.reason || '').trim();
 if (want !== 'Present' && reason.length < 3) fail_('Please enter the reason for the adjustment.');
 if (want !== 'Present' && ids.length > 1) fail_('An adjustment can be saved for one day at a time.');
 if (reason.length > 300) fail_('The reason is too long (maximum 300 characters).');
 let done = 0, skipped = 0;
 withLock_(() => {
   const byId = {};
   readAll_('ATT').forEach(r => { byId[String(r['Attendance ID'])] = r; });
   const now = new Date();
   ids.forEach(id => {
     const r = byId[id];
     if (!r || String(r['Status']) !== 'Pending approval') { skipped++; return; }
     const ymd = iso_(r['Date']), flagged = attIsFlagged_(attDayOut_(r, ymd, iso_(now)), String(r['Review Status'] || ''));
     const ch = { 'Status': want, 'Approval Status': want === 'Present' ? 'Approved' : 'Adjusted', 'Approved By': ctx.email, 'Approved At': now,
       'Approval Remarks': reason, 'Updated At': now };
     if (flagged) { ch['Review Status'] = 'Reviewed'; ch['Reviewed By'] = ctx.email; ch['Reviewed At'] = now; ch['Review Remarks'] = (want === 'Present' ? 'Approved' : 'Adjusted to ' + want) + (reason ? ': ' + reason : ''); }
     updateObj_('ATT', r._row, ch);
     log_(ctx, want === 'Present' ? 'ATTENDANCE_APPROVED' : 'ATTENDANCE_ADJUSTED', 'ATTENDANCE', r['Attendance ID'],
       { employee: r['Employee ID'], date: ymd, status: 'Pending approval' }, { status: want }, reason, 'SUCCESS');
     done++;
   });
 });
 if (!done) fail_('Nothing to approve. These days may already have been decided.');
 return { message: (want === 'Present' ? done + ' day(s) approved as Present.' : 'Day adjusted to ' + want + '.') + (skipped ? ' ' + skipped + ' skipped (already decided).' : ''), done: done, skipped: skipped };
}

