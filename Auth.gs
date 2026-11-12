/**
* FILE 2 of 5: Auth.gs   (v2 - password login for Admin AND Employee, NO email needed)
*/


const PBKDF_ITER = 1200;
const SETUP_HOURS = 72;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I, easy to read out loud


/* ---------------- crypto helpers ---------------- */
function randomToken_() { return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function sha256Hex_(s) {
 return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
   .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function cache_() { return CacheService.getScriptCache(); }
function pepper_() {
 const p = PropertiesService.getScriptProperties();
 let v = p.getProperty('PEPPER');
 if (!v) { v = randomToken_() + randomToken_(); p.setProperty('PEPPER', v); }
 return v;
}
function derive_(password, salt) {
 const key = Utilities.newBlob(pepper_() + salt).getBytes();
 let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt + ':' + password).getBytes(), key);
 for (let i = 1; i < PBKDF_ITER; i++) h = Utilities.computeHmacSha256Signature(h, key);
 return Utilities.base64Encode(h);
}
function safeEq_(a, b) {
 a = String(a); b = String(b);
 let d = a.length ^ b.length;
 for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
 return d === 0;
}


/* Passwords are stored per person ID (ADM-001, EMP-001 ...). IDs never collide between Admins and Employees. */
function setCred_(id, password) {
 const salt = randomToken_().slice(0, 32);
 PropertiesService.getScriptProperties().setProperty('CRED_' + id,
   JSON.stringify({ salt: salt, hash: derive_(password, salt), updated: Date.now() }));
}
function getCred_(id) {
 const raw = PropertiesService.getScriptProperties().getProperty('CRED_' + id);
 return raw ? JSON.parse(raw) : null;
}
function clearCred_(id) { PropertiesService.getScriptProperties().deleteProperty('CRED_' + id); }
function verifyPassword_(password, cred) { return safeEq_(derive_(password, cred.salt), cred.hash); }
function getSV_(id) { return parseInt(PropertiesService.getScriptProperties().getProperty('SV_' + id) || '0', 10) || 0; }
function bumpSessionVersion_(id) {
 PropertiesService.getScriptProperties().setProperty('SV_' + id, String(getSV_(id) + 1));
}
function validatePassword_(pwd) {
 pwd = String(pwd || '');
 const min = Math.max(6, SN_('PASSWORD_MIN_LENGTH'));
 if (pwd.length < min) fail_('Password must be at least ' + min + ' characters.');
 if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) fail_('Password must contain both letters and numbers.');
}


/* ---------------- rate limiting ---------------- */
function throttle_(key, max, windowSec) {
 const c = cache_();
 const n = parseInt(c.get(key) || '0', 10) || 0;
 if (n >= max) return false;
 c.put(key, String(n + 1), Math.min(windowSec, 21600));
 return true;
}
function isLocked_(prefix, key) { return !!cache_().get(prefix + 'LOCK_' + key); }
function recordFail_(prefix, key) {
 const c = cache_();
 const ttl = Math.min(Math.max(SN_('LOCKOUT_MINUTES'), 1) * 60, 21600);
 const k = prefix + 'FAIL_' + key;
 const n = (parseInt(c.get(k) || '0', 10) || 0) + 1;
 if (n >= Math.max(SN_('MAX_LOGIN_ATTEMPTS'), 1)) { c.put(prefix + 'LOCK_' + key, '1', ttl); c.remove(k); }
 else c.put(k, String(n), ttl);
 return n;
}
function clearFails_(prefix, key) { cache_().remove(prefix + 'FAIL_' + key); cache_().remove(prefix + 'LOCK_' + key); }
function identKey_(ident) {
 const s = String(ident || '').trim();
 return sha256Hex_(s.indexOf('@') > -1 ? normEmail_(s) : normPhone_(s));
}
function lockMsg_() { return 'Too many failed attempts. Please try again after ' + SN_('LOCKOUT_MINUTES') + ' minutes.'; }


