import { IDs } from "./ids";
import { assert, LastInternal, precond } from "./util";

/**
 * ALGORITHM
 *
 * The underlying total order is similar to the string implementation
 * of Plain Tree described
 * [here](https://mattweidner.com/2022/10/21/basic-list-crdt.html#intro-string-implementation).
 * The difference is a common-case optimization: left-to-right insertions
 * by the same PositionSource reuse the same (ID, counter)
 * pair (we call this a _waypoint_), just using
 * an extra _valueIndex_ to distinguish positions
 * within the sequence, instead of creating a long
 * rightward path in the tree. In this way,
 * a sequence of m left-to-right insertions see their
 * positions grow by O(log(m)) length (the size of
 * valueIndex) instead of O(m) length (the size of
 * a path containing one node per insertion).
 *
 * In more detail, the underlying tree consists of alternating
 * layers:
 * - Nodes in even layers (starting with the root's children)
 * are __waypoints__, each labeled by a pair (ID, counter). A waypoint can be either a left or right
 * child of its parent, except that the root only has right
 * children. Waypoint same-siblings siblings are sorted arbitrarily,
 * as in Plain Tree.
 * - Nodes in odd layers are __value indices__, each labelled
 * by a nonnegative integer. A value index is always a right
 * child of its parent. Value indices are sorted
 * *lexicographically*; we use a subset of numbers for which
 * this coincides with the usual order by magnitude.
 *
 * Each position corresponds to a value index node in the tree
 * whose parent waypoint's ID equals the position's
 * creator. A position is a string description of the path
 * from the root to its node (excluding the root).
 * Each pair of nodes (waypoint = (ID, counter), valueIndex)
 * is represented by the substring (here written like a template literal):
 * ```
 * ${ID},${counter},${valueIndex}${l or r}
 * ```
 * where the final value is 'l' if the next node is a left
 * child, else 'r' (including if this pair is the final node pair,
 * to ensure that a terminal node is sorted in between its
 * left and right children). For efficiency, counter and valueIndex
 * are base36-encoded.
 *
 * For the above representation to sort correctly even if fields have
 * different lengths, we use the relations:
 * - ',' < all ID characters: Thus if ID1 < ID2, also `${ID1},${etc}` < ID2,
 * including in the case when ID1 is a prefix of ID2.
 * - ',' < all base-36 numeric characters: Likewise for counters.
 * - No valueIndex is a prefix of another (lexSucc property):
 * Thus if valueIndex1 < valueIndex2, also `${valueIndex1}r` < valueIndex2
 * and `${valueIndex1}l` < valueIndex2.
 */

/**
 * A source of lexicographically-ordered "position strings" for
 * collaborative lists and text.
 *
 * In a collaborative list (or text string), you need a way to refer
 * to "positions" within that list that:
 * 1. Point to a specific list element (or text character).
 * 2. Are global (all users agree on them) and immutable (they do not
 * change over time).
 * 3. Can be sorted.
 * 4. Are unique, even if different users concurrently create positions
 * at the same place.
 *
 * PositionSource gives you such positions, in the form
 * of lexicographically-ordered strings. Specifically, `createBetween`
 * returns a new position string in between two existing position strings.
 *
 * These strings have the bonus properties:
 * - 5. (Non-Interleaving) If two PositionSources concurrently create a (forward or backward)
 * sequence of positions at the same place,
 * their sequences will not be interleaved.
 * For example, if
 * Alice types "Hello" while Bob types "World" at the same place,
 * and they each use a PositionSource to create a position for each
 * character, then
 * the resulting order will be "HelloWorld" or "WorldHello", not
 * "HWeolrllod".
 * - 6. If a PositionSource creates positions in a forward (increasing)
 * sequence, their lengths as strings will only grow logarithmically,
 * not linearly.
 *
 * Position strings are printable ASCII. Specifically, they
 * contain alphanumeric characters and `','`.
 * Also, the special string `PositionSource.LAST` is `'~'`.
 *
 * Further reading:
 * - [Fractional indexing](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/#fractional-indexing),
 * a related scheme that satisfies 1-3 but not 4-6.
 * - [List CRDTs](https://mattweidner.com/2022/10/21/basic-list-crdt.html)
 * and how they map to position strings. PositionSource uses an optimized
 * variant of that link's string implementation.
 * - [Paper](https://www.repository.cam.ac.uk/handle/1810/290391) about
 * interleaving in collaborative text editors.
 */
export class PositionSource {
  /**
   * A string that is less than all positions.
   *
   * Value: `""`.
   */
  static readonly FIRST: string = "";
  /**
   * A string that is greater than all positions.
   *
   * Value: `"~"`.
   */
  static readonly LAST: string = LastInternal;

  /**
   * The unique ID for this PositionSource.
   */
  readonly ID: string;

  /**
   * Maps counter to the most recently used
   * valueIndex for the waypoint (this.ID, counter).
   */
  private lastValueIndices: number[] = [];

  /**
   * Constructs a new PositionSource.
   *
   * It is okay to share a single PositionSource between
   * all documents (lists/text strings) in the same JavaScript runtime.
   *
   * For efficiency, within each JavaScript runtime, you should not use
   * more than one PositionSource for the same document (list/text string).
   * An exception is if multiple logical users share the same runtime;
   * we then recommend one PositionSource per user.
   *
   * @param options.ID A unique ID for this PositionSource. Defaults to
   * `IDs.random()`.
   *
   * If provided, `options.ID` must satisfy:
   * - It is unique across the entire collaborative application, i.e.,
   * all PositionSources whose positions may be compared to ours. This
   * includes past PositionSources, even if they correspond to the same
   * user/device.
   * - All characters are lexicographically greater than `','` (code point 44).
   * - The first character is lexicographically less than `'~'` (code point 126).
   *
   * If `options.ID` contains non-alphanumeric characters, created positions
   * will contain those characters and `','`.
   */
  constructor(options?: { ID?: string }) {
    if (options?.ID !== undefined) {
      IDs.validate(options.ID);
    }
    this.ID = options?.ID ?? IDs.random();
    // OPT: flag where you promise to use fixed ID lengths, then we get
    // rid of the comma after ID? Though makes createBetween trickier.
  }

