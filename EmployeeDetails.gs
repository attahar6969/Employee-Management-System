/**
* EmployeeDetails.gs  
*/


const KE_GROUPS_ = [
 ['Candidate Details', ['Full Name', 'Father/Spouse', 'DOB', 'Gender', 'Mobile', 'Email', 'Address', 'Aadhaar', 'PAN', 'EC Name', 'EC Phone']],
 ['Bank Details', ['Bank Name', 'Account No', 'IFSC', 'Branch']],
 ['Job Details', ['Employee ID', 'Designation', 'Department', 'Manager', 'Joining Date', 'Emp Type', 'Probation', 'Contract End Date',
   'Place of Work', 'Work Hours', 'Weekly Off', 'Notice Period']],
 ['Compensation', ['Gross Salary', 'Pay Date', 'Pay Mode', 'Bonus']],
 ['Other Details', ['Assets Issued', 'Agreement Date', 'Signatory']],
 ['System (automatic)', ['Agreement ID', 'Review Date', 'Status', 'Doc Link', 'Updated']]
];
/** Fields hidden from normal admins. Empty = everyone with admin access sees everything. */
const KE_SENSITIVE_ = [];
/** Values never written to the System Log in plain text. */
const KE_NOLOG_ = ['Gross Salary', 'Pay Date', 'Pay Mode', 'Bonus', 'Bank Name', 'Account No', 'IFSC', 'Branch', 'Aadhaar', 'PAN'];
const KE_READONLY_ = ['Agreement ID', 'Employee ID', 'Status', 'Doc Link', 'Updated'];
const KE_DATES_ = ['Joining Date', 'Contract End Date', 'Agreement Date', 'Review Date'];
const KE_TEXTCELL_ = ['Mobile', 'EC Phone', 'Aadhaar', 'Account No'];      // always stored as text
const KE_LONG_ = ['Address', 'Assets Issued'];


const KE_LABELS_ = {
 'Father/Spouse': 'Father / Spouse Name', 'DOB': 'Date of Birth', 'Address': 'Present Address', 'Aadhaar': 'Aadhaar Number',
 'PAN': 'PAN Number', 'EC Name': 'Emergency Contact Name', 'EC Phone': 'Emergency Mobile', 'IFSC': 'IFSC Code',
 'Manager': 'Reporting Manager', 'Joining Date': 'Date of Joining', 'Emp Type': 'Employment Type', 'Probation': 'Probation Period',
 'Work Hours': 'Working Hours', 'Gross Salary': 'Gross Salary (Rs.)', 'Pay Date': 'Payment Date', 'Pay Mode': 'Payment Mode',
 'Bonus': 'Bonus / Incentive', 'Signatory': 'Authorized Signatory', 'Review Date': 'Review Date (auto: joining + 1 year)'
};
/** Fixed dropdown lists. Designation is NOT here: it comes from Settings > Employees > Designation List. */
const KE_FIXED_ = {
 'Gender': ['Male', 'Female', 'Other'],
 'Emp Type': ['Probationary', 'Permanent', 'Fixed-Term', 'Trainee'],
 'Probation': ['3 Months', '6 Months', '1 Year', 'No Probation'],
 'Weekly Off': ['Sunday', 'Saturday', 'Saturday & Sunday', 'As per roster'],
 'Notice Period': ['15 Days', '30 Days', '45 Days', '60 Days'],
 'Pay Date': ['1st of every month', '5th of every month', '7th of every month', '10th of every month'],
 'Pay Mode': ['Bank Transfer / NEFT', 'UPI / GPay', 'Cash', 'Cheque']
};
/** Free-text fields that also have a list (an "Other" choice is offered). */
const KE_FREE_LIST_ = ['Designation'];
const KE_REQUIRED_NEW_ = ['Full Name', 'Mobile', 'Aadhaar', 'Address', 'EC Name', 'EC Phone', 'Designation', 'Joining Date', 'Gross Salary', 'Agreement Date'];
/** Typing rules in the form: digits only (with max length) or upper case. */
const KE_INPUT_ = { 'Mobile': { digits: 10 }, 'EC Phone': { digits: 10 }, 'Aadhaar': { digits: 12 }, 'PAN': { upper: true }, 'IFSC': { upper: true } };