/* ---------------- sessions ---------------- */
function sessionKey_(t) { return 'S_' + sha256Hex_(t); }
function authErr_() { return new UserError('Your session has expired. Please sign in again.', 'AUTH'); }
function createSession_(role, subject, minutes) {
 const token = randomToken_();
 const s = {
   role: role, id: subject.id, email: subject.email || '', name: subject.name || '',
   sv: getSV_(subject.id), iat: Date.now()
 };
 cache_().put(sessionKey_(token), JSON.stringify(s), Math.min(Math.max(minutes, 1) * 60, 21600));
 return token;
}
function getSession_(token, role) {
 if (!token || typeof token !== 'string' || token.length < 40) throw authErr_();
 const key = sessionKey_(token);
 const raw = cache_().get(key);
 if (!raw) throw authErr_();
 const s = JSON.parse(raw);
 if (s.role !== role || (Date.now() - s.iat) > 12 * 3600 * 1000) { cache_().remove(key); throw authErr_(); }
 if (s.sv !== getSV_(s.id)) { cache_().remove(key); throw authErr_(); }
 const minutes = role === 'ADMIN' ? SN_('ADMIN_SESSION_MINUTES') : SN_('EMPLOYEE_SESSION_MINUTES');
 cache_().put(key, raw, Math.min(Math.max(minutes, 1) * 60, 21600));   // sliding expiry
 return s;
}
function sessionLogout_(ctx) {
 cache_().remove(sessionKey_(ctx.token));
 log_(ctx, ctx.role + '_LOGOUT', 'SECURITY', ctx.id, '', '', '', 'SUCCESS');
 return { done: true };
}


/* ---------------- lookups ---------------- */
function findEmployeeByIdent_(ident) {
 const s = String(ident || '').trim();
 const isMail = s.indexOf('@') > -1;
 const em = normEmail_(s), ph = normPhone_(s);
 return readAll_('EMP').filter(e => isMail ? normEmail_(e['Email']) === em : (ph.length === 10 && normPhone_(e['Phone']) === ph))[0] || null;
}
function findAdminByIdent_(ident) {
 const s = String(ident || '').trim();
 const isMail = s.indexOf('@') > -1;
 const em = normEmail_(s), ph = normPhone_(s);
 return readAll_('ADM').filter(a => isMail ? normEmail_(a['Email']) === em : (ph.length === 10 && normPhone_(a['Phone']) === ph))[0] || null;
}
function getAdminById_(id) {
 return readAll_('ADM').filter(a => String(a['Admin ID']) === String(id))[0] || null;
}
function checkIdentFormat_(ident) {
 const s = String(ident || '').trim();
 if (!s) fail_('Please enter your email address or mobile number.');
 if (s.indexOf('@') > -1) { if (!isEmail_(s)) fail_('Please enter a valid email address.'); }
 else if (normPhone_(s).length !== 10) fail_('Please enter a valid 10-digit mobile number.');
 return s;
}
function findPerson_(role, ident) { return role === 'ADMIN' ? findAdminByIdent_(ident) : findEmployeeByIdent_(ident); }
function personId_(role, x) { return String(role === 'ADMIN' ? x['Admin ID'] : x['Employee ID']); }
function personName_(role, x) { return String(role === 'ADMIN' ? x['Admin Name'] : x['Employee Name']); }
function personEmail_(role, x) { return String(x['Email'] || (role === 'ADMIN' ? '' : x['Phone']) || ''); }


