// iscports DISFILE...: from `objdump -d` text of 32-bit ARM daemons, list ISC_* calls with the r0/r1 immediates set just before
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const res = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/bl\s+(?:0x)?[0-9a-f]+ <(ISC_[a-z_]+|OlyISC_[a-z_]+)@plt>/);
    if (!m) continue;
    const regs = {};
    for (let k = i - 1; k >= Math.max(0, i - 14); k--) {
      const mm = lines[k].match(/\smovs?\s+(r[0-3]),\s+#(-?\d+)/);
      if (mm && !(mm[1] in regs)) regs[mm[1]] = Number(mm[2]);
      if (/\sbl?x?\s/.test(lines[k]) && k < i - 1 && /\sbl\s/.test(lines[k])) break;
    }
    const fn = m[1];
    const key = fn.includes('send') ? `${fn}(node ${regs.r0 ?? '?'}, port ${regs.r1 ?? '?'})` : fn.includes('receive') ? `${fn}(port ${regs.r0 ?? '?'})` : `${fn}(r0 ${regs.r0 ?? '?'})`;
    res.set(key, (res.get(key) || 0) + 1);
  }
  console.log(f.split('/').pop(), [...res].map(([k, v]) => `${k} x${v}`).join('; '));
}
