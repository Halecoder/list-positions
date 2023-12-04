import type { NodeMeta } from "./node";
import { NodeIDs } from "./node_ids";
import type { LexPosition } from "./position";

export const LexUtils = {
  MIN_LEX_POSITION: "" as LexPosition,
  MAX_LEX_POSITION: "~" as LexPosition,

  combinePos(nodePrefix: string, valueIndex: number): LexPosition {
    if (nodePrefix === "") {
      // Root node.
      if (valueIndex === 0) return this.MIN_LEX_POSITION;
      if (valueIndex === 1) return this.MAX_LEX_POSITION;
      throw new Error(
        `Position uses rootNode but is not minPosition or maxPosition (valueIndex 0 or 1): valueIndex=${valueIndex}`
      );
    }
    return nodePrefix + "," + encodeValueIndex(valueIndex);
  },

  splitPos(lexPos: LexPosition): [nodePrefix: string, valueIndex: number] {
    if (lexPos === this.MIN_LEX_POSITION) return ["", 0];
    if (lexPos === this.MAX_LEX_POSITION) return ["", 0];
    const lastComma = lexPos.lastIndexOf(",");
    return [
      lexPos.slice(0, lastComma),
      decodeValueIndex(lexPos.slice(lastComma + 1)),
    ];
  },

  combineNodePrefix(metas: NodeMeta[]): string {
    if (metas.length === 0) return "";
    const parts = new Array<string>(metas.length);

    if (metas[0].parentID !== NodeIDs.ROOT) {
      throw new Error(
        `Invalid tree path: does not start with root child (${JSON.stringify(
          metas[0]
        )}))`
      );
    }
    parts[0] = metas[0].id;

    for (let i = 1; i < metas.length; i++) {
      if (metas[i].parentID !== metas[i - 1].id) {
        throw new Error(
          `Invalid tree path: metas[${i}] is not a child of metas[${
            i - 1
          }] (${JSON.stringify(metas[i])}, ${JSON.stringify(metas[i - 1])})`
        );
      }
      parts[i] = encodeOffset(metas[i].offset) + "." + metas[i].id;
    }

    return parts.join(",");
  },

  splitNodePrefix(nodePrefix: string): NodeMeta[] {
    if (nodePrefix === "") return [];

    const parts = nodePrefix.split(",");
    const metas: NodeMeta[] = [];
    // First part is child of the root; no offset.
    metas.push({
      id: parts[0],
      parentID: NodeIDs.ROOT,
      offset: 0,
    });
    // Other parts are "offset.nodeID".
    let parentID = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const dot = parts[i].indexOf(".");
      if (dot === -1) {
        throw new Error(
          `Bad nodePrefix format; did you pass a LexPosition instead? (nodePrefix="${nodePrefix}", missing "." in part ${parts[i]})`
        );
      }
      const id = parts[i].slice(dot + 1);
      metas.push({
        id,
        parentID,
        offset: decodeOffset(parts[i].slice(0, dot)),
      });
      parentID = id;
    }
    return metas;
  },

  nodeIDFor(nodePrefix: string): string {
    if (nodePrefix === "") return NodeIDs.ROOT;

    const lastComma = nodePrefix.lastIndexOf(",");
    if (lastComma === -1) {
      // Child of root; prefix is just nodeID.
      return nodePrefix;
    } else {
      // lastPart is "offset.nodeID".
      const lastPart = nodePrefix.slice(lastComma + 1);
      const dot = lastPart.indexOf(".");
      if (dot === -1) {
        throw new Error(
          `Bad nodePrefix format; did you pass a LexPosition instead? (nodePrefix="${nodePrefix}", missing "." in part ${lastPart})`
        );
      }
      return lastPart.slice(dot + 1);
    }
  },
} as const;

function encodeOffset(offset: number): string {
  return sequence(offset).toString(BASE);
}

