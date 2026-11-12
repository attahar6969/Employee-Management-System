/**
* Payslip.gs
*/


function payslipAllowed_(ctx) { return ctx.adminRole === 'OWNER' || SB_('PAYSLIP_ADMIN_VIEW'); }


function ordinal_(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }


/** Penalty items per employee for one month. Settings > Penalty is the only source of amounts. */
function payslipPenaltyCalc_(firstIso, lastIso, cutoffIso) {
 const una = readAll_('UNA').filter(u => u['From Date'] instanceof Date && u['To Date'] instanceof Date);
 const byEmp = {};
 una.forEach(u => { const e = String(u['Employee ID']); (byEmp[e] = byEmp[e] || []).push(u); });
 const inMonth = {}, dm = unaDateMap_();
 Object.keys(dm).forEach(k => {
   const d = k.split('|')[1];
   if (d < firstIso || d > cutoffIso) return;
   inMonth[dm[k].id] = (inMonth[dm[k].id] || 0) + 1;
 });
 const keyOf = u => iso_(u['Incident Date'] instanceof Date ? u['Incident Date'] : u['From Date']) + '|' + String(u['Incident ID']);
 const out = {};
 Object.keys(byEmp).forEach(emp => {
   const list = byEmp[emp].slice().sort((a, b) => keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);
   list.forEach((u, i) => {
     const id = String(u['Incident ID']), fromIso = iso_(u['From Date']);
     const days = inMonth[id] || 0;
     const first = fromIso >= firstIso && fromIso <= cutoffIso;
     if (!days && !first) return;
     const occ = i + 1, n = Math.min(occ, 3);
     const dur = Math.round((u['To Date'] - u['From Date']) / 86400000) + 1;
     const penDays = SN_('PEN' + n + '_DAYS'), amt = SN_('PEN' + n + '_AMOUNT');
     const extra = first ? Math.max(0, penDays - dur) : 0;
     (out[emp] = out[emp] || []).push({ id: id, occ: occ, days: r2_(days + extra), amount: first ? amt : 0 });
   });
 });
 return out;
}
function penSnapLoad_(ym) {
 try { const s = PropertiesService.getScriptProperties().getProperty('PENSNAP_' + ym); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function penSnapSave_(ym, y, m) {
 try {
   const f = iso_(new Date(y, m - 1, 1)), l = iso_(new Date(y, m, 0));
   PropertiesService.getScriptProperties().setProperty('PENSNAP_' + ym, JSON.stringify(payslipPenaltyCalc_(f, l, l)));
 } catch (e) { log_({ role: 'SYSTEM' }, 'PENALTY_SNAPSHOT_FAILED', 'PAYSLIP', ym, '', '', String(e), 'ERROR'); }
}
function penFlag_(p) { return p && p.pen === 'ON' ? true : (p && p.pen === 'OFF' ? false : undefined); }


/** 1234567.5 -> "12,34,567.50" */
function inr_(n) {
 n = Math.round((Number(n) || 0) * 100) / 100;
 const neg = n < 0; n = Math.abs(n);
 const parts = n.toFixed(2).split('.');
 const i = parts[0], last3 = i.slice(-3);
 let rest = i.slice(0, -3);
 if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
 return (neg ? '-' : '') + rest + last3 + '.' + parts[1];
}


/**
* Pure calculation (no sheet access).
* o = { salary, y, m, t (register totals), preJoin, ended, basis, olPaid, pen:[{id,days,amount}] }
*/
function payslipCompute_(o) {
 const dim = new Date(o.y, o.m, 0).getDate();
 const base = o.basis === 'MONTH_DAYS' ? dim : 30;
 const salary = Number(o.salary) > 0 ? Number(o.salary) : 0;
 const hasSal = salary > 0;
 const rate = hasSal ? salary / base : 0;
 const t = o.t, warnings = [];
 const unpaidOl = o.olPaid ? 0 : (t.ol || 0);
 const lop = r2_((t.absent || 0) + unpaidOl + (t.pending || 0) + (o.preJoin || 0));
 const lopAmt = hasSal ? Math.min(salary, r2_(lop * rate)) : 0;
 const penalties = [];
 (o.pen || []).forEach(p => {
   if ((p.days || 0) > 0) penalties.push({ label: 'Unauthorized Leave ' + p.id + ' (' + p.days + (Number(p.days) === 1 ? ' day' : ' days') + ' salary)', amount: hasSal ? r2_(p.days * rate) : 0 });
   if ((p.amount || 0) > 0) penalties.push({ label: 'Unauthorized Leave Penalty - ' + ordinal_(p.occ) + ' Occurrence', amount: r2_(p.amount) });
 });
 const penTotal = r2_(penalties.reduce((s, x) => s + x.amount, 0));
 const accrual = !o.ended && o.paidDays != null;
 const earned = hasSal ? (accrual ? Math.min(salary, r2_(o.paidDays * rate)) : r2_(salary - lopAmt)) : 0;
 const net = hasSal ? Math.max(0, Math.round(earned - penTotal)) : null;
 if (!hasSal) warnings.push('Gross Salary not found in Employee Details');
 if (t.pending > 0) warnings.push(t.pending + ' day(s) waiting for approval are not paid yet');
 if (!o.ended) warnings.push('Month not finished, provisional');
 return {
   accrual: accrual, earned: earned, paidDays: o.paidDays || 0,
   daysInMonth: dim, base: base, rate: r2_(rate), salary: salary, lop: lop, lopAmt: lopAmt, preJoin: o.preJoin || 0,
   penalties: penalties, penTotal: penTotal, deductions: accrual ? penTotal : r2_(lopAmt + penTotal), net: net, warnings: warnings, provisional: !o.ended,
   att: { present: t.present, half: t.half, absent: t.absent, cl: t.cl, sl: t.sl, ol: t.ol, holidays: t.holidays, weekOff: t.weekOff, pending: t.pending }
 };
}


/** Recounts the attendance summary only for days up to today (and from the joining date), for an unfinished month. */
function payslipCountsToDate_(r, days, todayIso, jd) {
 const t = { present: 0, half: 0, absent: 0, cl: 0, sl: 0, ol: 0, holidays: 0, weekOff: 0, pending: 0, ul: 0 };
 days.forEach((d, i) => {
   if (d.date > todayIso) return;          // future days are not counted anywhere
   if (jd && d.date < jd) return;          // days before joining are not counted
   switch (r.c[i]) {
     case 'P':  t.present += 1; break;
     case 'H':  t.present += 0.5; t.absent += 0.5; t.half += 1; break;
     case 'A':  t.absent += 1; break;
     case 'CL': t.cl += 1; break;
     case 'SL': t.sl += 1; break;
     case 'OL': t.ol += 1; break;
     case 'PH': t.holidays += 1; break;    // a Sunday that is also a holiday is coded PH, so it counts once, here
     case 'W':  t.weekOff += 1; break;
     case 'PA': t.pending += 1; break;
     case 'UL': t.ul += 1; break;
   }
 });
 return t;
}


/** Reads every sheet once and returns a slip object for each employee of the month. */
function payslipAll_(pm, ctx, forEmployee, opt) {
 opt = opt || {};
 const penOn = opt.penOn === undefined ? SB_('PAYSLIP_INCLUDE_PENALTY') : !!opt.penOn;
 const reg = attRegisterData_(pm.y, pm.m);
 let sal = {}, salErr = '';
 try { sal = bonusSalaryMap_(); } catch (e) { salErr = e && e.message ? e.message : String(e); }
 const emps = {};
 readAll_('EMP').forEach(e => { emps[String(e['Employee ID'])] = e; });
 const firstIso = iso_(new Date(pm.y, pm.m - 1, 1)), lastIso = iso_(new Date(pm.y, pm.m, 0));
 const todayIso0 = iso_(today_());
 const cutoffIso = reg.ended ? lastIso : (todayIso0 < lastIso ? todayIso0 : lastIso);
 let pen = {};
 if (penOn) pen = (attFinal_(pm.ym) && penSnapLoad_(pm.ym)) || payslipPenaltyCalc_(firstIso, lastIso, cutoffIso);
 // Diwali Bonus: added in the month of its Payment Date, only when Processed/Paid, with an amount, and the admin may see bonus details.
 const bon = {};
 if (SB_('PAYSLIP_INCLUDE_BONUS') && (forEmployee || (ctx && bonusAllowed_(ctx)))) {
   readAll_('BON').forEach(b => {
     const d = b['Payment Date'], amt = Number(b['Bonus Amount']);
     if (!(d instanceof Date) || !(amt > 0) || !(Number(b['Eligible CL Count']) > 0)) return;
     if (b['Status'] !== 'Processed' && b['Status'] !== 'Paid') return;
     const k = iso_(d);
     if (k < firstIso || k > lastIso) return;
     bon[String(b['Employee ID'])] = { amount: amt, label: 'Diwali Bonus ' + b['Bonus Year'] + ' (' + b['Eligible CL Count'] + ' eligible CL)' };
   });
 }
 const paidMap = payMap_(pm.ym);
 const olPaid = S_('OTHER_LEAVE_TREATMENT') === 'Paid', basis = S_('PAYSLIP_DAY_BASIS') === 'MONTH_DAYS' ? 'MONTH_DAYS' : '30';
 const slips = reg.rows.map(r => {
   const e = emps[r.id] || {};
   const jd = e['Joining Date'] instanceof Date ? iso_(e['Joining Date']) : '';
   const preJoin = jd ? reg.days.filter(d => d.date < jd).length : 0;
   const todayIso = iso_(today_());
   const cv = { P: 1, H: 0.5, CL: 1, SL: 1, PH: 1, W: 1, OL: olPaid ? 1 : 0, UL: penOn ? 1 : 0 };
   let paidDays = 0;
   reg.days.forEach((d, i) => {
     if (d.date > todayIso) return;
     if (jd && d.date < jd) return;
     paidDays += cv[r.c[i]] || 0;
   });
   const tt0 = reg.ended ? r.t : payslipCountsToDate_(r, reg.days, todayIso, jd);
   const tt = Object.assign({}, tt0);
   if (!penOn) tt.absent = r2_((tt.absent || 0) + (tt.ul || 0));
   const s = payslipCompute_({ paidDays: paidDays, salary: sal[r.id], y: pm.y, m: pm.m, t: tt, preJoin: preJoin, ended: reg.ended, basis: basis, olPaid: olPaid, pen: pen[r.id] || [] });
   s.bonus = bon[r.id] || null;
   s.paid = paidMap[r.id] || null;
   if (s.bonus && s.net !== null) s.net = r2_(s.net + s.bonus.amount);
   s.empId = r.id; s.name = r.name; s.dept = r.dept; s.desig = String(e['Designation'] || ''); s.status = r.status;
   s.joining = jd; s.codes = r.c;
   return s;
 });
 return { slips: slips, ended: reg.ended, days: reg.days, salErr: salErr, finalized: attFinal_(pm.ym), penOn: penOn };
}


function payslipMonthNav_(pm) {
 const t = today_(), prev = new Date(pm.y, pm.m - 2, 1), next = new Date(pm.y, pm.m, 1);
 const key = x => x.getFullYear() + '-' + pad_(x.getMonth() + 1, 2);
 const isCur = pm.y === t.getFullYear() && pm.m === t.getMonth() + 1;
 return { month: pm.ym, label: MONTHS_LONG_[pm.m - 1] + ' ' + pm.y, prev: key(prev), next: isCur ? '' : key(next) };
}


/* ================= ADMIN API ================= */
function adminPayslipList_(ctx, p) {
 if (!payslipAllowed_(ctx)) return { restricted: true };
 const pm = attParseMonth_(p), all = payslipAll_(pm, ctx), nav = payslipMonthNav_(pm);
 return plain_(Object.assign(nav, {
   ended: all.ended, finalized: all.finalized, salErr: all.salErr, owner: ctx.adminRole === 'OWNER',
   rows: all.slips.map(s => ({
     empId: s.empId, name: s.name, dept: s.dept, status: s.status, salary: s.salary, lop: s.lop, lopAmt: s.lopAmt,
     bonus: s.bonus ? s.bonus.amount : 0, paid: s.paid ? s.paid.d : '', penTotal: s.penTotal, deductions: s.deductions, net: s.net, warnings: s.warnings
   }))
 }));
}


function adminPayslip_(ctx, p) {
 if (!payslipAllowed_(ctx)) fail_('Payslips are restricted to the Owner admin.');
 const pm = attParseMonth_(p), all = payslipAll_(pm, ctx, false, { penOn: penFlag_(p) });
 const s = all.slips.filter(x => String(x.empId) === String(p.empId))[0];
 if (!s) fail_('This employee has no attendance record for the selected month.');
 s.monthLabel = MONTHS_LONG_[pm.m - 1] + ' ' + pm.y;
 s.html = payslipHtml_(s);
 log_(ctx, 'PAYSLIP_VIEWED', 'PAYSLIP', s.empId + '/' + pm.ym, '', '', s.net === null ? 'No salary' : 'Net ' + s.net, 'SUCCESS');
 return plain_({ slip: { empId: s.empId, name: s.name, monthLabel: s.monthLabel, month: pm.ym, net: s.net, warnings: s.warnings, html: s.html, penOn: all.penOn } });
}


/** Real PDF for download. Uses Google's HTML to PDF converter, so the slip uses plain tables and inline styles. */
function adminPayslipPdf_(ctx, p) {
 if (!payslipAllowed_(ctx)) fail_('Payslips are restricted to the Owner admin.');
 const pm = attParseMonth_(p), all = payslipAll_(pm, ctx, false, { penOn: penFlag_(p) });
 const s = all.slips.filter(x => String(x.empId) === String(p.empId))[0];
 if (!s) fail_('This employee has no attendance record for the selected month.');
 s.monthLabel = MONTHS_LONG_[pm.m - 1] + ' ' + pm.y;
 const name = 'Payslip-' + s.empId + '-' + pm.ym + '.pdf';
 const blob = HtmlService.createHtmlOutput('<html><body style="margin:0">' + payslipHtml_(s) + '</body></html>').getBlob().getAs('application/pdf').setName(name);
 log_(ctx, 'PAYSLIP_DOWNLOADED', 'PAYSLIP', s.empId + '/' + pm.ym, '', '', 'PDF', 'SUCCESS');
 return { name: name, mime: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) };
}


/* ================= THE SLIP (one template for screen, print and PDF) ================= */
function payslipHtml_(s) {
 const R = n => 'Rs ' + inr_(n);
 const cell = (a, b, bold) => '<tr><td style="padding:5px 8px;border:1px solid #cfd8e3;background:#f4f7fa;width:38%">' + esc_(a) +
   '</td><td style="padding:5px 8px;border:1px solid #cfd8e3;' + (bold ? 'font-weight:bold' : '') + '">' + esc_(b) + '</td></tr>';
 const line = (a, b, bold) => '<tr><td style="padding:6px 8px;border:1px solid #cfd8e3;' + (bold ? 'font-weight:bold;background:#eaf0f6' : '') + '">' + esc_(a) +
   '</td><td style="padding:6px 8px;border:1px solid #cfd8e3;text-align:right;white-space:nowrap;' + (bold ? 'font-weight:bold;background:#eaf0f6' : '') + '">' + esc_(b) + '</td></tr>';
 const a = s.att, hasSal = s.salary > 0;
 const paidLeave = r2_((a.cl || 0) + (a.sl || 0));
 let h = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#1f2d3a;max-width:760px;margin:0 auto;padding:8px">' +
   '<div style="background:#0f3d5e;color:#ffffff;padding:12px 16px"><div style="font-size:18px;font-weight:bold">' + esc_(S_('COMPANY_NAME')) + '</div>' +
   '<div style="font-size:13px">Payslip for ' + esc_(s.monthLabel) + '</div></div>';
 if (s.provisional) h += '<div style="background:#fff3d6;color:#a86a00;padding:6px 12px;margin-top:8px">Provisional: this month is not finished yet, so the figures can still change.</div>';
 h += '<table style="border-collapse:collapse;width:100%;margin-top:10px">' +
   cell('Employee name', s.name, true) + cell('Employee ID', s.empId) + cell('Department', s.dept || '-') + cell('Designation', s.desig || '-') +
   cell('Date of joining', s.joining ? dmy_(parseYmd_(s.joining)) : '-') + '</table>' +
   '<div style="font-weight:bold;margin:14px 0 4px;color:#0f3d5e">Attendance summary</div>' +
   '<table style="border-collapse:collapse;width:100%">' +
   cell('Days in month', String(s.daysInMonth)) + cell('Present (half days count 0.5)', String(a.present)) + cell('Weekly off', String(a.weekOff)) +
   cell('Paid holidays', String(a.holidays)) + cell('Paid leave (CL + SL)', String(paidLeave)) + cell('Other leave', String(a.ol)) +
   cell('Absent (half days count 0.5)', String(a.absent)) + cell('Waiting for approval', String(a.pending)) + '</table>' +
   '<div style="font-weight:bold;margin:14px 0 4px;color:#0f3d5e">Earnings and deductions</div>' +
   '<table style="border-collapse:collapse;width:100%">';
 if (!hasSal) {
   h += line('Gross salary', 'Not available', false);
 } else {
   h += line('Monthly gross salary', R(s.salary));
   h += line('Day rate (salary / ' + s.base + ')', R(s.rate));
   if (s.accrual) {
     h += line('Days paid so far: ' + s.paidDays + ' day(s) x ' + R(s.rate), R(s.earned));
   } else {
     h += line('Loss of pay: ' + s.lop + ' day(s) x ' + R(s.rate), '- ' + R(s.lopAmt));
   }
   if (s.bonus) h += line(s.bonus.label, '+ ' + R(s.bonus.amount));
   s.penalties.forEach(x => { h += line(x.label, '- ' + R(x.amount)); });
   h += line('Total deductions', '- ' + R(s.deductions), true);
   h += line('NET PAY', R(s.net), true);
   if (s.paid) h += line('Payment status', 'Paid on ' + s.paid.d, true);
 }
 h += '</table>';
 if (hasSal && s.lop > 0) h += '<div style="color:#667788;font-size:11px;margin-top:6px">Loss of pay covers days marked Absent, days still waiting for approval' +
   (s.preJoin ? ', days before joining' : '') + ' and unpaid Other Leave.</div>';
 h += '<div style="color:#667788;font-size:11px;margin-top:14px;border-top:1px solid #cfd8e3;padding-top:6px">This is a computer-generated payslip based on attendance records and needs no signature. Generated on ' +
   esc_(dt_(new Date())) + '.</div></div>';
 return h;
}
/* ================= EMPLOYEE: current month wages tracker ================= */
function empWageTracker_(ctx) {
 const emp = ctx.emp;
 if (!payslipEmpAllowed_(emp['Employee ID'])) fail_('Payslip is not enabled for you. Please contact Admin.');
 const t = today_();
 const pm = attParseMonth_({ month: t.getFullYear() + '-' + pad_(t.getMonth() + 1, 2) });
 const all = payslipAll_(pm, null, true);
 const s = all.slips.filter(x => String(x.empId) === String(emp['Employee ID']))[0];
 if (!s) return plain_({ empty: true, message: 'No attendance record for this month yet.' });
 const hasSal = s.salary > 0;
 const pend = s.att.pending || 0;
 const confirmedLop = r2_(Math.max(0, s.lop - pend));
 const confirmedAmt = hasSal ? Math.min(s.salary, r2_(confirmedLop * s.rate)) : 0;
 const holdAmt = hasSal ? r2_(pend * s.rate) : 0;
 const bonus = s.bonus ? s.bonus.amount : 0;
// Pay according to days counted so far (not assuming the rest of the month)
const projected = hasSal ? Math.max(0, Math.round(s.earned - s.penTotal + bonus)) : null;
const ifHoldPaid = hasSal ? Math.max(0, Math.round(projected + holdAmt)) : null;
 return plain_({
   empty: false, monthLabel: MONTHS_LONG_[pm.m - 1] + ' ' + pm.y,
   hasSalary: hasSal, salary: s.salary, rate: s.rate, base: s.base,
   daysInMonth: s.daysInMonth, dayNo: t.getDate(),
   present: s.att.present, half: s.att.half, absent: s.att.absent, pending: pend,
   paidLeave: r2_((s.att.cl || 0) + (s.att.sl || 0)), otherLeave: s.att.ol || 0,
   confirmedLop: confirmedLop, confirmedAmt: confirmedAmt, holdAmt: holdAmt,
penTotal: s.penTotal,
bonus: bonus,
projected: projected,
ifHoldPaid: ifHoldPaid,
paidDays: s.paidDays,
earned: s.earned
 });
}


function payslipDiagnose() {
 assertOwnerRun_();
 const out = [], t = today_();
 const pm = attParseMonth_({ month: t.getFullYear() + '-' + pad_(t.getMonth() + 1, 2) });
 const step = (n, fn) => {
   try { out.push('OK   ' + n + ': ' + fn()); }
   catch (e) { out.push('FAIL ' + n + ': ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : '')); }
 };
 step('Attendance register', () => attRegisterData_(pm.y, pm.m).rows.length + ' rows');
 step('Salary from KE sheet', () => Object.keys(bonusSalaryMap_()).length + ' salaries');
 step('Payslip build', () => payslipAll_(pm, { adminRole: 'OWNER' }, false).slips.length + ' slips');
 step('PDF conversion', () => HtmlService.createHtmlOutput('<p>test</p>').getBlob().getAs('application/pdf').getBytes().length + ' bytes');
 Logger.log(out.join('\n'));
 return out.join('\n');
}

