// A body's own start steps, which the boot runs and the lab, ending the init task, does not: shared by a play
// session's bring-up (src/lab/play.mjs PlaySession) and the lab's own creation of the GUI (src/lab/menu.mjs MenuLab
// bring_up, the nav session's), each on a lab (a MenuLab). Each throws Err (the caller's error class) on a refusal.
//   dpcInit       H-DPCINIT: the deferred calls' init (fact 'dpc.init')
//   sioStart      S-SIOIIC: PER_SIO's serial controller for the body's devices (src/lab/sio.mjs)
//   powerTaskStart H-PWRTASK: the power task (fact 'power.task'), started and settled
import { fact, refuseUnmapped } from '../fw/model.mjs';
import { DPC_E143 } from '../fw/facts.mjs';
import * as IRQ from './irq.mjs';
import * as K from './kernel.mjs';
import { SioBus } from './sio.mjs';
import { show } from '../util/show.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

const h8 = (v) => '0x' + fx(v >>> 0, 8);

// H-DPCINIT: the deferred calls' init (fact 'dpc.init', src/fw/facts.mjs deferredCalls), which the boot head runs
// before the kernel and the lab does not, natively on a board with the deferred-call triggers (src/dev/dpc.mjs, board
// dpc): the call rings cleared, the six trigger words written 0, their IRQs attached (the first two on every core,
// disabled until a post enables them). A post then raises its IRQ, and the handler runs the call at the MN's next
// idle point (A-DPC-1). On the E144 family's board the triggers were lab-stub words before, which kept a post's 1 and
// raised nothing: E132's start posts the send of its first serial request so (X; docs/model-survey.md)
export function dpcInit(lab, Err) {
  const dev = lab.sim.m.devices.dpc, writes = dev.writes, init = fact('dpc', DPC_E143).init;
  if (writes) throw new Err(`H-DPCINIT: ${writes} trigger writes before the deferred calls' init (words ${show([...dev.words])}): a post before the bring-up`);
  refuseUnmapped(init, 'H-DPCINIT');
  lab.call(init, null, null, null, 200000);
  const missing = dev.cfg.irqs.filter((n) => !lab.sim.u32(IRQ.HANDLER_TABLE + 4 * n));
  if (dev.writes - writes !== dev.cfg.irqs.length || dev.words.some((w) => w) || missing.length) {
    throw new Err(`H-DPCINIT: after ${h8(init)}: ${dev.writes - writes} trigger writes, words ${show([...dev.words])}, IRQs without a handler ${show(missing)}`);
  }
  return true;
}

// S-SIOIIC: PER_SIO's serial controller for the channels the body's devices sit on (src/lab/sio.mjs, src/fw/models.mjs
// sio_devices: the TG-5's internal charger on channel 9), served at its driver's transfer starts before the power
// task's start configures the charger's channel. Returns the bus
export function sioStart(lab) {
  const sio = new SioBus(lab);
  sio.bring_up();
  return sio;
}

// H-PWRTASK: the power task (fact 'power.task', src/fw/facts.mjs powerTask), which the boot starts and the lab, ending
// the init task, did not: started natively with act_tsk and settled (settle(label), the caller's). Its entry runs the
// power module's init, the internal charger's with it (the charger's IIC channel configuration and its completion
// flag, which the charger's requests use), and waits on its queue (X: E132). E132's camera application start makes the
// charger's requests, whose transfer computed its channel's clock divisor from the unset configuration and divided
// by zero before (X; docs/model-survey.md). Returns the task's id
export function powerTaskStart(lab, settle, Err) {
  const entry = fact('power.task', null);
  const ids = [...lab.nk.tasks()].filter(([, [e]]) => e === entry).map(([t]) => t);
  if (ids.length !== 1 || lab.nk.state(ids[0]) !== 0x10) throw new Err(`H-PWRTASK: static tasks with entry ${h8(entry)}: ${show(ids)}, not one dormant`);
  lab.lt.allow.add(entry);
  const [rc] = lab.nk.svc('act_tsk', { d0: ids[0] });
  if (rc !== K.E_OK) throw new Err(`H-PWRTASK: act_tsk(${ids[0]}) = ${rc}`);
  settle('H-PWRTASK');
  if (lab.nk.state(ids[0]) !== 4) throw new Err(`H-PWRTASK: the power task ${ids[0]} is ${show(lab.task_states())} after its start, not waiting`);
  return ids[0];
}