/* ---------------- settings-driven helpers ---------------- */
function designationList_() {
 return S_('DESIGNATION_LIST').split(',').map(x => x.trim()).filter(x => x);
}
function idPrefix_() {
 return (S_('EMP_ID_PREFIX') || 'EMP').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'EMP';
}
function keDefaults_() {
 return {
   'Gender': 'Male', 'Manager': S_('DEFAULT_MANAGER'), 'Place of Work': S_('DEFAULT_PLACE_OF_WORK'), 'Emp Type': 'Probationary',
   'Probation': '3 Months', 'Work Hours': S_('DEFAULT_WORK_HOURS'), 'Weekly Off': 'Sunday', 'Notice Period': '15 Days',
   'Pay Date': '1st of every month', 'Pay Mode': 'Bank Transfer / NEFT', 'Signatory': S_('DEFAULT_SIGNATORY'),
   'Agreement Date': iso_(today_()), 'Status': 'Active'
 };
}


/* ---------------- sheet access (local sheet, no external file) ---------------- */
function keSheet_() {
 const s = ss_().getSheetByName(SH.EMD);
 if (!s) fail_('The EMPLOYEE DETAILS sheet is missing. The Owner must run upgradeToStandalone() (existing system) or setupSystem() (new system) from the script editor.');
 return s;
}
function keDate_(v) {
 if (v instanceof Date) return v;
 const s = String(v || '').trim();
 return s ? (parseYmd_(s) || '') : '';
}
function keAll_() {
 const sh = keSheet_(), lastC = sh.getLastColumn(), lastR = sh.getLastRow();
 const hdr = sh.getRange(1, 1, 1, lastC).getValues()[0].map(h => String(h).trim());
 const col = {};
 hdr.forEach((h, i) => { if (h && col[h] === undefined) col[h] = i + 1; });
 ['Employee ID', 'Full Name', 'Status'].forEach(h => {
   if (!col[h]) fail_('Column "' + h + '" was not found in the EMPLOYEE DETAILS sheet.');
 });
 const vals = lastR > 1 ? sh.getRange(2, 1, lastR - 1, lastC).getValues() : [];
 return { sh: sh, hdr: hdr, col: col, vals: vals };
}
function keStr_(h, v) {
 if (v instanceof Date) return KE_DATES_.indexOf(h) > -1 ? iso_(v) : dt_(v);
 return (v === null || v === undefined) ? '' : String(v).trim();
}
function keNorm_(h, s) {
 s = String(s === null || s === undefined ? '' : s).trim();
 if (h === 'Mobile' || h === 'EC Phone') return s ? normPhone_(s) : '';
 if (h === 'Email') return normEmail_(s);
 if (h === 'PAN' || h === 'IFSC') return s.toUpperCase();
 if (h === 'Aadhaar' || h === 'Account No') return s.replace(/\s/g, '');
 return s;
}
/** Allowed values of a dropdown column. */
function keOptions_(sh, c, h) {
 if (h === 'Designation') return designationList_();
 if (h && KE_FIXED_[h]) return KE_FIXED_[h].slice();
 return [];
}
function keSample_(k, h) {
 const c = k.col[h] - 1;
 for (let i = 0; i < k.vals.length; i++) if (k.vals[i][c] !== '') return k.vals[i][c];
 return '';
}
function keWriteCell_(k, row, h, val) {
 const cell = k.sh.getRange(row, k.col[h]);
 if (val === '') { cell.clearContent(); return; }
 if (KE_DATES_.indexOf(h) > -1) {
   if (keSample_(k, h) instanceof Date) cell.setValue(parseYmd_(val));
   else cell.setNumberFormat('@').setValue(val);
   return;
 }
 if (h === 'Gross Salary') { cell.setValue(Number(val)); return; }
 if (KE_TEXTCELL_.indexOf(h) > -1) { cell.setNumberFormat('@').setValue(val); return; }
 cell.setValue(val);
}
function keAddYears_(ymd, n) {
 const d = parseYmd_(ymd);
 if (!d) return '';
 return iso_(new Date(d.getFullYear() + n, d.getMonth(), d.getDate()));
}


