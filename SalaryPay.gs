/** SalaryPay.gs */


function payAccIds_() { return S_('PAYSLIP_ACCOUNTANT').split(',').map(x => x.trim()).filter(x => x); }
function isAccountant_(id) { return payAccIds_().indexOf(String(id)) > -1; }
function needAccountant_(ctx) { if (!isAccountant_(ctx.id)) fail_('You are not allowed to use Salary Payments.'); }
function payKey_(ym, id) { return 'PAY_' + ym + '_' + id; }
/** { empId: {d:'dd/MM/yyyy', amt:number} } for one month */
function payMap_(ym) {
 const all = PropertiesService.getScriptProperties().getProperties(), pre = 'PAY_' + ym + '_', out = {};
 Object.keys(all).forEach(k => {
   if (k.indexOf(pre) !== 0) return;
   try { out[k.slice(pre.length)] = JSON.parse(all[k]); } catch (e) { /* ignore */ }
 });
 return out;
}


/* ---------- Owner: choose the accountant ---------- */
function adminPayAccGet_(ctx) {
 needOwner_(ctx);
 return plain_({
   current: payAccIds_()[0] || '',
   list: readAll_('EMP').filter(e => e['Status'] === 'Active')
     .map(e => ({ id: String(e['Employee ID']), name: String(e['Employee Name']) })).sort((a, b) => a.name.localeCompare(b.name))
 });
}
function adminPayAccSave_(ctx, p) {
 needOwner_(ctx);
 const id = String(p.id || '').trim();
 withLock_(() => {
   if (id) {
     const e = getEmpById_(id);
     if (!e || e['Status'] !== 'Active') fail_('Please choose an Active employee.');
   }
   setSettingRaw_(ctx, 'PAYSLIP_ACCOUNTANT', id);
 });
 return { message: id ? 'Accountant saved. He sees "Salary Payments" after he signs in again.' : 'Accountant removed.' };
}


/* ---------- Accountant (employee side) ---------- */
function empPayAccList_(ctx, p) {
 needAccountant_(ctx);
 const pm = empSlipMonth_(p), last = empSlipLast_();
 const key = x => x.getFullYear() + '-' + pad_(x.getMonth() + 1, 2);
 const nav = {
   month: pm.ym, label: MONTHS_LONG_[pm.m - 1] + ' ' + pm.y,
   prev: (pm.y <= 2020 && pm.m === 1) ? '' : key(new Date(pm.y, pm.m - 2, 1)),
   next: (pm.y === last.y && pm.m === last.m) ? '' : key(new Date(pm.y, pm.m, 1))
 };
 const all = payslipAll_(pm, null, true);
 const rows = all.slips.map(s => {
   let ready = true, why = '';
   if (s.net === null) { ready = false; why = 'Salary not set'; }
   else if (s.att.pending > 0) { ready = false; why = s.att.pending + ' day(s) waiting for approval'; }
   return { empId: s.empId, name: s.name, dept: s.dept, net: s.net, ready: ready, why: why,
     paid: s.paid ? s.paid.d : '', changed: !!(s.paid && Number(s.paid.amt) !== Number(s.net)), paidAmt: s.paid ? s.paid.amt : null };
 });
 return plain_(Object.assign(nav, { rows: rows }));
}


/** p = { month, ids:[...], undo } */
function empPayAccMark_(ctx, p) {
 needAccountant_(ctx);
 const pm = empSlipMonth_(p);
 if (String(p.month) !== pm.ym) fail_('Please choose a finished month.');
 const ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
 if (!ids.length) fail_('Please select an employee.');
 const undo = !!p.undo;
 let done = 0, skipped = 0;
 withLock_(() => {
   const all = payslipAll_(pm, null, true), props = PropertiesService.getScriptProperties();
   ids.forEach(id => {
     const s = all.slips.filter(x => String(x.empId) === id)[0];
     if (!s) { skipped++; return; }
     if (undo) {
       if (!s.paid) { skipped++; return; }
       props.deleteProperty(payKey_(pm.ym, id));
       log_(ctx, 'SALARY_PAID_UNDONE', 'PAYSLIP', id + '/' + pm.ym, 'Paid', 'Not paid', '', 'SUCCESS');
       done++; return;
     }
     if (s.paid || s.net === null || s.att.pending > 0) { skipped++; return; }
     props.setProperty(payKey_(pm.ym, id), JSON.stringify({ d: dmy_(new Date()), amt: s.net }));
     log_(ctx, 'SALARY_MARKED_PAID', 'PAYSLIP', id + '/' + pm.ym, 'Not paid', 'Paid', 'Rs ' + s.net, 'SUCCESS');
     done++;
   });
 });
 if (!done) fail_('Nothing was changed. The slip may already be marked, or it still has days waiting for approval.');
 return { message: (undo ? done + ' payment mark(s) removed.' : done + ' salary payment(s) marked as Paid.') + (skipped ? ' ' + skipped + ' skipped.' : '') };
}

