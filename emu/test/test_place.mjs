// src/fw/place.mjs's placer on a synthetic map (no firmware): a data word in a's image copy whose vote has no majority.
//   placeUnits: a vote with no majority (a tie, or none with more than half) placed by the delta both neighbours give
//     (how 'near'), whether or not it is one of the voted addresses (E146's REC_IMAGE queue word), by one neighbour's
//     ('near1') only where it lands on a most-voted address (E145's WB_MOV task id word), never by the
//     walks' pairing of the word's bytes as an instruction (E122's 0x60360bfc at 4e08ef9, docs/model-survey.md finding
//     155), and unplaced with no neighbours' delta; a vote with a majority, and a word with no vote and a walk pairing,
//     place as before (the vote; the walks).
//   node emu/test/test_place.mjs
import { placer } from '../src/fw/place.mjs';

const BASE_A = 0x60000000, BASE_B = 0x61000000, SIZE = 0x2000;
const h = (v) => (v === null || v === undefined ? String(v) : '0x' + (v >>> 0).toString(16));

// a's and b's image copies (no 0xff fill, so the whole block is used), the map with its data votes ([a address,
// [[b address, votes]...]]) and the walks' pairing (a offset -> b offset)
function place(votes, walks = []) {
  const a = Buffer.alloc(SIZE, 0x11), b = Buffer.alloc(SIZE, 0x22);
  const code = new Int32Array(SIZE).fill(-1);
  for (const [oa, ob] of walks) code[oa] = ob;
  const map = { code, data: new Map(votes.map(([v, m]) => [v >>> 0, new Map(m)])), calls: new Map(), ext: new Map() };
  return placer({ a, b, baseA: BASE_A, baseB: BASE_B, map, entries: [] }).mapPlace;
}

export function placeUnits() {
  const bad = [];
  let checks = 0;
  const want = (what, got, to, how) => {
    checks++;
    if ((got?.to ?? null) !== to || (how !== undefined && got?.how !== how)) bad.push(`${what}: ${h(got?.to)} (${got?.how}), want ${h(to)}${how ? ` (${how})` : ''}`);
  };
  // E122's shape (finding 155): the word at +0x1000 voted 4 and 4 for b's +0x100c and +0x1000, its neighbours at
  // -4 and +4 voted 4 of 4 with b's +0x1000's delta, and the walks pairing its bytes with b's +0x0e06 as an instruction
  const V = BASE_A + 0x1000, D = BASE_B + 0x1000, E = BASE_B + 0x100c;
  const neighbours = [[V - 4, [[D - 4, 4]]], [V + 4, [[D + 4, 4]]]];
  const walks = [[0x1000, 0x0e06]];
  want('a tie the neighbours place', place([[V, [[E, 4], [D, 4]]], ...neighbours], walks)(V), D, 'near');
  want('the same tie, the other order of the votes', place([[V, [[D, 4], [E, 4]]], ...neighbours], walks)(V), D, 'near');
  // E146's shape: the tied votes are both b's other words (+0xffe and +0x1012), the neighbours give +0x1000
  want('a tie for neither of which the neighbours place', place([[V, [[D - 2, 4], [D + 0x12, 4]]], ...neighbours], walks)(V), D, 'near');
  // no strict majority without a tie (8 of 16)
  want('no strict majority', place([[V, [[E, 8], [D, 4], [D + 0x20, 4]]], ...neighbours], walks)(V), D, 'near');
  // one neighbour within 4 KB: its delta where it lands on a most-voted address, else unplaced (E145's WB_MOV id word)
  want('a tie with one neighbour on a voted address', place([[V, [[E, 4], [D, 4]]], neighbours[0]], walks)(V), D, 'near1');
  want('a tie with one neighbour on no voted address', place([[V, [[E, 4], [D + 4, 4]]], neighbours[0]], walks)(V), null);
  // no neighbours: unplaced, not the walks' +0x0e06
  want('a tie with no neighbours', place([[V, [[E, 4], [D, 4]]]], walks)(V), null);
  // neighbours that disagree, both more than 4 KB away: unplaced
  want('a tie with far neighbours that disagree', place([[V, [[E, 4], [D, 4]]], [V - 0x2000, [[D - 0x2000, 4]]], [V + 0x2000, [[D + 0x2008, 4]]]], walks)(V), null);
  // a majority is the vote's, whatever the neighbours and the walks
  want('a majority', place([[V, [[E, 8], [D, 4]]], ...neighbours], walks)(V), E, 'vote');
  // no vote: the walks' pairing (code in the copy)
  want('no vote, a walk pairing', place([...neighbours], walks)(V), BASE_B + 0x0e06, 'code');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = placeUnits();
  console.log(`place.mjs units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
