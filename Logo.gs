/**
* Logo.gs
*/
const LOGO_CHUNK_ = 8000, LOGO_MAX_ = 110000;


function logoDataUri_() {
 try {
   const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('LOGO_N')) || 0;
   if (!n) return '';
   let s = '';
   for (let i = 0; i < n; i++) s += (p.getProperty('LOGO_' + i) || '');
   return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : '';
 } catch (e) { return ''; }
}


function logoClear_() {
 const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('LOGO_N')) || 0;
 for (let i = 0; i < n; i++) p.deleteProperty('LOGO_' + i);
 p.deleteProperty('LOGO_N');
}


function adminLogoSave_(ctx, p) {
 needOwner_(ctx);
 const d = String(p.data || '');
 if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(d)) fail_('Please upload a PNG, JPG or WEBP image.');
 if (d.length > LOGO_MAX_) fail_('The logo is too large. Please use a smaller image.');
 const lock = LockService.getScriptLock(); lock.waitLock(20000);
 try {
   logoClear_();
   const props = PropertiesService.getScriptProperties(), n = Math.ceil(d.length / LOGO_CHUNK_), o = {};
   for (let i = 0; i < n; i++) o['LOGO_' + i] = d.substr(i * LOGO_CHUNK_, LOGO_CHUNK_);
   o['LOGO_N'] = String(n);
   props.setProperties(o);
 } finally { lock.releaseLock(); }
 log_(ctx, 'LOGO_CHANGED', 'SETTINGS', 'LOGO', '', 'Uploaded', '', 'SUCCESS');
 return { message: 'Logo updated.', logo: d };
}


function adminLogoRemove_(ctx) {
 needOwner_(ctx);
 logoClear_();
 log_(ctx, 'LOGO_REMOVED', 'SETTINGS', 'LOGO', '', 'Removed', '', 'SUCCESS');
 return { message: 'Logo removed.', logo: '' };
}