/* ---------------- ONE-TIME SETUP CODE (first-time sign in / forgot password) ---------------- */
function setupKey_(id) { return 'SETUP_' + id; }
/** 8 characters from an easy alphabet, built only from the safe (random) part of the UUIDs. */
function genSetupCode_() {
 const hex = (Utilities.getUuid().replace(/-/g, '').slice(0, 12) + Utilities.getUuid().replace(/-/g, '').slice(0, 12));
 let out = '';
 for (let i = 0; i < 8; i++) out += CODE_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);   // 256 % 32 = 0, no bias
 return out;
}
/** Creates a new code for this person (replaces any older one). Returns it formatted like ABCD-EFGH. Shown once, never stored in plain text. */
function issueSetupCode_(id, minutes) {
 const code = genSetupCode_();
 const salt = randomToken_().slice(0, 16);
 const ms = minutes ? minutes * 60000 : SETUP_HOURS * 3600000;
 PropertiesService.getScriptProperties().setProperty(setupKey_(id),
   JSON.stringify({ h: sha256Hex_(salt + code + pepper_()), s: salt, a: 0, x: Date.now() + ms }));
 return code.slice(0, 4) + '-' + code.slice(4);
}
/* ---------------- EMAILS FOR CODES / PASSWORD ALERTS ---------------- */
function sendSecMail_(to, name, subject, htmlLines) {
 try {
   if (!isEmail_(to)) return false;
   const co = S_('COMPANY_NAME') || 'Company';
   const body = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2d3a;max-width:520px">' +
     '<p>Hello ' + esc_(name) + ',</p>' + htmlLines.map(l => '<p>' + l + '</p>').join('') +
     '<p style="color:#667788;font-size:12px">' + esc_(co) + ' - Employee Management Portal. This is an automatic message, please do not reply.</p></div>';
   MailApp.sendEmail({ to: to, subject: co + ': ' + subject, htmlBody: body, name: co });
   return true;
 } catch (e) {
   log_({ role: 'SYSTEM' }, 'SECURITY_MAIL_FAILED', 'NOTIFICATION', '', '', '', String(e), 'ERROR');
   return false;
 }
}
function codeBox_(code) {
 return '<div style="font-size:28px;font-weight:800;letter-spacing:5px;color:#0f3d5e;background:#f2f5f9;border-radius:8px;padding:12px;text-align:center">' + esc_(code) + '</div>';
}
/** Emails a setup code to the person's registered email. Returns true if sent. */
function emailSetupCode_(role, person, code, validText, bySelf) {
 const to = String(person['Email'] || '').trim();
 const name = personName_(role, person);
 return sendSecMail_(to, name, 'Your password setup code', [
   bySelf ? 'You asked to set or reset your portal password. Use this code on the sign-in page (<b>Forgot password? / First-time sign in</b>):'
          : 'Admin has issued a code for you to set or reset your portal password. Use it on the sign-in page (<b>Forgot password? / First-time sign in</b>):',
   codeBox_(code),
   'This code works once and is valid for ' + esc_(validText) + '. <b>Never share it with anyone</b>, not even someone from the company.',
   'If you did not expect this email, ignore it. Your password will not change.'
 ]);
}
/** Alert after a password is set / reset. Admin accounts also alert the notification mailbox. */
function notifyPasswordSet_(role, person) {
 const name = personName_(role, person), when = Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy HH:mm');
 sendSecMail_(String(person['Email'] || ''), name, 'Your password was changed', [
   'The password of your portal account was set or changed on <b>' + esc_(when) + '</b>.',
   'All your open sessions were signed out. If this was not you, contact Admin immediately.'
 ]);
 if (role === 'ADMIN') {
   S_('ADMIN_NOTIFICATION_EMAIL').split(/[,;]/).map(s => s.trim()).filter(isEmail_).forEach(m => {
     if (normEmail_(m) === normEmail_(person['Email'])) return;
     sendSecMail_(m, 'Admin', 'Administrator password changed', [
       'The password of administrator <b>' + esc_(name) + '</b> (' + esc_(personId_(role, person)) + ') was set or changed on <b>' + esc_(when) + '</b>.',
       'If this was not expected, please review the System Log.'
     ]);
   });
 }
}


