// Spreadsheet formula injection ("CSV injection"): a text cell that begins with
// = + - @ (or a tab / carriage return) may be executed as a formula when the file
// is opened in Excel, LibreOffice or Google Sheets. Prefixing a single quote makes
// the application treat the cell as plain text. This is the OWASP-recommended
// mitigation. Only TEXT is altered; real numbers, booleans and dates are written
// with their native types, so legitimate negative numbers are untouched.
//
// Trade-off (documented): a text value such as "-5 apples" or "=total" is exported
// as "'-5 apples" / "'=total". Data integrity of a downloaded file is secondary to
// never executing attacker-controlled content on a user's machine.

const TRIGGER_AT_START = /^[=+\-@\t\r]/;
const TRIGGER_AFTER_SPACE = /^[ \t\r\n]+[=+\-@]/;

export function sanitizeCellText(s: string): string {
  if (s.length === 0) return s;
  return TRIGGER_AT_START.test(s) || TRIGGER_AFTER_SPACE.test(s) ? `'${s}` : s;
}