/* ---------------- keeping EMPLOYEE MASTER and EMPLOYEE DETAILS together ---------------- */
function detFirstBlankRow_(k) {
 for (let i = 0; i < k.vals.length; i++) { if (k.vals[i].every(x => x === '')) return i + 2; }
 return k.vals.length + 2;
}
/** Makes sure a details row exists for this employee (built from the LMS record). Caller decides about locking. Returns true if created. */
function detEnsure_(id) {
 const emp = getEmpById_(id);
 if (!emp) fail_('Employee not found.');
 const k = keAll_(), iId = k.col['Employee ID'] - 1;
 if (k.vals.some(r => String(r[iId]).trim() === String(id))) return false;
 const r = detFirstBlankRow_(k);
 if (r > k.sh.getMaxRows()) k.sh.insertRowsAfter(k.sh.getMaxRows(), 20);
 const vals = {
   'Employee ID': String(id), 'Full Name': String(emp['Employee Name'] || ''), 'Email': String(emp['Email'] || ''),
   'Mobile': normPhone_(emp['Phone']), 'Department': String(emp['Department'] || ''), 'Designation': String(emp['Designation'] || ''),
   'Joining Date': emp['Joining Date'] instanceof Date ? iso_(emp['Joining Date']) : '', 'Status': emp['Status'] === 'Active' ? 'Active' : 'Inactive'
 };
 Object.keys(vals).forEach(h => { if (vals[h] !== '' && k.col[h]) keWriteCell_(k, r, h, vals[h]); });
 return true;
}
/** Writes some fields of one details row. Never throws. Returns true if the row was found. */
function detPatch_(id, map) {
 try {
   const k = keAll_(), iId = k.col['Employee ID'] - 1;
   let row = 0;
   k.vals.forEach((r, i) => { if (!row && String(r[iId]).trim() === String(id)) row = i + 2; });
   if (!row) return false;
   Object.keys(map).forEach(h => { if (k.col[h]) keWriteCell_(k, row, h, map[h]); });
   if (k.col['Updated']) k.sh.getRange(row, k.col['Updated']).setValue(new Date());
   return true;
 } catch (e) { return false; }
}
function detSetStatus_(id, status) { return detPatch_(id, { 'Status': status }); }
/** Permanently removes the details row (personal data, bank, salary) of one employee. Never throws. Returns rows removed. */
function detDeleteRow_(id) {
 try {
   const k = keAll_(), iId = k.col['Employee ID'] - 1, rows = [];
   k.vals.forEach((r, i) => { if (String(r[iId]).trim() === String(id)) rows.push(i + 2); });
   rows.reverse().forEach(r => k.sh.deleteRow(r));
   return rows.length;
 } catch (e) { return 0; }
}


/** Rebuilds the "Review Tracker" tab (now inside the LMS spreadsheet). Never throws. */
function keRefreshReviewTracker_() {
 try {
   const k = keAll_(), ss = k.sh.getParent();
   const H = ['Name', 'Designation', 'Department', 'Joining Date', 'Salary', 'Review Date', 'Days Left', 'Status', 'Agreement ID'];
   const rev = ss.getSheetByName('Review Tracker') || ss.insertSheet('Review Tracker');
   rev.clearContents();
   rev.getRange(1, 1, 1, H.length).setValues([H]).setBackground('#1a3c5e').setFontColor('#fff').setFontWeight('bold');
   rev.setFrozenRows(1);
   const g = (r, h) => k.col[h] ? r[k.col[h] - 1] : '';
   const t0 = new Date(); t0.setHours(0, 0, 0, 0);
   const rows = [];
   k.vals.forEach(r => {
     if (!g(r, 'Full Name')) return;
     const rv = g(r, 'Review Date'), rd = rv ? new Date(rv) : null;
     const diff = (rd && !isNaN(rd)) ? Math.ceil((rd - t0) / 86400000) : null;
     const st = diff === null ? '-' : diff < 0 ? 'OVERDUE' : diff <= 30 ? 'Due Soon' : diff <= 60 ? 'Upcoming' : 'On Track';
     rows.push([g(r, 'Full Name'), g(r, 'Designation'), g(r, 'Department'), g(r, 'Joining Date'), g(r, 'Gross Salary'),
       rv || '-', diff !== null ? diff : '-', st, g(r, 'Agreement ID')]);
   });
   if (rows.length) {
     rev.getRange(2, 1, rows.length, H.length).setValues(rows);
     rows.forEach((r, i) => {
       const bg = r[7] === 'OVERDUE' ? '#f8d7da' : r[7] === 'Due Soon' ? '#fff3cd' : r[7] === 'Upcoming' ? '#fff8e1' : '#ffffff';
       rev.getRange(i + 2, 1, 1, H.length).setBackground(bg);
     });
   }
 } catch (e) {
   log_({ role: 'SYSTEM' }, 'REVIEW_TRACKER_FAILED', 'EMPLOYEE', '', '', '', String(e && e.message ? e.message : e), 'ERROR');
 }
}