  /**
   * Returns a new position between `left` and `right`
   * (`left < new < right`).
   *
   * The new position is unique across the entire collaborative application,
   * even in the face on concurrent calls to this method on other
   * PositionSources.
   *
   * @param left Defaults to `PositionSource.FIRST` (insert at the beginning).
   * @param right Defaults to `PositionSource.LAST` (insert at the end).
   */
  createBetween(
    left: string = PositionSource.FIRST,
    right: string = PositionSource.LAST
  ): string {
    precond(left < right, "left must be less than right:", left, "!<", right);
    precond(
      right <= PositionSource.LAST,
      "right must be less than or equal to LAST",
      right,
      PositionSource.LAST
    );

    const leftFixed = left === PositionSource.FIRST ? null : left;
    const rightFixed = right === PositionSource.LAST ? null : right;

    let ans: string;

    if (
      rightFixed !== null &&
      (leftFixed === null || rightFixed.startsWith(leftFixed))
    ) {
      // Left child of right.
      ans = rightFixed.slice(0, -1) + "l" + this.newWaypoint();
    } else {
      // Right child of left.
      if (leftFixed === null) {
        ans = this.newWaypoint();
      } else {
        // Check if we can reuse right's leaf waypoint.
        // For this to happen, right's leaf waypoint must have also
        // been sent by us, and its next valueIndex must not
        // have been used already (i.e., the node matches
        // this.lastValueIndices).
        let success = false;
        const lastComma = leftFixed.lastIndexOf(",");
        const secondLastComma = leftFixed.lastIndexOf(",", lastComma - 1);
        const leafSender = leftFixed.slice(
          secondLastComma - this.ID.length,
          secondLastComma
        );
        if (leafSender === this.ID) {
          const leafCounter = parseNumber(
            leftFixed.slice(secondLastComma + 1, lastComma)
          );
          const leafValueIndex = parseNumber(
            leftFixed.slice(lastComma + 1, -1)
          );
          if (this.lastValueIndices[leafCounter] === leafValueIndex) {
            // Success; reuse a's leaf waypoint.
            const valueIndex = lexSucc(leafValueIndex);
            this.lastValueIndices[leafCounter] = valueIndex;
            ans =
              leftFixed.slice(0, lastComma + 1) +
              stringifyNumber(valueIndex) +
              "r";
            success = true;
          }
        }
        if (!success) {
          // Failure; cannot reuse left's leaf waypoint.
          ans = leftFixed + this.newWaypoint();
        }
      }
    }

    assert(left < ans! && ans! < right, "Bad position:", left, ans!, right);
    return ans!;
  }

  /**
   * Returns a node corresponding to a new waypoint, also
   * updating this.lastValueIndices accordingly.
   */
  private newWaypoint(): string {
    const counter = this.lastValueIndices.length;
    this.lastValueIndices.push(0);
    return `${this.ID},${stringifyNumber(counter)},0r`;
  }
}

/**
 * Base 36 encoding, using capital letters to avoid confusion
 * with 'l' and 'r'. This works with lexSucc since the base36
 * chars are lexicographically ordered by value.
 */
function stringifyNumber(n: number): string {
  return n.toString(36).toUpperCase();
}

/**
 * Inverse of stringifyNumber.
 */
function parseNumber(s: string): number {
  return Number.parseInt(s.toLowerCase(), 36);
}

const log36 = Math.log(36);

/**
 * Returns the successor of n in an enumeration of a special
 * set of numbers.
 *
 * That enumeration has the following properties:
 * 1. Each number is a nonnegative integer (however, not all
 * nonnegative integers are enumerated).
 * 2. The number's base-36 representations are enumerated in
 * lexicographic order, with no prefixes (i.e., no string
 * representation is a prefix of another).
 * 3. The n-th enumerated number has O(log(n)) base-36 digits.
 *
 * Properties (2) and (3) are analogous to normal counting,
 * with the usual order by magnitude; the novelty here is that
 * we instead use the lexicographic order on base-36 representations.
 * It is also the case that
 * the numbers are in order by magnitude, although we do not
 * use this property.
 *
 * The specific enumeration is:
 * - Start with 0.
 * - Enumerate 18^1 numbers (0, 1, ..., h = 17).
 * - Add 1, multiply by 36, then enumerate 18^2 numbers
 * (i0, i1, ..., qz).
 * - Add 1, multiply by 36, then enumerate 18^3 numbers
 * (r0, r1, ..., vhz).
 * - Repeat this pattern indefinitely, enumerating
 * 18^d d-digit numbers for each d >= 1. Putting a decimal place
 * in front of each number, each d consumes 2^(-d) of the remaining
 * values, so we never "reach 1" (overflow to d+1 digits when
 * we meant to use d digits).
 */
function lexSucc(n: number): number {
  const d = n === 0 ? 1 : Math.floor(Math.log(n) / log36) + 1;
  if (n === Math.pow(36, d) - Math.pow(18, d) - 1) {
    // n -> (n + 1) * 36
    return (n + 1) * 36;
  } else {
    // n -> n + 1
    return n + 1;
  }
}
