/**
* BonusRules.gs
*/


const BONUS_TYPES_ = [
 ['MANUAL', 'Manual (admin enters each amount)'],
 ['PCT_SALARY', 'Percent of monthly salary'],
 ['PCT_SALARY_PER_CL', 'Percent of monthly salary for each eligible CL'],
 ['SALARY_DAYS_PER_CL', 'Days of salary for each eligible CL (salary / 30)'],
 ['FLAT', 'Flat Rs for every employee'],
 ['FLAT_PER_CL', 'Flat Rs for each eligible CL']
];


/* ---------------- rules storage (inside the SETTINGS sheet) ---------------- */
function bonusRules_() {
 let r = [];
 try { r = JSON.parse(S_('BONUS_RULES') || '[]'); } catch (e) { r = []; }
 if (!Array.isArray(r)) r = [];
 if (!r.some(x => x.id === 'R-MANUAL')) r.unshift({ id: 'R-MANUAL', name: 'Manual', type: 'MANUAL', value: 0 });
 return r;
}
function activeBonusRule_() {
 const rules = bonusRules_(), id = S_('BONUS_ACTIVE_RULE');
 return rules.filter(x => x.id === id)[0] || rules[0];
}
function ruleDesc_(r) {
 const v = Number(r.value) || 0;
 switch (r.type) {
   case 'PCT_SALARY': return v + '% of monthly salary';
   case 'PCT_SALARY_PER_CL': return v + '% of monthly salary for each eligible CL';
   case 'SALARY_DAYS_PER_CL': return v + ' day(s) of salary (salary / 30) for each eligible CL';
   case 'FLAT': return 'Rs ' + v + ' to every employee';
   case 'FLAT_PER_CL': return 'Rs ' + v + ' for each eligible CL';
   default: return 'Admin enters each amount';
 }
}
/** Caller must hold the script lock. */
function setSettingRaw_(ctx, key, value) {
 const d = defaultSettings_().filter(x => x[1] === key)[0];
 if (!d) throw new Error('Unknown setting ' + key);
 const old = S_(key), row = readAll_('SET').filter(r => r['Key'] === key)[0];
 if (row) sh_('SET').getRange(row._row, 3).setValue(value);
 else appendObj_('SET', { 'Group': d[0], 'Key': key, 'Value': value, 'Description': d[4] });
 resetSettingsCache_();
 log_(ctx, 'SETTING_CHANGED', 'SETTINGS', key, old, value, '', 'SUCCESS');
}