/* ================= PROFILE: view / blank form for a new employee ================= */
function adminKeProfile_(ctx, p) {
 const owner = ctx.adminRole === 'OWNER', id = String(p.id || '').trim();
 let k = keAll_();
 if (id && !k.vals.some(r => String(r[k.col['Employee ID'] - 1]).trim() === id)) {
   withLock_(() => { detEnsure_(id); });            // older employees get a details row on first view
   k = keAll_();
 }
 const iId = k.col['Employee ID'] - 1;
 let row = null;
 if (id) {
   const hits = k.vals.filter(r => String(r[iId]).trim() === id);
   if (hits.length !== 1) fail_(hits.length ? 'This Employee ID appears more than once in the EMPLOYEE DETAILS sheet. Fix it there first.' : 'This employee was not found.');
   row = hits[0];
   log_(ctx, 'EMPLOYEE_PROFILE_VIEWED', 'EMPLOYEE', id, '', '', owner ? 'Owner view' : 'Admin view', 'SUCCESS');
 }
 const def = row ? null : keDefaults_(), used = {};
 const mk = h => {
   used[h] = 1;
   const c = k.col[h], restricted = KE_SENSITIVE_.indexOf(h) > -1 && !owner;
   let val = row ? keStr_(h, row[c - 1]) : ((def && def[h]) || '');
   if (restricted) val = '';
   const inp = KE_INPUT_[h] || {};
   return { h: h, label: KE_LABELS_[h] || h, v: val, restricted: restricted,
     ro: KE_READONLY_.indexOf(h) > -1 || (!row && h === 'Review Date'),
     date: KE_DATES_.indexOf(h) > -1, long: KE_LONG_.indexOf(h) > -1, num: h === 'Gross Salary',
     req: !row && KE_REQUIRED_NEW_.indexOf(h) > -1, digits: inp.digits || 0, upper: !!inp.upper,
     freeList: KE_FREE_LIST_.indexOf(h) > -1, end: h === 'Contract End Date', join: h === 'Joining Date',
     opts: restricted ? [] : keOptions_(k.sh, c, h) };
 };
 const groups = [];
 KE_GROUPS_.forEach(g => {
   if (!row && g[0] === 'System (automatic)') return;
   const f = g[1].filter(h => k.col[h]).map(mk);
   if (f.length) groups.push({ title: g[0], fields: f });
 });
 const AUTO_ = ['Agreement ID', 'Review Date', 'Status', 'Doc Link', 'Updated'];
 const other = k.hdr.filter(h => h && !used[h] && (row || AUTO_.indexOf(h) < 0)).map(mk);
 if (other.length) groups.push({ title: 'Additional', fields: other });
 return plain_({ id: id, owner: owner, groups: groups });
}


