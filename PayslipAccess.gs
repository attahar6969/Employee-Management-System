/** PayslipAccess.gs */


/* ---------- who may see their own payslip ---------- */
function payslipEmpIds_() { return S_('PAYSLIP_EMP_ACCESS').split(',').map(x => x.trim()).filter(x => x); }
function payslipEmpAllowed_(id) { return payslipEmpIds_().indexOf(String(id)) > -1; }


function adminPayslipAccess_(ctx) {
 needOwner_(ctx);
 const on = payslipEmpIds_();
 return plain_({ list: readAll_('EMP').filter(e => e['Status'] === 'Active').map(e => ({
   id: String(e['Employee ID']), name: String(e['Employee Name']), dept: String(e['Department'] || ''),
   on: on.indexOf(String(e['Employee ID'])) > -1
 })).sort((a, b) => a.name.localeCompare(b.name)) });
}
function adminPayslipAccessSave_(ctx, p) {
 needOwner_(ctx);
 const want = Array.isArray(p.ids) ? p.ids.map(String) : [];
 withLock_(() => {
   const valid = readAll_('EMP').filter(e => e['Status'] === 'Active').map(e => String(e['Employee ID']));
   const ids = want.filter(x => valid.indexOf(x) > -1);
   setSettingRaw_(ctx, 'PAYSLIP_EMP_ACCESS', ids.join(','));
 });
 return { message: 'Payslip access saved.' };
}


/* ---------- employee payslip ---------- */
function empSlipLast_() {
 const t = today_();
 return t.getMonth() === 0 ? { y: t.getFullYear() - 1, m: 12 } : { y: t.getFullYear(), m: t.getMonth() };
}
function empSlipMonth_(p) {
 const last = empSlipLast_();
 let y = last.y, m = last.m;
 const mm = /^(\d{4})-(\d{2})$/.exec(String(p.month || ''));
 if (mm) {
   const ry = Number(mm[1]), rm = Number(mm[2]);
   if (rm >= 1 && rm <= 12 && ry >= 2020 && (ry < last.y || (ry === last.y && rm <= last.m))) { y = ry; m = rm; }
 }
 return { y: y, m: m, ym: y + '-' + pad_(m, 2) };
}
function empPayslipCore_(ctx, p) {
 if (!payslipEmpAllowed_(ctx.id)) fail_('Payslips are not enabled for your account. Please contact Admin.');
 const pm = empSlipMonth_(p), last = empSlipLast_();
 const key = x => x.getFullYear() + '-' + pad_(x.getMonth() + 1, 2);
 const isLast = pm.y === last.y && pm.m === last.m;
 const nav = {
   month: pm.ym, label: MONTHS_LONG_[pm.m - 1] + ' ' + pm.y,
   prev: (pm.y <= 2020 && pm.m === 1) ? '' : key(new Date(pm.y, pm.m - 2, 1)),
   next: isLast ? '' : key(new Date(pm.y, pm.m, 1))
 };
 const all = payslipAll_(pm, null, true);
 const s = all.slips.filter(x => String(x.empId) === String(ctx.id))[0];
 if (!s) return { nav: nav, s: null, message: 'No payslip is available for this month.' };
 if (s.att.pending > 0) return { nav: nav, s: null, message: 'Your payslip for this month is not ready yet. Some days are still waiting for approval.' };
 if (s.net === null) return { nav: nav, s: null, message: 'Your payslip for this month is not ready yet. Please contact Admin.' };
 s.monthLabel = nav.label;
 return { nav: nav, s: s, message: '' };
}
function empPayslip_(ctx, p) {
 const r = empPayslipCore_(ctx, p);
 if (!r.s) return plain_(Object.assign({}, r.nav, { empty: true, message: r.message }));
 log_(ctx, 'PAYSLIP_VIEWED_BY_EMPLOYEE', 'PAYSLIP', ctx.id + '/' + r.nav.month, '', '', '', 'SUCCESS');
 return plain_(Object.assign({}, r.nav, { empty: false, html: payslipHtml_(r.s) }));
}
function empPayslipPdf_(ctx, p) {
 const r = empPayslipCore_(ctx, p);
 if (!r.s) fail_(r.message);
 const name = 'Payslip-' + ctx.id + '-' + r.nav.month + '.pdf';
 const blob = HtmlService.createHtmlOutput('<html><body style="margin:0">' + payslipHtml_(r.s) + '</body></html>').getBlob().getAs('application/pdf').setName(name);
 log_(ctx, 'PAYSLIP_DOWNLOADED_BY_EMPLOYEE', 'PAYSLIP', ctx.id + '/' + r.nav.month, '', '', 'PDF', 'SUCCESS');
 return { name: name, mime: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) };
}


/* ---------- Diwali bonus: Done / Undo ---------- */
function adminBonusDone_(ctx, p) {
 if (!bonusAllowed_(ctx)) fail_('Diwali Bonus details are restricted to the Owner admin.');
 const y = Number(p.year), undo = !!p.undo;
 let msg = '';
 withLock_(() => {
   const b = readAll_('BON').filter(r => Number(r['Bonus Year']) === y && String(r['Employee ID']) === String(p.employeeId))[0];
   if (!b) fail_('Bonus record not found. Calculate eligibility first.');
   const now = new Date();
   if (undo) {
     if (b['Status'] !== 'Processed') fail_('Only a bonus marked Done (not yet Paid) can be undone.');
     updateObj_('BON', b._row, { 'Status': 'Pending', 'Updated By': ctx.email, 'Updated At': now });
     log_(ctx, 'BONUS_DONE_UNDONE', 'BONUS', y + '/' + p.employeeId, 'Processed', 'Pending', '', 'SUCCESS');
     msg = 'Bonus is Pending again and removed from the payslip.';
     return;
   }
   if (b['Status'] !== 'Pending') fail_('This bonus is already marked Done.');
   const amt = Number(b['Bonus Amount']);
   if (!(Number(b['Eligible CL Count']) > 0)) fail_('This employee has no eligible CL.');
   if (!(amt > 0)) fail_('Enter the bonus amount first (tap Update).');
   const pd = b['Payment Date'];
   if (!(pd instanceof Date)) fail_('Set the payment date first (tap Update), because the bonus goes to the payslip of that month.');
   updateObj_('BON', b._row, { 'Status': 'Processed', 'Updated By': ctx.email, 'Updated At': now });
   log_(ctx, 'BONUS_MARKED_DONE', 'BONUS', y + '/' + p.employeeId, 'Pending', 'Processed', 'Rs ' + amt, 'SUCCESS');
   msg = 'Bonus marked Done. Rs ' + amt + ' will show in the ' + MONTHS_LONG_[pd.getMonth()] + ' ' + pd.getFullYear() + ' payslip.';
 });
 return { message: msg };
}
