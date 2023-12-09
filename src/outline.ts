import { BunchNode } from "./bunch";
import { ItemList } from "./internal/item_list";
import { NumberItemManager } from "./internal/sparse_items";
import { Order } from "./order";
import { Position } from "./position";

/**
 * A JSON-serializable saved state for an Outline.
 *
 * To save an Outline's current state, call `outline.save()`. You can then call
 * `outline2.load(savedState)` to load that state into a different Outline `outline2`,
 * possibly in a different session or on a different device.
 *
 * **Before loading a saved state, you must deliver its dependent metadata
 * to the Outline's Order** - e.g., by also saving and loading the Order's state
 * ([example](https://github.com/mweidner037/position-structs#save-load)).
 *
 * ## Format
 *
 * For advanced usage, you may read and write OutlineSavedStates directly.
 *
 * The format is: For each [bunch](https://github.com/mweidner037/position-structs#bunches)
 * with Positions present in the Outline, map the bunch's ID to a sparse array
 * representing the map
 * ```
 * innerIndex -> (true if Position { bunchID, innerIndex } is present).
 * ```
 * bunchID keys are in no particular order.
 *
 * Each sparse array of type `number[]` alternates between "runs" of present and deleted
 * values. Each even index is a count of present values; each odd
 * index is a count of deleted values.
 * E.g. `[2, 3, 1]` means `[true, true, null, null, null, true]`.
 */
export type OutlineSavedState = {
  [bunchID: string]: number[];
};

/**
 * An outline for a list of values. It represents an ordered map with Position keys, but unlike List,
 * it only tracks which Positions are present - not their associated values.
 *
 * See [List, Position, and Order](https://github.com/mweidner037/position-structs#list-position-and-order) in the readme.
 *
 * Outline is useful when you are already storing a list's values in a different sequence data structure,
 * but you still need to convert between Positions and list indices.
 */
export class Outline {
  readonly order: Order;
  private readonly itemList: ItemList<number, true>;

  /**
   * Constructs a LocalList whose allowed [[Position]]s are given by
   * `source`.
   *
   * Using positions that were not generated by `source` (or a replica of
   * `source`) will cause undefined behavior.
   *
   * @param order The source for positions that may be used with this
   * LocalList.
   */
  constructor(order?: Order) {
    this.order = order ?? new Order();
    this.itemList = new ItemList(this.order, new NumberItemManager());
  }

  /**
   *
   * @param positions Don't need to be in list order.
   * @param order Mandatory to remind you to load its BunchMetas first.
   * @returns
   */
  static from(positions: Iterable<Position>, order: Order): Outline {
    const outline = new Outline(order);
    for (const pos of positions) {
      outline.set(pos);
    }
    return outline;
  }

  // ----------
  // Mutators
  // ----------

  /**
   * Sets the value at `pos`.
   *
   * @throws TODO pos invalid
   */
  set(pos: Position): void;
  /**
   * TODO
   *
   * If multiple values are given, they are set starting at startPos
   * in the same BunchNode. Note these might not be contiguous anymore,
   * unless they are new (no causally-future Positions set yet).
   * @param startPos
   * @param sameBunchValues
   */
  set(startPos: Position, sameBunchCount?: number): void;
  set(startPos: Position, count = 1): void {
    // TODO: return existing.save()? Likewise in delete, setAt?, deleteAt?
    this.itemList.set(startPos, count);
  }

  /**
   * Deletes the given position, making it no longer
   * present in this list.
   *
   * @returns Whether the position was actually deleted, i.e.,
   * it was initially present.
   */
  delete(pos: Position): void;
  delete(startPos: Position, sameBunchCount?: number): void;
  delete(startPos: Position, count = 1): void {
    this.itemList.delete(startPos, count);
  }

  /**
   * Deletes `count` values starting at `index`.
   *
   * @throws If index...index+count-1 are not in `[0, this.length)`.
   */
  deleteAt(index: number, count = 1): void {
    const toDelete = new Array<Position>(count);
    for (let i = 0; i < count; i++) {
      toDelete[i] = this.positionAt(index + i);
    }
    // OPT: batch delta updates, like for same-node update.
    for (const pos of toDelete) this.itemList.delete(pos, 1);
  }

  /**
   * Deletes every value in the list.
   *
   * The Order is unaffected (retains all Nodes).
   */
  clear() {
    this.itemList.clear();
  }