/* ================= PROFILE: save (edit) or create (new employee) ================= */
function adminKeSaveProfile_(ctx, p) {
 const owner = ctx.adminRole === 'OWNER', id = String(p.id || '').trim();
 const input = (p.values && typeof p.values === 'object') ? p.values : {};
 let msg = '', empId = id, saved = false;
 withLock_(() => {
   if (id) detEnsure_(id);
   const k = keAll_(), iId = k.col['Employee ID'] - 1, emps = readAll_('EMP');
   let rowNo = 0, old = null;
   if (id) {
     const at = [];
     k.vals.forEach((r, i) => { if (String(r[iId]).trim() === id) at.push(i); });
     if (at.length !== 1) fail_(at.length ? 'This Employee ID appears more than once in the EMPLOYEE DETAILS sheet. Fix it there first.' : 'This employee was not found.');
     rowNo = at[0] + 2; old = k.vals[at[0]];
   }
   const oldStr = h => (old && k.col[h]) ? keNorm_(h, keStr_(h, old[k.col[h] - 1])) : '';


   // 1. what the admin typed (editable fields only), then only what really changed
   const nv = {};
   Object.keys(input).forEach(h => {
     if (!k.col[h] || KE_READONLY_.indexOf(h) > -1) return;
     if (KE_SENSITIVE_.indexOf(h) > -1 && !owner) return;
     nv[h] = keNorm_(h, input[h]);
   });
   const wv = {};
   Object.keys(nv).forEach(h => { if (old ? nv[h] !== oldStr(h) : nv[h] !== '') wv[h] = nv[h]; });
   if (old && !Object.keys(wv).length) { msg = 'No changes to save.'; return; }
   const cur = h => (wv[h] !== undefined ? wv[h] : oldStr(h));


   // 2. validation on the final values
   const name = cur('Full Name'), mob = cur('Mobile'), mail = cur('Email');
   if (name.length < 2) fail_('Full name is required.');
   if (!id) {
     if (mob.length !== 10) fail_('Mobile number must be exactly 10 digits.');
     if (!/^\d{12}$/.test(cur('Aadhaar'))) fail_('Aadhaar number must be exactly 12 digits.');
     if (!cur('Address')) fail_('Please enter the Present Address.');
     if (!cur('EC Name')) fail_('Emergency Contact Name is required.');
     if (cur('EC Phone').length !== 10) fail_('Emergency Mobile must be exactly 10 digits.');
     if (!cur('Designation')) fail_('Please select or enter the Designation.');
     if (!cur('Joining Date')) fail_('Please select the Date of Joining.');
     if (!cur('Gross Salary')) fail_('Please enter the Gross Salary.');
     if (!cur('Agreement Date')) fail_('Please select the Agreement Date.');
   } else {
     if (wv['Aadhaar'] && !/^\d{12}$/.test(wv['Aadhaar'])) fail_('Aadhaar number must be exactly 12 digits.');
     if (wv['EC Phone'] && wv['EC Phone'].length !== 10) fail_('Emergency Mobile must be exactly 10 digits.');
   }
   if (!mob && !mail) fail_('Enter a mobile number or an email (needed for employee login).');
   if (mob && mob.length !== 10) fail_('Mobile number must be 10 digits.');
   if (mail && !isEmail_(mail)) fail_('Please enter a valid email address.');
   KE_DATES_.forEach(h => { if (wv[h] && !parseYmd_(wv[h])) fail_('"' + h + '" must be a valid date.'); });
   if (wv['Gross Salary'] && (isNaN(Number(wv['Gross Salary'])) || Number(wv['Gross Salary']) < 0)) fail_('Gross Salary must be a number (zero or more).');
   Object.keys(wv).forEach(h => {
     if (KE_FREE_LIST_.indexOf(h) > -1) return;                  // Designation may be typed ("Other")
     const o = keOptions_(k.sh, k.col[h], h);
     if (wv[h] && o.length && o.indexOf(wv[h]) < 0) fail_('"' + wv[h] + '" is not an allowed value for ' + (KE_LABELS_[h] || h) + '.');
   });
   k.vals.forEach(r => {
     const rid = String(r[iId]).trim();
     if (!rid || rid === id) return;
     if (mob && k.col['Mobile'] && normPhone_(r[k.col['Mobile'] - 1]) === mob) fail_('Another employee (' + rid + ') already uses this mobile number.');
     if (mail && k.col['Email'] && normEmail_(r[k.col['Email'] - 1]) === mail) fail_('Another employee (' + rid + ') already uses this email.');
   });
   emps.forEach(e => {
     if (String(e['Employee ID']) === id) return;
     if (mob && normPhone_(e['Phone']) === mob) fail_('Another employee (' + e['Employee ID'] + ') already uses this mobile number.');
     if (mail && normEmail_(e['Email']) === mail) fail_('Another employee (' + e['Employee ID'] + ') already uses this email.');
   });


   // 3. new employee: next ID (PREFIX-YEAR-001), automatic Review Date, first blank row
   if (!id) {
     const pre = idPrefix_(), yr = today_().getFullYear();
     const re1 = new RegExp('^' + pre + '-(\\d{4})-(\\d+)$'), re2 = new RegExp('^' + pre + '-AGR-(\\d{4})-(\\d+)$');
     const props = PropertiesService.getScriptProperties(), pk = 'EMPSEQ_' + pre + '_' + yr;
     let seq = parseInt(props.getProperty(pk) || '0', 10) || 0;     // remembered, so a purged ID is never reused
     k.vals.forEach(r => {
       const a = re1.exec(String(r[iId]).trim());
       if (a && Number(a[1]) === yr) seq = Math.max(seq, Number(a[2]));
       if (k.col['Agreement ID']) {
         const b = re2.exec(String(r[k.col['Agreement ID'] - 1]).trim());
         if (b && Number(b[1]) === yr) seq = Math.max(seq, Number(b[2]));
       }
     });
     emps.forEach(e => {
       const a = re1.exec(String(e['Employee ID']));
       if (a && Number(a[1]) === yr) seq = Math.max(seq, Number(a[2]));
     });
     seq++;
     props.setProperty(pk, String(seq));
     empId = pre + '-' + yr + '-' + pad_(seq, 3);
     wv['Employee ID'] = empId;
     if (k.col['Agreement ID']) wv['Agreement ID'] = pre + '-AGR-' + yr + '-' + pad_(seq, 3);
     if (k.col['Status']) wv['Status'] = 'Active';
     if (k.col['Review Date'] && !wv['Review Date']) wv['Review Date'] = keAddYears_(wv['Joining Date'], 1);
     const r = detFirstBlankRow_(k);
     if (r > k.sh.getMaxRows()) k.sh.insertRowsAfter(k.sh.getMaxRows(), 20);
     rowNo = r;
   }


   // 4. write to EMPLOYEE DETAILS
   const now = new Date();
   Object.keys(wv).forEach(h => keWriteCell_(k, rowNo, h, wv[h]));
   if (k.col['Updated']) k.sh.getRange(rowNo, k.col['Updated']).setValue(now);


   // 5. mirror the fields the LMS uses (EMPLOYEE MASTER)
   const MAP = { 'Full Name': 'Employee Name', 'Mobile': 'Phone', 'Email': 'Email', 'Department': 'Department', 'Designation': 'Designation' };
   const ch = { 'Updated At': now };
   Object.keys(MAP).forEach(h => { if (wv[h] !== undefined) ch[MAP[h]] = wv[h]; });
   if (wv['Joining Date'] !== undefined) ch['Joining Date'] = keDate_(wv['Joining Date']);
   if (id) {
     const e = emps.filter(x => String(x['Employee ID']) === id)[0];
     if (e) updateObj_('EMP', e._row, ch);
   } else {
     appendObj_('EMP', Object.assign({ 'Employee ID': empId, 'Status': 'Active', 'CL Balance': 0, 'SL Balance': 0, 'Created At': now }, ch));
     ledgerMaintenance_(ctx.email);
   }


   const logv = {};
   Object.keys(wv).forEach(h => { logv[h] = KE_NOLOG_.indexOf(h) > -1 ? '(changed)' : wv[h]; });
   log_(ctx, id ? 'EMPLOYEE_DETAILS_UPDATED' : 'EMPLOYEE_CREATED', 'EMPLOYEE', empId, '', logv,
     id ? 'Employee details saved' : 'New employee created', 'SUCCESS');
   msg = id ? 'Employee details saved.' : 'Employee ' + empId + ' added.';
   saved = true;
 });
 if (saved) keRefreshReviewTracker_();     // never fails the save
 return { message: msg, id: empId };
}