/* ---------------- rules API ---------------- */
function adminBonusRules_(ctx) {
 if (!bonusAllowed_(ctx)) return { restricted: true };
 const act = activeBonusRule_();
 return plain_({
   canEdit: ctx.adminRole === 'OWNER', active: act.id, types: BONUS_TYPES_,
   rules: bonusRules_().map(r => ({ id: r.id, name: r.name, type: r.type, value: r.value, desc: ruleDesc_(r), locked: r.id === 'R-MANUAL' }))
 });
}
function adminBonusRuleSave_(ctx, p) {
 needOwner_(ctx);
 const name = String(p.name || '').trim(), type = String(p.type || '');
 if (name.length < 2 || name.length > 60) fail_('Rule name must be 2 to 60 characters.');
 if (!BONUS_TYPES_.some(t => t[0] === type)) fail_('Please select a rule type.');
 let value = 0;
 if (type !== 'MANUAL') {
   value = parseFloat(p.value);
   if (isNaN(value) || value < 0) fail_('Enter the value (zero or more).');
   if (/^PCT/.test(type) && value > 1000) fail_('Percentage looks too large. Please check it.');
   value = r2_(value);
 }
 let msg = '';
 withLock_(() => {
   const rules = bonusRules_();
   if (rules.some(x => x.id !== p.id && String(x.name).toLowerCase() === name.toLowerCase())) fail_('Another rule already uses this name.');
   if (p.id) {
     const r = rules.filter(x => x.id === p.id)[0];
     if (!r) fail_('Rule not found.');
     if (r.id === 'R-MANUAL') fail_('The Manual rule cannot be changed.');
     r.name = name; r.type = type; r.value = value;
     msg = 'Rule updated. Press "Calculate eligibility" again to apply it to Pending bonus records.';
   } else {
     if (rules.length >= 20) fail_('Maximum 20 rules. Please delete one you no longer use.');
     rules.push({ id: 'R' + nextSeq_('BRULE'), name: name, type: type, value: value });
     msg = 'Rule added.';
   }
   setSettingRaw_(ctx, 'BONUS_RULES', JSON.stringify(rules));
 });
 return { message: msg };
}
function adminBonusRuleUse_(ctx, p) {
 needOwner_(ctx);
 let name = '';
 withLock_(() => {
   const r = bonusRules_().filter(x => x.id === p.id)[0];
   if (!r) fail_('Rule not found.');
   name = r.name;
   setSettingRaw_(ctx, 'BONUS_ACTIVE_RULE', r.id);
 });
 return { message: '"' + name + '" is now the rule in use. Press "Calculate eligibility" on the Diwali Bonus page to apply it.' };
}
function adminBonusRuleDelete_(ctx, p) {
 needOwner_(ctx);
 withLock_(() => {
   const rules = bonusRules_(), r = rules.filter(x => x.id === p.id)[0];
   if (!r) fail_('Rule not found.');
   if (r.id === 'R-MANUAL') fail_('The Manual rule cannot be deleted.');
   if (r.id === activeBonusRule_().id) fail_('This rule is in use. Select another rule first.');
   setSettingRaw_(ctx, 'BONUS_RULES', JSON.stringify(rules.filter(x => x.id !== r.id)));
 });
 return { message: 'Rule deleted.' };
}


/* ---------------- amount calculation ---------------- */
function ruleNeedsSalary_(type) { return /^PCT|^SALARY/.test(type); }


/** Monthly Gross Salary per Employee ID, read live from Employee Details. */
function bonusSalaryMap_() {
 const k = keAll_();
 if (!k.col['Gross Salary']) fail_('Column "Gross Salary" was not found in the Employee Details sheet.');
 const iId = k.col['Employee ID'] - 1, iS = k.col['Gross Salary'] - 1, m = {};
 k.vals.forEach(r => {
   const id = String(r[iId]).trim();
   if (!id) return;
   const n = parseFloat(String(r[iS]).replace(/[^0-9.]/g, ''));
   if (!isNaN(n) && n > 0) m[id] = n;
 });
 return m;
}
/** n = eligible CL. salary may be undefined. Returns '' when the amount cannot be worked out. */
function bonusAmount_(rule, n, salary) {
 const v = Number(rule.value) || 0;
 if (rule.type !== 'MANUAL' && !(n > 0)) return 0;     // no eligible CL = no bonus
 switch (rule.type) {
   case 'PCT_SALARY': return salary ? r2_(salary * v / 100) : '';
   case 'PCT_SALARY_PER_CL': return salary ? r2_(n * salary * v / 100) : '';
   case 'SALARY_DAYS_PER_CL': return salary ? r2_(n * (salary / 30) * v) : '';
   case 'FLAT': return r2_(v);
   case 'FLAT_PER_CL': return r2_(n * v);
   default: return '';
 }
}