/* ---------------- SELF-SERVICE: "EMAIL ME A CODE" ---------------- */
function requestResetCode_(ctx, p) {
 const role = p.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE';
 const mode = S_('RESET_SELF_SERVICE') || 'ALL';
 if (mode === 'OFF' || (mode === 'EMPLOYEE_ONLY' && role === 'ADMIN'))
   fail_('Emailing a code is turned off for this account type. Please ask Admin for a login code.');
 const ident = checkIdentFormat_(p.identifier);
 const prefix = role === 'ADMIN' ? 'RA' : 'RE', key = identKey_(ident);
 if (isLocked_(prefix, key)) fail_(lockMsg_(), 'LOCK');
 if (!throttle_('RST_GLOBAL', 200, 3600)) fail_('The system is busy. Please try again in a few minutes.', 'LOCK');
 if (!throttle_('RSTI_' + key, 3, 3600)) fail_('Too many code requests. Please try again after one hour, or ask Admin for a code.', 'LOCK');
 if (cache_().get('RSTCD_' + key)) fail_('Please wait one minute before asking for another code.');
 cache_().put('RSTCD_' + key, '1', 60);


 const mins = Math.max(1, SN_('OTP_VALID_MINUTES'));
 const generic = { message: 'If these details match an active account with an email address, a code has been sent to that email. It is valid for ' + mins + ' minutes. Please also check your Spam folder.' };
 const person = findPerson_(role, ident);
 if (!person || String(person['Status']) !== 'Active' || !isEmail_(person['Email'])) {
   log_({ email: ident, role: 'ANONYMOUS' }, role + '_RESET_REQUEST_IGNORED', 'SECURITY', person ? personId_(role, person) : '', '', '', 'No active account with email', 'FAILURE');
   return generic;
 }
 const id = personId_(role, person);
 const code = issueSetupCode_(id, mins);
 const sent = emailSetupCode_(role, person, code, mins + ' minutes', true);
 log_({ email: personEmail_(role, person), role: role }, role + '_RESET_CODE_EMAILED', 'SECURITY', id, '', '', sent ? 'Code emailed' : 'Mail failed', sent ? 'SUCCESS' : 'FAILURE');   // the code is never logged
 return generic;
}
function clearSetup_(id) { PropertiesService.getScriptProperties().deleteProperty(setupKey_(id)); }
/** Throws if the code is wrong or expired. Does NOT delete the code; the caller deletes it after the password is saved. */
function checkSetupCode_(id, code) {
 const p = PropertiesService.getScriptProperties(), key = setupKey_(id);
 const raw = p.getProperty(key);
 const generic = 'This setup code is invalid or has expired. Please ask Admin for a new one.';
 if (!raw) fail_(generic);
 const o = JSON.parse(raw);
 if (Date.now() > o.x) { p.deleteProperty(key); fail_(generic); }
 const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
 o.a = (o.a || 0) + 1;
 const max = Math.max(SN_('OTP_MAX_ATTEMPTS'), 1);
 if (!safeEq_(sha256Hex_(o.s + clean + pepper_()), o.h)) {
   if (o.a >= max) { p.deleteProperty(key); fail_('Too many wrong attempts. This code is cancelled. Please ask Admin for a new one.'); }
   p.setProperty(key, JSON.stringify(o));
   fail_('Incorrect setup code. Attempts left: ' + (max - o.a) + '.');
 }
 return true;
}