/* ================= BASIC EDIT (Edit button on the Employees list) ================= */
function adminSaveEmployee_(ctx, p) {
 let result = null;
 withLock_(() => {
   const name = String(p.name || '').trim(), email = normEmail_(p.email), phone = normPhone_(p.phone);
   if (name.length < 2) fail_('Employee name is required.');
   if (!email && !phone) fail_('Enter an email or a 10-digit mobile number (needed for employee login).');
   if (email && !isEmail_(email)) fail_('Please enter a valid email address.');
   if (String(p.phone || '').trim() && phone.length !== 10) fail_('Mobile number must be 10 digits.');
   const status = p.status === 'Inactive' ? 'Inactive' : 'Active';
   const emps = readAll_('EMP'), cur = p.id ? emps.filter(e => String(e['Employee ID']) === String(p.id))[0] : null;
   if (!p.id || !cur) fail_('Employee not found. Add new employees with the "+ New employee" button.');
   emps.forEach(e => {
     if (e._row === cur._row) return;
     if (email && normEmail_(e['Email']) === email) fail_('Another employee already uses this email (' + e['Employee ID'] + ').');
     if (phone && normPhone_(e['Phone']) === phone) fail_('Another employee already uses this mobile number (' + e['Employee ID'] + ').');
   });
   const jd = String(p.joiningDate || '').trim() ? parseYmd_(p.joiningDate) : '';
   if (jd === null) fail_('Joining date is not valid.');
   const now = new Date();
   let allowedStr = null;
   if (p.allowed !== undefined) {
     const al = (Array.isArray(p.allowed) ? p.allowed : String(p.allowed).split(','))
       .map(x => String(x).trim().toUpperCase()).filter(x => ['CL', 'SL', 'OTHER'].indexOf(x) > -1);
     allowedStr = al.length ? al.join(',') : 'NONE';
   }
   const data = { 'Employee Name': name, 'Email': email, 'Phone': phone, 'Department': String(p.department || '').trim(),
     'Designation': String(p.designation || '').trim(), 'Joining Date': jd, 'Status': status, 'Updated At': now };
   if (allowedStr !== null) data['Allowed Leaves'] = allowedStr;
   if (p.punchInOnly !== undefined) data['Punch In Only'] = p.punchInOnly ? 'YES' : '';
   const oldV = empOut_(cur);
   updateObj_('EMP', cur._row, data);
   // keep the EMPLOYEE DETAILS row in step (never fails the save)
   try {
     detEnsure_(String(cur['Employee ID']));
     detPatch_(String(cur['Employee ID']), { 'Full Name': name, 'Email': email, 'Mobile': phone, 'Department': data['Department'],
       'Designation': data['Designation'], 'Joining Date': jd ? iso_(jd) : '', 'Status': status });
   } catch (e) { /* details row is repaired on the next view */ }
   log_(ctx, 'EMPLOYEE_UPDATED', 'EMPLOYEE', cur['Employee ID'], oldV, data, '', 'SUCCESS');
   result = { id: cur['Employee ID'], message: 'Employee updated.', status: status };
 });


 // Housekeeping must never turn a successful save red.
 try { withLock_(() => { cleanupLedgerCore_(ctx.email); ledgerMaintenance_(ctx.email); }); }
 catch (e) { log_(ctx, 'POST_SAVE_MAINTENANCE_FAILED', 'EMPLOYEE', result.id, '', '', String(e && e.message ? e.message : e), 'ERROR'); }
 return result;
}