/* ---------------- REPLACES adminBonusList_ and adminBonusCompute_ in Admin.gs ---------------- */
function adminBonusList_(ctx, p) {
 if (!bonusAllowed_(ctx)) return { restricted: true };
 const y = Number(p.year) || SN_('BONUS_YEAR'), rule = activeBonusRule_();
 const emps = {};
 readAll_('EMP').forEach(e => { emps[String(e['Employee ID'])] = e; });
 const rows = readAll_('BON').filter(b => Number(b['Bonus Year']) === y).filter(b => {
   const e = emps[String(b['Employee ID'])];
   if (!e) return true;                               // employee record gone: keep the history
   if (b['Status'] !== 'Pending') return true;        // Processed / Paid stay visible
   return allowedLeaves_(e).indexOf('CL') > -1;       // Pending: only if CL is assigned
 }).map(bonusOut_);
 return plain_({ year: y, cutoff: S_('BONUS_CUTOFF_DATE'), payment: S_('BONUS_PAYMENT_DATE'),
   rule: { id: rule.id, name: rule.name, type: rule.type, desc: ruleDesc_(rule) },
   rows: rows });
}


function adminBonusCompute_(ctx, p) {
 if (!bonusAllowed_(ctx)) fail_('Diwali Bonus details are restricted to the Owner admin.');
 const y = Number(p.year) || SN_('BONUS_YEAR');
 const cutoff = parseYmd_(p.cutoff || S_('BONUS_CUTOFF_DATE'));
 if (!cutoff) fail_('Set the Diwali Bonus Cutoff Date first (Settings > Diwali Bonus, or enter it here).');
 let noSalary = 0;
 withLock_(() => {
   ledgerMaintenance_(ctx.email);
   const map = lapsedBeforeCutoff_(readAll_('LED'), y, cutoff);
   const existing = readAll_('BON').filter(b => Number(b['Bonus Year']) === y);
   const pay = parseYmd_(S_('BONUS_PAYMENT_DATE')) || '', now = new Date();
   const rule = activeBonusRule_(), needSal = ruleNeedsSalary_(rule.type);
   const sal = needSal ? bonusSalaryMap_() : {};
   const newRows = []; let touched = 0;
   readAll_('EMP').forEach(e => {
     if (String(e['Status']) === 'Deleted') return;
     if (allowedLeaves_(e).indexOf('CL') < 0) return;      // CL not assigned: no bonus row
     const id = String(e['Employee ID']);
     const n = map[id] || 0, ex = existing.filter(b => String(b['Employee ID']) === id)[0];
     if (!ex && String(e['Status']) !== 'Active' && n === 0) return;
     const amt = bonusAmount_(rule, n, sal[id]);
     const missing = needSal && amt === '';
     if (ex) {
       if (ex['Status'] !== 'Pending') return;                 // Processed / Paid records are locked
       const ch = { 'CL Lapsed Before Cutoff': n, 'Eligible CL Count': n, 'Cutoff Date': cutoff, 'Updated By': ctx.email, 'Updated At': now };
       if (rule.type !== 'MANUAL') ch['Bonus Amount'] = amt;
       if (pay) ch['Payment Date'] = pay;
       updateObj_('BON', ex._row, ch); touched++;
       if (missing) noSalary++;
     } else {
       newRows.push({ 'Bonus Year': y, 'Employee ID': id, 'Employee Name': e['Employee Name'], 'CL Lapsed Before Cutoff': n, 'Eligible CL Count': n,
         'Cutoff Date': cutoff, 'Payment Date': pay, 'Bonus Amount': amt, 'Status': 'Pending',
         'Remarks': missing ? 'Salary not found in Employee Details' : '', 'Updated By': ctx.email, 'Updated At': now });
       if (missing) noSalary++;
     }
   });
   appendMany_('BON', newRows);
   log_(ctx, 'BONUS_ELIGIBILITY_COMPUTED', 'BONUS', String(y), '', { cutoff: iso_(cutoff), rule: rule.name, new: newRows.length, updated: touched }, '', 'SUCCESS');
 });
 const out = adminBonusList_(ctx, { year: y });
 out.warn = noSalary ? noSalary + ' employee(s) have no Gross Salary in Employee Details, so their amount is blank. Enter it manually or fix the salary and calculate again.' : '';
 return out;
}

