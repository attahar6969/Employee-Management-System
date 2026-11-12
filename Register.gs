/**
* Register.gs 
*/


function needOwner_(ctx) { if (ctx.adminRole !== 'OWNER') fail_('Only the Owner admin can do this.'); }
function binDays_() { return Math.max(SN_('BIN_DAYS') || 30, 1); }


/* ================= MOVE TO BIN ================= */
function adminDeleteEmployee_(ctx, p) {
 needOwner_(ctx);
 let id = '';
 withLock_(() => {
   const emp = getEmpById_(p.id);
   if (!emp) fail_('Employee not found. It may already be deleted.');
   if (emp['Status'] === 'Deleted') fail_('This employee is already in the Bin.');
   id = String(emp['Employee ID']);
   const now = new Date();
   updateObj_('EMP', emp._row, { 'Prev Status': emp['Status'], 'Status': 'Deleted', 'Deleted At': now, 'Deleted By': ctx.email, 'Updated At': now });
   detSetStatus_(id, 'Inactive');
   log_(ctx, 'EMPLOYEE_MOVED_TO_BIN', 'EMPLOYEE', id, empOut_(emp), { deletedAt: dt_(now), retentionDays: binDays_() }, 'Kept for restore', 'SUCCESS');
 });
 return { message: 'Employee ' + id + ' moved to the Bin. It can be restored for ' + binDays_() + ' days.' };
}


function adminBinList_(ctx) {
 needOwner_(ctx);
 const days = binDays_();
 return plain_({ days: days, list: readAll_('EMP').filter(e => e['Status'] === 'Deleted').map(e => {
   const at = e['Deleted At'];
   const left = at instanceof Date ? Math.max(0, Math.ceil((at.getTime() + days * 86400000 - Date.now()) / 86400000)) : null;
   return { id: e['Employee ID'], name: e['Employee Name'], mobile: String(e['Phone'] || ''), at: dt_(at), by: e['Deleted By'], left: left };
 }) });
}


function adminBinRestore_(ctx, p) {
 needOwner_(ctx);
 let id = '';
 withLock_(() => {
   const emp = getEmpById_(p.id);
   if (!emp || emp['Status'] !== 'Deleted') fail_('This employee is not in the Bin.');
   const at = emp['Deleted At'];
   if (!(at instanceof Date)) fail_('The deletion time is missing, so this record cannot be restored safely.');
   if (Date.now() > at.getTime() + binDays_() * 86400000) fail_('The ' + binDays_() + '-day retention period is over. This record will be purged.');
   id = String(emp['Employee ID']);
   updateObj_('EMP', emp._row, { 'Status': 'Active', 'Deleted At': '', 'Deleted By': '', 'Prev Status': '', 'Updated At': new Date() });
   detSetStatus_(id, 'Active');
   log_(ctx, 'EMPLOYEE_RESTORED_FROM_BIN', 'EMPLOYEE', id, 'Deleted', 'Active', 'Same ID and records', 'SUCCESS');
   ledgerMaintenance_(ctx.email);
 });
 return { message: 'Employee ' + id + ' restored with the same ID and all records.' };
}


/* ================= PERMANENT REMOVAL ================= */
function purgeEmployeeData_(emp) {
 const id = String(emp['Employee ID']); let docs = 0;
 readAll_('APP').forEach(a => {
   if (String(a['Employee ID']) !== id || !a['Medical Document ID']) return;
   try { DriveApp.getFileById(a['Medical Document ID']).setTrashed(true); docs++; } catch (e) { /* already gone */ }
 });
 return { applications: purgeRows_('APP', 'Employee ID', id), ledger: purgeRows_('LED', 'Employee ID', id),
   bonus: purgeRows_('BON', 'Employee ID', id), unauthorized: purgeRows_('UNA', 'Employee ID', id), documents: docs,
   details: detDeleteRow_(id) };
}
/** Removes employees whose Bin time is over. Re-checks every record inside the lock so a just-restored employee is safe. */
function binPurge_(who) {
 return withLock_(() => {
   const cutoff = Date.now() - binDays_() * 86400000;
   const due = readAll_('EMP').filter(e => e['Status'] === 'Deleted' && e['Deleted At'] instanceof Date && e['Deleted At'].getTime() <= cutoff)
     .sort((a, b) => b._row - a._row);
   let n = 0;
   due.forEach(e => {
     const f = getEmpById_(e['Employee ID']);
     if (!f || f['Status'] !== 'Deleted' || !(f['Deleted At'] instanceof Date) || f['Deleted At'].getTime() > cutoff || f._row !== e._row) return;
     const counts = purgeEmployeeData_(f);
     sh_('EMP').deleteRow(f._row);
     log_({ email: who, role: 'SYSTEM' }, 'EMPLOYEE_PURGED_FROM_BIN', 'EMPLOYEE', String(f['Employee ID']), empOut_(f), counts, 'Retention period over', 'SUCCESS');
     n++;
   });
   return n;
 });
}
function adminBinPurgeNow_(ctx) {
 needOwner_(ctx);
 const n = binPurge_(ctx.email);
 return { message: n ? n + ' expired employee(s) permanently removed.' : 'Nothing has passed the retention period yet.' };
}
/** Owner: delete selected employees (p.ids) or everyone in the Bin (p.all) right now. */
function adminBinDelete_(ctx, p) {
 needOwner_(ctx);
 const all = !!p.all, ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
 if (!all && !ids.length) fail_('Please tick at least one employee.');
 let n = 0; const errs = [];
 withLock_(() => {
   const list = readAll_('EMP')
     .filter(e => e['Status'] === 'Deleted' && (all || ids.indexOf(String(e['Employee ID'])) > -1))
     .sort((a, b) => b._row - a._row);
   list.forEach(e => {
     const id = String(e['Employee ID']);
     try {
       const counts = purgeEmployeeData_(e);
       const f = getEmpById_(id);                    // fresh row number
       if (f) sh_('EMP').deleteRow(f._row);
       n++;
       try {
         log_(ctx, 'EMPLOYEE_PURGED_FROM_BIN', 'EMPLOYEE', id, empOut_(e), counts, 'Deleted from the Bin by Owner', 'SUCCESS');
       } catch (x) { /* logging must never fail the delete */ }
     } catch (err) {
       errs.push(id + ': ' + (err && err.message ? err.message : err));
     }
   });
 });
 let msg = n ? n + ' employee(s) permanently deleted.' : 'Nothing to delete.';
 if (errs.length) msg += ' Problem: ' + errs.join('; ');
 return { message: msg };
}


/** Called by the daily maintenance trigger. */
function dailyEmployeeJobs_() {
 const n = binPurge_('SYSTEM');
 log_({ role: 'SYSTEM' }, 'BIN_PURGE_DAILY', 'SYSTEM', '', '', { removed: n }, '', 'SUCCESS');
}