/* ================= ONE-TIME UPGRADE / CLEANUP (Owner runs from the script editor) ================= */
/** Removes the two triggers that watched the KE Employment sheet and the LMS sheet for deleted rows. */
function removeKeTriggers() {
 let n = 0;
 ScriptApp.getProjectTriggers().forEach(t => {
   const f = t.getHandlerFunction();
   if (f === 'keOnKeChange' || f === 'keOnLmsChange') { ScriptApp.deleteTrigger(t); n++; }
 });
 return n;
}
/** Existing system: creates the EMPLOYEE DETAILS sheet, the new settings, a details row for every current employee,
*  and removes the old KE triggers. No data is copied from the KE Employment sheet. Safe to run again. */
function upgradeToStandalone() {
 assertOwnerRun_();
 initializeSheets_(ss_());
 seedSettings_();
 const triggers = removeKeTriggers();
 let made = 0;
 withLock_(() => {
   readAll_('EMP').filter(e => e['Status'] !== 'Deleted').forEach(e => { if (detEnsure_(String(e['Employee ID']))) made++; });
 });
 protectSheets_();
 const props = PropertiesService.getScriptProperties();
 Object.keys(props.getProperties()).forEach(key => {
   if (key.indexOf('TOMB_') === 0 || key === 'KE_ID_SNAP' || key === 'LMS_ID_SNAP') props.deleteProperty(key);
 });
 log_({ email: Session.getEffectiveUser().getEmail(), role: 'OWNER' }, 'UPGRADED_TO_STANDALONE', 'SYSTEM', '', '', { detailsRows: made, triggersRemoved: triggers }, 'KE Employment link removed', 'SUCCESS');
 const msg = 'Upgrade done. EMPLOYEE DETAILS rows created: ' + made + '. KE triggers removed: ' + triggers + '.';
 Logger.log(msg);
 try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor */ }
 return msg;
}