/* ---------------- LOGIN (Admin and Employee use the same logic) ---------------- */
function adminSessionResult_(admin) {
 const mins = SN_('ADMIN_SESSION_MINUTES');
 const token = createSession_('ADMIN', { id: admin['Admin ID'], email: admin['Email'], name: admin['Admin Name'] }, mins);
 log_({ email: admin['Email'], role: 'ADMIN' }, 'ADMIN_LOGIN', 'SECURITY', admin['Admin ID'], '', '', '', 'SUCCESS');
 return {
   token: token, sessionMinutes: mins, config: clientConfig_(),
   admin: { id: admin['Admin ID'], name: admin['Admin Name'], email: admin['Email'], role: admin['Role'] }
 };
}
function employeeSessionResult_(emp) {
 const mins = SN_('EMPLOYEE_SESSION_MINUTES');
 const token = createSession_('EMPLOYEE', { id: emp['Employee ID'], email: emp['Email'] || emp['Phone'], name: emp['Employee Name'] }, mins);
 log_({ email: emp['Email'] || emp['Phone'], role: 'EMPLOYEE' }, 'EMPLOYEE_LOGIN', 'SECURITY', emp['Employee ID'], '', '', '', 'SUCCESS');
 return { token: token, user: { id: emp['Employee ID'], name: emp['Employee Name'] }, config: clientConfig_(), sessionMinutes: mins };
}


function passwordLogin_(role, p) {
 const isAdmin = role === 'ADMIN', prefix = isAdmin ? 'A' : 'E';
 const ident = String(p.identifier || '').trim();
 const pwd = String(p.password || '');
 if (!ident || !pwd) fail_('Please enter your email or mobile number and your password.');
 if (!isAdmin && !SB_('SYSTEM_ACTIVE')) fail_('The leave portal is temporarily closed. Please contact Admin.');
 const key = identKey_(ident);
 if (isLocked_(prefix, key)) {
   log_({ email: ident, role: 'ANONYMOUS' }, role + '_LOGIN_BLOCKED', 'SECURITY', '', '', '', 'Account temporarily locked', 'FAILURE');
   fail_(lockMsg_(), 'LOCK');
 }
 if (!throttle_(prefix + '_GLOBAL', 1000, 600)) fail_('The system is busy. Please try again in a few minutes.', 'LOCK');
 const person = findPerson_(role, ident);
 const cred = person ? getCred_(personId_(role, person)) : null;
 let ok = false;
 if (person && cred && String(person['Status']) === 'Active') ok = verifyPassword_(pwd, cred);
 else derive_(pwd, 'timing-equaliser');                 // keep timing similar for unknown users
 if (!ok) {
   recordFail_(prefix, key);
   log_({ email: ident, role: 'ANONYMOUS' }, role + '_LOGIN_FAILED', 'SECURITY', person ? personId_(role, person) : '', '', '', 'Invalid credentials', 'FAILURE');
   fail_('Invalid login details. If this is your first time, or you forgot your password, use "Forgot password? / First-time sign in".');
 }
 clearFails_(prefix, key);
 return isAdmin ? adminSessionResult_(person) : employeeSessionResult_(person);
}
function adminLogin_(ctx, p) { return passwordLogin_('ADMIN', p); }
function employeeLogin_(ctx, p) { return passwordLogin_('EMPLOYEE', p); }


/* ---------------- FIRST-TIME SIGN IN / FORGOT PASSWORD (setup code from Admin) ---------------- */
function firstSignIn_(ctx, p) {
 const role = p.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE';
 const prefix = role === 'ADMIN' ? 'SA' : 'SE';
 const ident = checkIdentFormat_(p.identifier);
 const key = identKey_(ident);
 if (isLocked_(prefix, key)) fail_(lockMsg_(), 'LOCK');
 if (!throttle_(prefix + '_GLOBAL', 300, 600)) fail_('The system is busy. Please try again in a few minutes.', 'LOCK');
 const pwd = String(p.newPassword || '');
 if (pwd !== String(p.confirmPassword || '')) fail_('The two passwords do not match.');
 validatePassword_(pwd);                                  // checked first so a typo never wastes a code attempt
 const person = findPerson_(role, ident);
 if (!person || String(person['Status']) !== 'Active') {
   recordFail_(prefix, key);
   log_({ email: ident, role: 'ANONYMOUS' }, role + '_SETUP_REJECTED', 'SECURITY', '', '', '', 'No active match', 'FAILURE');
   fail_('This setup code is invalid or has expired. Please ask Admin for a new one.');
 }
 const id = personId_(role, person);
 withLock_(() => {
   try { checkSetupCode_(id, p.code); }
   catch (e) {
     recordFail_(prefix, key);
     log_({ email: ident, role: 'ANONYMOUS' }, role + '_SETUP_CODE_FAILED', 'SECURITY', id, '', '', e.message, 'FAILURE');
     throw e;
   }
   setCred_(id, pwd);
   clearSetup_(id);
   bumpSessionVersion_(id);                               // ends every existing session of this person
 });
 clearFails_(prefix, key); clearFails_(role === 'ADMIN' ? 'A' : 'E', key);
 log_({ email: personEmail_(role, person), role: role }, role + '_PASSWORD_SET', 'SECURITY', id, '', '', 'Password set with a setup code; sessions ended', 'SUCCESS');
 try { notifyPasswordSet_(role, person); } catch (e) { /* mail must never block the change */ }
 return { message: 'Your password has been set. Please sign in with your new password.' };
}