  insert(prevPos: Position): [pos: Position, createdBunch: BunchNode | null];
  /**
   *
   * @param index
   * @throws If count = 0 (doesn't know what to return).
   */
  insert(
    prevPos: Position,
    count?: number
  ): [startPos: Position, createdBunch: BunchNode | null];
  insert(
    prevPos: Position,
    count = 1
  ): [startPos: Position, createdBunch: BunchNode | null] {
    return this.itemList.insert(prevPos, count);
  }

  insertAt(index: number): [pos: Position, createdBunch: BunchNode | null];
  /**
   *
   * @param index
   * @throws If count = 0 (doesn't know what to return).
   */
  insertAt(
    index: number,
    count?: number
  ): [startPos: Position, createdBunch: BunchNode | null];
  insertAt(
    index: number,
    count = 1
  ): [startPos: Position, createdBunch: BunchNode | null] {
    return this.itemList.insertAt(index, count);
  }

  // ----------
  // Accessors
  // ----------

  /**
   * Returns whether position is currently present in the list,
   * i.e., its value is present.
   */
  has(pos: Position): boolean {
    return this.itemList.has(pos);
  }

  /**
   * Returns the current index of position.
   *
   * If position is not currently present in the list,
   * then the result depends on searchDir:
   * - "none" (default): Returns -1.
   * - "left": Returns the next index to the left of position.
   * If there are no values to the left of position,
   * returns -1.
   * - "right": Returns the next index to the right of position.
   * If there are no values to the right of position,
   * returns [[length]].
   *
   * To find the index where a position would be if
   * present, use `searchDir = "right"`.
   */
  indexOfPosition(
    pos: Position,
    searchDir: "none" | "left" | "right" = "none"
  ): number {
    return this.itemList.indexOfPosition(pos, searchDir);
  }

  /**
   * Returns the position currently at index.
   *
   * Won't return MIN_POSITION or MAX_POSITION. TODO: actually, will if they're
   * part of the list - check that code is compatible.
   */
  positionAt(index: number): Position {
    return this.itemList.positionAt(index);
  }

  /**
   * Returns the cursor at `index` within the list.
   * That is, the cursor is between the list elements at `index - 1` and `index`.
   *
   * Internally, a cursor is the Position of the list element to its left
   * (or `MIN_POSITION` for the start of the list).
   * If that position becomes not present in the list, the cursor stays the
   * same, but its index moves left.
   *
   * Invert with indexOfCursor.
   */
  cursorAt(index: number): Position {
    return index === 0 ? Order.MIN_POSITION : this.positionAt(index - 1);
  }

  /**
   * Returns the current index of `cursor` within the list.
   * That is, the cursor is between the list elements at `index - 1` and `index`.
   *
   * Inverts cursorAt.
   */
  indexOfCursor(cursor: Position): number {
    return Order.equalsPosition(cursor, Order.MIN_POSITION)
      ? 0
      : this.indexOfPosition(cursor, "left") + 1;
  }

  /**
   * The length of the list.
   */
  get length() {
    return this.itemList.length;
  }

  // ----------
  // Iterators
  // ----------

  /**
   * Returns an iterator for present positions, in list order.
   */
  [Symbol.iterator](): IterableIterator<Position> {
    return this.positions();
  }

  /**
   * Returns an iterator for present positions, in list order.
   *
   * Args as in Array.slice.
   */
  *positions(start?: number, end?: number): IterableIterator<Position> {
    for (const [pos] of this.itemList.entries(start, end)) yield pos;
  }

  // ----------
  // Save & Load
  // ----------

  /**
   * Returns saved state describing the current state of this LocalList,
   * including its values.
   *
   * The saved state may later be passed to [[load]]
   * on a new instance of LocalList, to reconstruct the
   * same list state.
   *
   * Only saves values, not Order. "Natural" format; order
   * guarantees.
   */
  save(): OutlineSavedState {
    return this.itemList.save(cloneItems);
  }

  /**
   * Loads saved state. The saved state must be from
   * a call to [[save]] on a LocalList whose `source`
   * constructor argument was a replica of this's
   * `source`, so that we can understand the
   * saved state's Positions.
   *
   * Overwrites whole state - not state-based merge.
   *
   * @param savedState Saved state from a List's
   * [[save]] call.
   */
  load(savedState: OutlineSavedState): void {
    this.itemList.load(savedState, cloneItems);
  }
}

function cloneItems(items: number[]): number[] {
  // Defensive copy
  return items.slice();
}
