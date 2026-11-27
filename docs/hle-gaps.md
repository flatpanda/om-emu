# HLE gaps: what a complete HLE of the OM-1 still needs

What the lab does not yet model for a complete high-level emulation (HLE) of the OM-1 (E143 v1.9), block by block,
and the plan to close it. HLE here means that the firmware's own code runs natively down to a seam where a device model
or a narrow, named stand-in answers, and that the seam sits where the firmware's code fixes the contract; behaviour
without firmware evidence stays an error, never a guess (ROADMAP intro). This document owns the per-block facts;
[ROADMAP.md](ROADMAP.md) owns the order of work across tracks and its status.

Addresses and tags as in [README.md](README.md): code addresses in disassembly notation, data addresses run-time;
**D** read from code or data, **X** executed in emu, **I** inference, **?** unknown. Code sizes are instruction counts
from the module map (section 2.2). Every effort figure is a rough estimate of focused work (I), not a commitment.

## Files

The document is split by chapter, and chapter 4 by block. Section N.M... lives in `hle-gaps/N.md`, except that
chapter 4's sections 4.B... live in `hle-gaps/4.B.md`; section numbers are the same in every file. A reference
names the file and the section, as `docs/hle-gaps/4.6.md 4.6.5`; inside the document a bare section number
(4.6.5) means the file this rule gives.

| Section | File | Title |
|---|---|---|
| 1 | [hle-gaps/1.md](hle-gaps/1.md) | In brief |
| 2 | [hle-gaps/2.md](hle-gaps/2.md) | Method |
| 3 | [hle-gaps/3.md](hle-gaps/3.md) | The blocks |
| 4.1 | [hle-gaps/4.1.md](hle-gaps/4.1.md) | TAKE module and the HLS shooting sequence |
| 4.2 | [hle-gaps/4.2.md](hle-gaps/4.2.md) | Sensor, ISP front end and live view (with EXP) |
| 4.3 | [hle-gaps/4.3.md](hle-gaps/4.3.md) | Still capture, image processing and recording |
| 4.4 | [hle-gaps/4.4.md](hle-gaps/4.4.md) | AF, lens and body IS |
| 4.5 | [hle-gaps/4.5.md](hle-gaps/4.5.md) | Movie, audio and the AV back end |
| 4.6 | [hle-gaps/4.6.md](hle-gaps/4.6.md) | CPUs 1-3, inter-core services and the A53 |
| 4.7 | [hle-gaps/4.7.md](hle-gaps/4.7.md) | SCPU, power, clock, on-board sensors and persistence |
| 4.8 | [hle-gaps/4.8.md](hle-gaps/4.8.md) | Card, file system and playback |
| 4.9 | [hle-gaps/4.9.md](hle-gaps/4.9.md) | HDMI and DisplayPort |
| 4.10 | [hle-gaps/4.10.md](hle-gaps/4.10.md) | USB, PTP and PictBridge |
| 4.11 | [hle-gaps/4.11.md](hle-gaps/4.11.md) | Wireless |
| 4.12 | [hle-gaps/4.12.md](hle-gaps/4.12.md) | Detection, GPU / C3D, strobe |
| 5 | [hle-gaps/5.md](hle-gaps/5.md) | Cross-cutting prerequisites |
| 6 | [hle-gaps/6.md](hle-gaps/6.md) | Recommended order |
| 7 | [hle-gaps/7.md](hle-gaps/7.md) | The shutter across bodies |
| 8 | [hle-gaps/8.md](hle-gaps/8.md) | Hardware evidence and what it unblocks |
| 9 | [hle-gaps/9.md](hle-gaps/9.md) | Facts settled between the surveys |
| 10 | [hle-gaps/10.md](hle-gaps/10.md) | Open questions |

## 4. Per block: footprint and first step

Each block lists its tasks, kernel objects, MMIO, interrupts and cores as far as the surveys read them, the seam detail,
and the first concrete step. Task ids are `cpu << 12 | index` (kernel spec §2.1).
