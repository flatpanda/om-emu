// The numbers in the lab's text inputs (nav and play tokens, the Player's options): ASCII literals, surrounding white
// space ignored, single underscores allowed between digits. Each parser returns a safe integer or a finite number, or
// null for text it does not accept (the caller raises its own error).

// A decimal integer: an optional sign, then digits ('7', '+7', '-0', '1_000', ' 12 ').
export function decimalInt(text) {
  const t = text.trim();
  return /^[+-]?[0-9]+(?:_[0-9]+)*$/.test(t) ? safe(Number(t.replaceAll('_', ''))) : null;
}
// An integer literal: an optional sign, then 0x / 0o / 0b digits (an underscore may follow the prefix) or a decimal
// without leading zeros (all zeros allowed): '0x1F', '-0b101', '0o17', '42', '000'; '010' is refused.
export function intLiteral(text) {
  const m = /^([+-]?)(?:0([xob])_?([0-9a-f]+(?:_[0-9a-f]+)*)|(0+(?:_0+)*|[1-9][0-9]*(?:_[0-9]+)*))$/i.exec(text.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  if (m[4] !== undefined) return safe(sign * Number(m[4].replaceAll('_', '')));
  const base = { x: 16, o: 8, b: 2 }[m[2].toLowerCase()], digits = m[3].replaceAll('_', '');
  if ([...digits].some((d) => Number.parseInt(d, 16) >= base)) return null;
  return safe(sign * Number.parseInt(digits, base));
}
// A finite decimal number: an optional sign, digits with an optional fraction ('3', '2.5', '.5', '5.') and exponent
// ('1e3', '2.5E-2').
export function decimalNumber(text) {
  const D = '[0-9]+(?:_[0-9]+)*';
  const t = text.trim();
  if (!new RegExp(`^[+-]?(?:${D}(?:\\.(?:${D})?)?|\\.${D})(?:[eE][+-]?${D})?$`).test(t)) return null;
  const v = Number(t.replaceAll('_', ''));
  return Number.isFinite(v) ? v : null;
}
const safe = (v) => (Number.isSafeInteger(v) ? v + 0 : null);
