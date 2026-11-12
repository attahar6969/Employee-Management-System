/**
* AttendanceSetPunch.gs
*/
function adminAttSetPunch_(ctx, p) {
 const want = String(p.status || '').trim();
 if (['Present', 'Half day'].indexOf(want) < 0) fail_('Please choose Present or Half day.');
 const reason = String(p.reason || '').trim();
 if (reason.length < 3) fail_('Please enter the reason (at least 3 characters).');
 if (reason.length > 300) fail_('The reason is too long (maximum 300 characters).');
 const tm = s => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim()); return m ? { h: +m[1], mi: +m[2] } : null; };
 const tOut = tm(p.outTime);
 if (!tOut) fail_('Please enter the punch-out time.');
 const inGiven = String(p.inTime || '').trim(), tIn = inGiven ? tm(inGiven) : null;
 if (inGiven && !tIn) fail_('Punch-in time is not valid.');
 let msg = '';
 withLock_(() => {
   const emp = getEmpById_(p.empId);
   if (!emp) fail_('Employee not found.');
   if (emp['Status'] !== 'Active') fail_('Attendance can be set only for Active employees.');
   const ymd = String(p.date || '').trim(), d = parseYmd_(ymd), now = new Date(), todayIso = iso_(now);
   if (!d) fail_('Invalid date.');
   if (ymd > todayIso) fail_('Attendance cannot be set for a future date.');
   attAssertOpen_(ymd);
   const joining = emp['Joining Date'] instanceof Date ? iso_(emp['Joining Date']) : '';
   if (joining && ymd < joining) fail_('This date is before the employee joined (' + dmy_(emp['Joining Date']) + ').');


   const row = attFindRow_(emp['Employee ID'], ymd);
   const hasIn = !!(row && row['Punch In Time'] instanceof Date);
   if (row && row['Punch Out Time'] instanceof Date) fail_('This day already has a punch-out. Use Approve / Adjust instead.');
   if (!hasIn && !tIn) fail_('There is no punch-in for this day. Please enter the punch-in time too.');


   const inDate = hasIn ? row['Punch In Time'] : new Date(d.getFullYear(), d.getMonth(), d.getDate(), tIn.h, tIn.mi);
   const outDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), tOut.h, tOut.mi);
   if (outDate <= inDate) fail_('Punch-out time must be after the punch-in time (' + attTime_(inDate) + ').');
   if (outDate > now) fail_('Punch-out time cannot be in the future.');


   const flagged = !!row && attIsFlagged_(attDayOut_(row, ymd, todayIso), String(row['Review Status'] || ''));
   const note = 'Punch times set by Admin: ' + reason;
   const ch = {
     'Punch Out Time': outDate, 'Out Lat': '', 'Out Lng': '', 'Out Accuracy': '', 'Out Distance (m)': '',
     'Out Photo File ID': '', 'Out Photo URL': '', 'Out Flag': '', 'Out Request Key': 'ADMIN',
     'Status': want, 'Approval Status': want === 'Present' ? 'Approved' : 'Adjusted', 'Approved By': ctx.email, 'Approved At': now,
     'Approval Remarks': note, 'Marked By': ctx.email, 'Mark Reason': note, 'Marked At': now, 'Updated At': now
   };
   if (!hasIn) Object.assign(ch, { 'Punch In Time': inDate, 'In Lat': '', 'In Lng': '', 'In Accuracy': '', 'In Distance (m)': '',
     'In Photo File ID': '', 'In Photo URL': '', 'In Flag': '', 'In Request Key': 'ADMIN' });
   if (flagged) Object.assign(ch, { 'Review Status': 'Reviewed', 'Reviewed By': ctx.email, 'Reviewed At': now, 'Review Remarks': note });


   let id;
   if (row) { updateObj_('ATT', row._row, ch); id = row['Attendance ID']; }
   else {
     id = uid_('ATT');
     appendObj_('ATT', Object.assign({ 'Attendance ID': id, 'Employee ID': emp['Employee ID'], 'Employee Name': emp['Employee Name'], 'Date': d, 'Created At': now }, ch));
   }
   log_(ctx, 'ATTENDANCE_PUNCH_SET_BY_ADMIN', 'ATTENDANCE', id,
     { employee: emp['Employee ID'], date: ymd, in: hasIn ? attTime_(inDate) : '', out: '' },
     { in: attTime_(inDate), out: attTime_(outDate), status: want }, reason, 'SUCCESS');
   msg = emp['Employee Name'] + ': punch ' + (hasIn ? '' : 'in ' + attTime_(inDate) + ' and ') + 'out ' + attTime_(outDate) +
     ' saved for ' + dmy_(d) + ', marked ' + want + '.';
 });
 return { message: msg };
}