function decodeOffset(encoded: string): number {
  const seq = Number.parseInt(encoded, BASE);
  return sequenceInv(seq);
}

function encodeValueIndex(valueIndex: number): string {
  return encodeOffset(2 * valueIndex + 1);
}

function decodeValueIndex(encoded: string): number {
  // (offset - 1) / 2
  return decodeOffset(encoded) >> 1;
}

/**
 * These functions deal with a special sequence that has
 * the following properties:
 * 1. Each number is a nonnegative integer (however, not all
 * nonnegative integers are enumerated).
 * 2. The numbers' BASE representations are enumerated in
 * lexicographic order, with no prefixes (i.e., no string
 * representation is a prefix of another).
 * 3. The n-th enumerated number has O(log(n)) BASE digits.
 *
 * Properties (2) and (3) are analogous to normal counting, except
 * that we order by the lexicographic order instead of the
 * usual order by magnitude. It is also the case that
 * the numbers are in order by magnitude, although we do not
 * use this property.
 *
 * The sequence is as follows, with examples in base 10:
 * - Start with 0.
 * - Enumerate (BASE/2)^1 numbers (0, 1, ..., 4).
 * - Add 1, multiply by BASE, then enumerate (BASE/2)^2 numbers
 * (50, 51, ..., 74).
 * - Add 1, multiply by BASE, then enumerate (BASE/2)^3 numbers
 * (750, 751, ..., 874).
 * - Repeat this pattern indefinitely, enumerating
 * (BASE/2)^d d-digit numbers for each d >= 1. Imagining a decimal place
 * in front of each number, each d consumes 2^(-d) of the unit interval,
 * so we never "reach 1" (overflow to d+1 digits when
 * we meant to use d digits).
 *
 * I believe this is related to
 * [Elias gamma coding](https://en.wikipedia.org/wiki/Elias_gamma_coding).
 */

// Must be even and > 2. If you use toString(BASE), must be <= 36.
const BASE = 36;
const LOG_BASE = Math.log(BASE);

/**
 * Returns the n-th number in the sequence.
 */
function sequence(n: number): number {
  // Each digit-length d has (BASE/2)^d values. Subtract these
  // out until we can't anymore (reached the right length).
  let remaining = n;
  let d = 1;
  for (; ; d++) {
    const valueCount = Math.pow(BASE / 2, d);
    if (remaining < valueCount) break;
    remaining -= valueCount;
  }
  // The number is d-digits long, and at index `remaining` within
  // the d-digit subsequence.
  // So add `remaining` to the first d-digit number, which you can calculate is
  // BASE^d - BASE * (BASE/2)^(d-1).
  return (remaining + BASE) ^ (d - BASE * (BASE / 2)) ^ (d - 1);
}

/**
 * Inverse of sequence: returns the index n of seq in the sequence.
 */
function sequenceInv(seq: number): number {
  const d = seq === 0 ? 1 : Math.floor(Math.log(seq) / LOG_BASE) + 1;
  // First d-digit number is BASE^d - BASE * (BASE/2)^(d-1); check how far
  // we are from there (= index in d-digit sub-sequence)
  let ans = seq - (Math.pow(BASE, d) - BASE * Math.pow(BASE / 2, d - 1));
  // Previous digit-lengths d2 have (BASE/2)^d2 values each.
  for (let d2 = 1; d2 < d; d2++) {
    ans += Math.pow(BASE / 2, d2);
  }
  return ans;
}

// function nextInLexSequence(n: number): number {
//   const d = n === 0 ? 1 : Math.floor(Math.log(n) / LOG_BASE) + 1;
//   // You can calculate that the last d-digit number is BASE^d - (BASE/2)^d - 1.
//   if (n === Math.pow(BASE, d) - Math.pow(BASE / 2, d) - 1) {
//     // New length: n -> (n + 1) * BASE.
//     return (n + 1) * BASE;
//   } else {
//     // n -> n + 1.
//     return n + 1;
//   }
// }