/* ---------------- CHANGE PASSWORD (signed-in admin) ---------------- */
function adminChangePassword_(ctx, p) {
 const cred = getCred_(ctx.id);
 if (!cred || !verifyPassword_(String(p.currentPassword || ''), cred)) {
   log_(ctx, 'ADMIN_PASSWORD_CHANGE_FAILED', 'SECURITY', ctx.id, '', '', 'Current password wrong', 'FAILURE');
   fail_('Your current password is incorrect.');
 }
 const pwd = String(p.newPassword || '');
 if (pwd !== String(p.confirmPassword || '')) fail_('The two new passwords do not match.');
 if (pwd === String(p.currentPassword)) fail_('The new password must be different from the current password.');
 validatePassword_(pwd);
 setCred_(ctx.id, pwd);
 bumpSessionVersion_(ctx.id);
 try { notifyPasswordSet_('ADMIN', ctx.admin); } catch (e) { /* mail is optional */ }
 log_(ctx, 'ADMIN_PASSWORD_CHANGED', 'SECURITY', ctx.id, '', '', 'Password changed; all sessions ended', 'SUCCESS');
 return { message: 'Password changed. Please sign in again.' };
}


/* ---------------- request contexts ---------------- */
function employeeCtx_(token) {
 const s = getSession_(token, 'EMPLOYEE');
 if (!SB_('SYSTEM_ACTIVE')) fail_('The leave portal is temporarily closed. Please contact Admin.', 'AUTH');
 const emp = getEmpById_(s.id);
 if (!emp || String(emp['Status']) !== 'Active') { cache_().remove(sessionKey_(token)); throw authErr_(); }
 return { role: 'EMPLOYEE', id: emp['Employee ID'], email: emp['Email'] || emp['Phone'], emp: emp, token: token };
}
function adminCtx_(token) {
 const s = getSession_(token, 'ADMIN');
 const a = getAdminById_(s.id);
 if (!a || String(a['Status']) !== 'Active') { cache_().remove(sessionKey_(token)); throw authErr_(); }
 return { role: 'ADMIN', adminRole: a['Role'], id: a['Admin ID'], email: a['Email'], name: a['Admin Name'], admin: a, token: token };
}
function adminMe_(ctx) {
 return { admin: { id: ctx.id, name: ctx.name, email: ctx.email, role: ctx.adminRole }, config: clientConfig_() };
}


/** Owner runs ONCE from the editor: deletes leftover password data from the old employee login. Safe to run again. */
function removeEmpPasswordData() {
 assertOwnerRun_();
 const p = PropertiesService.getScriptProperties(), all = p.getProperties();
 let n = 0;
 Object.keys(all).forEach(k => { if (/^(ECRED_|ESV_)/.test(k)) { p.deleteProperty(k); n++; } });
 const msg = 'Removed ' + n + ' leftover employee password entries.';
 Logger.log(msg);
 return msg;
}

