# Docs

What the reverse engineering established about the OM-1 (E143 v1.9) firmware and hardware, the plan, and the multi-model
survey. The facts about the firmware and the hardware are what emu is built on. Where a spec describes how the emulator
or its harness chooses to behave, treat it as the model's assumption, not as hardware behaviour; the code is in `emu/`
(`emu/src/`, `emu/checks/check_*.mjs`).

## Index

| Document | What it covers |
|---|---|
| [ROADMAP.md](ROADMAP.md) | what is done, the open items, and the plan: multi-model, the debug API, the emulator's architecture, full-boot LLE, the firmware-patch track, hardware validation |
| [hle-gaps.md](hle-gaps.md) | what a complete HLE of E143 still lacks below the camera application, block by block (firmware footprint, seam, dependencies, code size and coverage, effort, first step), the order of the work, and the shutter mechanism across bodies |
| [model-survey.md](model-survey.md) | every body the vendor's updater API serves (32, E100-E147), what each shares with E143 and E144, and where each ported body stands |
| [firmware-container.md](firmware-container.md) | fetching firmware from the updater API, the `.BIN` container, its scramble and checksum, the bodies served, repacking and flashing |
| [mn10300-isa-spec.md](mn10300-isa-spec.md) | the MN10300 base ISA as implemented: the opcode map, semantics, faults, the unknowns that must fault, the lab translator, exceptions and interrupts |
| [om1-udf-spec.md](om1-udf-spec.md) | the OM-1's user-defined (UDF) instructions: integer multiply and HI, the binary32 float unit, the context unit |
| [om1-cores-spec.md](om1-cores-spec.md) | the four CPU cores: boot per core, task placement, inter-core traffic, shared resources |
| [om1-intc-timer-spec.md](om1-intc-timer-spec.md) | the interrupt controller and the timer block, and the assumptions the lab makes about them |
| [om1-kernel-spec.md](om1-kernel-spec.md) | the uITRON kernel as the lab runs it natively (K-native): control blocks, services, the lab task, interrupts |
| [om1-vsc-spec.md](om1-vsc-spec.md) | the VSC display compositor: address map, timing, planes, mixing, the lab model, the live-view API, colour management |
| [om1-text-spec.md](om1-text-spec.md) | GUI text: resource records, string tables, language loading, fonts, DrawText |
| [om1-menu-spec.md](om1-menu-spec.md) | menu pages: data, the GUI path, the reference, navigation, the EVF layout, screens beyond the menu |
| [om1-settings-spec.md](om1-settings-spec.md) | the settings store and the SCPU interface |
| [om1-input-spec.md](om1-input-spec.md) | keys, dials, switches and touch in the lab: UI_IN, the touch driver, the stand-ins |
| [om1-shutter-spec.md](om1-shutter-spec.md) | what S1, S2 and REC reach in the firmware, the image sensor stand-in (S-SCENE), and the camera application running natively |

The emulator's own documents are in `emu/` ([README](../emu/README.md), [ARCHITECTURE](../emu/ARCHITECTURE.md),
[FIDELITY-NOTES](../emu/FIDELITY-NOTES.md)); the firmware-patch investigations are in `analysis/`
([feature gap](../analysis/feature-gap/README.md), [lens gates](../analysis/lens-gates/README.md),
[ND128](../analysis/nd128/README.md)).

## Evidence tags

Load-bearing claims carry a tag:

- **X**: executed or measured, in the lab or by a named command.
- **D**: read from the firmware's code or data, with the address shown.
- **I**: inference; how strong is said where it matters.
- **?**: unknown.

Some specs add their own labels: `A-*` and `A1`..`A19` are assumptions the lab makes, `H-*` harness choices, `S-*`
stand-ins for parts of the camera the lab does not run, `U*` and `B*` open questions; each spec lists its labels with
their evidence.

## Addresses

Unless a spec says otherwise, addresses are in E143 v1.9's main code block (`blk00000000`):

- **Code addresses** are disassembly notation: body offset + `0x50000000`, the block's load address (`0x502d00f1`).
- **Data addresses** are run-time addresses: body offset + `0x60021020`, the base the code's pointers assume
  (`0x602f4eb6`). The lab runs the image at that base; on another body the base is its own (`docs/model-survey.md`).
- **File or body offsets** (`0x2d00f1`) are offsets into the descrambled block, not into the packed `.BIN`;
  `analysis/` mostly uses these.
- An address followed by a body code, as in `0x501850f6` (E144), is in that body's build; `emu/bin/xto.mjs` and
  `xwhere.mjs` translate between E143 and a ported body.
- `(0xa31f1d26)` in parentheses means the word stored at that address; `0x501db6d5..0x501db824` is a range.
