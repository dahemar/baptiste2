/**
 * Paste into the content spreadsheet: Extensions > Apps Script
 * Run once: upgradeMusicTabByProject
 *
 * Adds columns `project` + `project_order` and assigns releases to:
 * Apulati Bien, IVM Trio, XOLOT (extensible — add rows with a new project name).
 */
function upgradeMusicTabByProject() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('music');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Tab "music" not found. Create it first.');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (!data.length) {
    SpreadsheetApp.getUi().alert('Tab "music" is empty.');
    return;
  }

  var headers = data[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = function (name) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : -1;
  };

  var idCol = col('id');
  var titleCol = col('title');
  var projectCol = col('project');
  var projectOrderCol = col('project_order');

  if (idCol < 0 || titleCol < 0) {
    SpreadsheetApp.getUi().alert('music tab needs at least id and title columns.');
    return;
  }

  if (projectCol < 0) {
    projectCol = headers.length;
    sheet.getRange(1, projectCol + 1).setValue('project');
    headers.push('project');
  }
  if (projectOrderCol < 0) {
    projectOrderCol = headers.length;
    sheet.getRange(1, projectOrderCol + 1).setValue('project_order');
    headers.push('project_order');
  }

  var projectForRow = function (id, title) {
    var t = String(title || '').trim().toLowerCase();
    var sid = String(id || '').trim();
    if (sid === '11' || t === 'xolot') return { project: 'XOLOT', order: 3 };
    if (sid === '12' || t.indexOf('ivm') >= 0) return { project: 'IVM Trio', order: 2 };
    return { project: 'Apulati Bien', order: 1 };
  };

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!String(row[titleCol] || '').trim()) continue;
    var mapped = projectForRow(row[idCol], row[titleCol]);
    sheet.getRange(r + 1, projectCol + 1).setValue(mapped.project);
    sheet.getRange(r + 1, projectOrderCol + 1).setValue(mapped.order);
  }

  sheet.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    'music tab updated: columns project + project_order filled. ' +
    'Edit project names or add new rows for future projects.'
  );
}
