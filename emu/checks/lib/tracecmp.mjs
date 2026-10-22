// A dumped lab trace read back as the tracer object bin/run.mjs's comparator reads (bin/webgate.mjs).
import { FORMAT4 } from '../../src/trace/tracer.mjs';

// a dumped JS trace as the tracer object firstDivergence reads
export function asTracer(doc) {
  const { devices, planes, lab, ...final } = doc.final;
  return { events: doc.events, final, final_devices: devices, final_planes: planes, final_lab: lab, fmt: doc.format, fmt4: doc.format === FORMAT4,
    stub_hits: (doc.inventory?.stub_hits ?? []).map((x) => x), sim: null, name: doc.scenario };
}
