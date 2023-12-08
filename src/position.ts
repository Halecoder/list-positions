/**
 * A Position in a collaborative list or text string.
 *
 * A Position points to a specific list element (or text character),
 * as described in the [readme](https://github.com/mweidner037/position-structs#readme).
 * It is represented as an immutable struct, i.e., a flat JSON object.
 *
 * To consult the total order on Positions, you must first construct an Order
 * and supply it with some metadata. You can then use those Positions in a List
 * on top of that Order, or call `Order.compare` to order them directly.
 *
 * Internally, the pair `{ creatorID, timestamp }` identifies a BunchNode
 * in Order's internal tree, while `innerIndex` identifies a specific value
 * belonging to that BunchNode.
 * The "metadata" you must supply to Order is a NodeMeta for the node with NodeID
 * `{ creatorID, timestamp }`.
 *
 * @see Order.equalsPosition
 */
export type Position = {
  /**
   * The Position's BunchNode's id.
   */
  readonly bunchID: string;
  /**
   * The index of this Position among its BunchNode's values, which is a
   * nonnegative integer.
   *
   * A given BunchNode's Positions are created with `innerIndex`s in counting
   * order (0, 1, 2, ...).
   * Those Positions are in list order, and they are initially contiguous in
   * the list, but later insertions may get between them.
   */
  readonly innerIndex: number;
};

/**
 * Encoded form of Position that is lexicographically ordered wrt other LexPositions.
 *
 * Internally, describes all dependencies (path in the tree). Can use without worrying
 * about them; "delivering" to an Order applies all of those deps. Can also use
 * indie of an Order, e.g. DB "ORDER BY" column; see LexUtils.
 */
export type LexPosition = string;
