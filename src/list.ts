import { Node, NodeDesc, Order } from "./order";
import { Position } from "./position";

/**
 * Info about a node's values within a LocalList.
 */
type NodeInfo<T> = {
  /**
   * The total number of present values at this
   * node and its descendants.
   */
  total: number;
  /**
   * The values (or not) at the node's positions,
   * in order from left to right, represented as
   * an array of "items": T[] for present values,
   * positive count for deleted values.
   *
   * The items always alternate types. If the last
   * item would be a number (deleted), it is omitted.
   */
  items: (T[] | number)[];
};

/**
 * Type used in LocalList.valuesAndChildren.
 *
 * TODO: rename ItemsOrChild/itemsAndChildren. Unless it doesn't line up
 * with Order.items() due to split blocks?
 */
type ValuesOrChild<T> =
  | {
      /** True if value, false if child. */
      isValues: true;
      /** Use item.slice(start, end) */
      item: T[];
      start: number;
      end: number;
      /** valueIndex of first value */
      valueIndex: number;
    }
  | {
      /** True if value, false if child. */
      isValues: false;
      child: Node;
      /** Always non-zero (zero total children are skipped). */
      total: number;
    };

/**
 * A local (non-collaborative) data structure mapping [[Position]]s to
 * values, in list order.
 *
 * You can use a LocalList to maintain a sorted, indexable view of a
 * [[CValueList]], [[CList]], or [[CText]]'s values.
 * For example, when using a [[CList]],
 * you could store its archived values in a LocalList.
 * That would let you iterate over the archived values in list order.
 *
 * To construct a LocalList that uses an existing list's positions, pass
 * that list's `totalOrder` to our constructor.
 *
 * It is *not* safe to modify a LocalList while iterating over it. The iterator
 * will attempt to throw an exception if it detects such modification,
 * but this is not guaranteed.
 *
 * @typeParam T The value type.
 */
export class List<T> {
  /**
   * TODO: delete empty ones (total = 0).
   */
  private state = new Map<Node, NodeInfo<T>>();

  /**
   * Constructs a LocalList whose allowed [[Position]]s are given by
   * `source`.
   *
   * Using positions that were not generated by `source` (or a replica of
   * `source`) will cause undefined behavior.
   *
   * @param order The source for positions that may be used with this
   * LocalList.
   *
   * TODO: take either ID or Order as an option?
   */
  constructor(readonly order: Order) {}

  /**
   * Sets the value at position.
   *
   * @returns Whether their was an existing value at position.
   */
  set(pos: Position, value: T): boolean {
    const node = this.order.getNodeFor(pos);
    const info = this.state.get(node);
    if (info === undefined) {
      // Node has no values currently; set them to
      // [valueIndex, [value]].
      // Except, omit 0s.
      const newItems =
        pos.valueIndex === 0 ? [[value]] : [pos.valueIndex, [value]];
      this.state.set(node, {
        total: 0,
        items: newItems,
      });
      this.updateTotals(node, 1);
      return true;
    }

    const items = info.items;
    let remaining = pos.valueIndex;
    for (let i = 0; i < items.length; i++) {
      const curItem = items[i];
      if (typeof curItem !== "number") {
        if (remaining < curItem.length) {
          // Already present. Replace the current value.
          curItem[remaining] = value;
          return false;
        } else remaining -= curItem.length;
      } else {
        if (remaining < curItem) {
          // Replace curItem with
          // [remaining, [value], curItem - 1 - remaining].
          // Except, omit 0s and combine [value] with
          // neighboring arrays if needed.
          let startIndex = i;
          let deleteCount = 1;
          const newItems: (T[] | number)[] = [[value]];

          if (remaining !== 0) {
            newItems.unshift(remaining);
          } else if (i !== 0) {
            // Combine [value] with left neighbor.
            startIndex--;
            deleteCount++;
            (newItems[0] as T[]).unshift(...(items[i - 1] as T[]));
          }
          if (remaining !== curItem - 1) {
            newItems.push(curItem - 1 - remaining);
          } else if (i !== items.length - 1) {
            // Combine [value] with right neighbor.
            deleteCount++;
            (newItems[newItems.length - 1] as T[]).push(
              ...(items[i + 1] as T[])
            );
          }

          items.splice(startIndex, deleteCount, ...newItems);
          this.updateTotals(node, 1);
          return true;
        } else remaining -= curItem;
      }
    }

    // If we get here, the position is in the implied last item,
    // which is deleted.
    // Note that the actual last element of items is necessarily present.
    if (remaining !== 0) {
      items.push(remaining, [value]);
    } else {
      if (items.length === 0) items.push([value]);
      else {
        // Merge value with the preceding present item.
        (items[items.length - 1] as T[]).push(value);
      }
    }
    this.updateTotals(node, 1);
    return true;
  }

  // TODO: setBulk opt for loading a whole node?
  // At least amortize the updateTotals call.

  /**
   * Sets the value at index.
   *
   * @throws If index is not in `[0, this.length)`.
   */
  setAt(index: number, value: T): void {
    this.set(this.position(index), value);
  }

  /**
   * Deletes the given position, making it no longer
   * present in this list.
   *
   * @returns Whether the position was actually deleted, i.e.,
   * it was initially present.
   */
  delete(pos: Position): boolean {
    const node = this.order.getNodeFor(pos);
    const info = this.state.get(node);
    if (info === undefined) {
      // Already not present.
      return false;
    }
    const items = info.items;
    let remaining = pos.valueIndex;
    for (let i = 0; i < items.length; i++) {
      const curItem = items[i];
      if (typeof curItem === "number") {
        if (remaining < curItem) {
          // Already not present.
          return false;
        } else remaining -= curItem;
      } else {
        if (remaining < curItem.length) {
          // Replace curItem[remaining] with
          // [curItem[:remaining], 1, curItem[remaining+1:]].
          // Except, omit empty slices and combine the 1 with
          // neighboring numbers if needed.
          let startIndex = i;
          let deleteCount = 1;
          const newItems: (T[] | number)[] = [1];

          if (remaining !== 0) {
            newItems.unshift(curItem.slice(0, remaining));
          } else if (i !== 0) {
            // Combine 1 with left neighbor.
            startIndex--;
            deleteCount++;
            (newItems[0] as number) += items[i - 1] as number;
          }
          if (remaining !== curItem.length - 1) {
            newItems.push(curItem.slice(remaining + 1));
          } else if (i !== items.length - 1) {
            // Combine 1 with right neighbor.
            deleteCount++;
            (newItems[newItems.length - 1] as number) += items[i + 1] as number;
          }

          items.splice(startIndex, deleteCount, ...newItems);

          // If the last item is a number (deleted), omit it.
          if (typeof items[items.length - 1] === "number") items.pop();

          this.updateTotals(node, -1);
          return true;
        } else remaining -= curItem.length;
      }
    }
    // If we get here, the position is in the implied last item,
    // hence is already deleted.
    return false;
  }

  /**
   * Deletes the value at index.
   *
   * @throws If index is not in `[0, this.length)`.
   */
  deleteAt(index: number): void {
    this.delete(this.position(index));
  }

  /**
   * Changes total by delta for node and all of its ancestors.
   * Creates NodeValues as needed.
   *
   * delta must not be 0.
   */
  private updateTotals(node: Node, delta: number): void {
    for (
      let current: Node | null = node;
      current !== null;
      current = current.parentNode
    ) {
      const info = this.state.get(current);
      if (info === undefined) {
        // Create NodeValues.
        this.state.set(current, {
          // Nonzero by assumption.
          total: delta,
          // Omit last deleted item (= only item).
          items: [],
        });
      } else {
        info.total += delta;
      }
    }
  }

  /**
   * Deletes every value in the list.
   *
   * The Order is unaffected (retains all Nodes).
   */
  clear() {
    this.state.clear();
  }

  insert(
    prevPos: Position,
    value: T
  ): { pos: Position; newNodeDesc: NodeDesc | null } {
    const ret = this.order.createPosition(prevPos);
    this.set(ret.pos, value);
    return ret;
  }

  insertAt(
    index: number,
    value: T
  ): { pos: Position; newNodeDesc: NodeDesc | null } {
    const prevPos =
      index === 0 ? this.order.rootPosition : this.position(index - 1);
    return this.insert(prevPos, value);
  }

  /**
   * Returns the value at position, or undefined if it is not currently present
   * ([[hasPosition]] returns false).
   */
  get(pos: Position): T | undefined {
    return this.locate(pos)[0];
  }

  /**
   * Returns the value currently at index.
   *
   * @throws If index is not in `[0, this.length)`.
   * Note that this differs from an ordinary Array,
   * which would instead return undefined.
   */
  getAt(index: number): T {
    return this.get(this.position(index))!;
  }

  /**
   * Returns whether position is currently present in the list,
   * i.e., its value is present.
   */
  has(pos: Position): boolean {
    return this.locate(pos)[1];
  }

  /**
   * @returns [value at position, whether position is present,
   * number of present values within node
   * (not descendants) strictly prior to position]
   */
  private locate(
    pos: Position
  ): [value: T | undefined, isPresent: boolean, nodeValuesBefore: number] {
    return this.locate2(this.order.getNodeFor(pos), pos.valueIndex);
  }

  /**
   * @returns [value at position, whether position is present,
   * number of present values within node
   * (not descendants) strictly prior to position]
   */
  private locate2(
    node: Node,
    valueIndex: number
  ): [value: T | undefined, isPresent: boolean, nodeValuesBefore: number] {
    const info = this.state.get(node);
    if (info === undefined) {
      // No values within node.
      return [undefined, false, 0];
    }
    let remaining = valueIndex;
    let nodeValuesBefore = 0;
    for (const item of info.items) {
      if (typeof item === "number") {
        if (remaining < item) {
          return [undefined, false, nodeValuesBefore];
        } else remaining -= item;
      } else {
        if (remaining < item.length) {
          return [item[remaining], true, nodeValuesBefore + remaining];
        } else {
          remaining -= item.length;
          nodeValuesBefore += item.length;
        }
      }
    }
    // If we get here, then the valueIndex is after all present values.
    return [undefined, false, nodeValuesBefore];
  }

  /**
   * The nubmer of present values within node (not descendants).
   */
  private valueCount(node: Node): number {
    const info = this.state.get(node);
    if (info === undefined) {
      // No values within node.
      return 0;
    }
    let nodeValues = 0;
    for (const item of info.items) {
      if (typeof item !== "number") {
        nodeValues += item.length;
      }
    }
    return nodeValues;
  }

  /**
   * Returns the current index of position.
   *
   * If position is not currently present in the list
   * ([[hasPosition]] returns false), then the result depends on searchDir:
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
  index(pos: Position, searchDir: "none" | "left" | "right" = "none"): number {
    const node = this.order.getNodeFor(pos);
    const [, isPresent, nodeValuesBefore] = this.locate2(node, pos.valueIndex);
    // Will be the total number of values prior to position.
    let valuesBefore = nodeValuesBefore;

    // Add totals for child nodes that come before valueIndex.
    // These are precisely the left children with
    // parentValueIndex <= valueIndex.
    for (const child of node.children) {
      if (child.parentValueIndex > pos.valueIndex) break;
      valuesBefore += this.total(child);
    }

    // Walk up the tree and add totals for sibling values & nodes
    // that come before our ancestor.
    for (
      let current = node;
      current.parentNode !== null;
      current = current.parentNode
    ) {
      // Sibling values that come before current.
      valuesBefore += this.locate2(
        current.parentNode,
        current.parentValueIndex
      )[2];
      // Sibling nodes that come before current.
      for (const child of current.parentNode.children) {
        if (child === current) break;
        valuesBefore += this.total(child);
      }
    }

    if (isPresent) return valuesBefore;
    else {
      switch (searchDir) {
        case "none":
          return -1;
        case "left":
          return valuesBefore - 1;
        case "right":
          return valuesBefore;
      }
    }
  }

  /**
   * Returns the position currently at index.
   */
  position(index: number): Position {
    if (index < 0 || index >= this.length) {
      throw new Error(`Index out of bounds: ${index} (length: ${this.length})`);
    }
    let remaining = index;
    let node = this.order.rootNode;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      nodeLoop: {
        for (const next of this.valuesAndChildren(node)) {
          if (next.isValues) {
            const length = next.end - next.start;
            if (remaining < length) {
              // Answer is values[remaining].
              return {
                creatorID: node.creatorID,
                timestamp: node.timestamp,
                valueIndex: next.valueIndex + remaining,
              };
            } else remaining -= length;
          } else {
            if (remaining < next.total) {
              // Recurse into child.
              node = next.child;
              break nodeLoop;
            } else remaining -= next.total;
          }
        }
        // We should always end by the break statement (recursion), not by
        // the for loop's finishing.
        throw new Error("Internal error: failed to find index among children");
      }
    }
  }

  // TODO: test, then recomment. Or: redundant b/c of items()?
  /**
   * For debugging: print entries() walk through the tree to console.log.
   */
  printTreeWalk(): void {
    if (this.length === 0) return;

    let index = 0;
    let node: Node | null = this.order.rootNode;
    console.log(
      `"${node.creatorID}",${node.timestamp}: ${this.total(node)} [${index}, ${
        index + this.total(node)
      })`
    );
    // Manage our own stack instead of recursing, to avoid stack overflow
    // in deep trees.
    const stack: IterableIterator<ValuesOrChild<T>>[] = [
      // root will indeed have total != 0 since we checked length != 0.
      this.valuesAndChildren(this.order.rootNode),
    ];
    while (node !== null) {
      const iter = stack[stack.length - 1];
      const next = iter.next();
      if (next.done) {
        stack.pop();
        node = node.parentNode;
      } else {
        const prefix = new Array(stack.length).fill(" ").join(" ");
        const valuesOrChild = next.value;
        if (valuesOrChild.isValues) {
          console.log(
            prefix,
            `${valuesOrChild.valueIndex}:`,
            JSON.stringify(
              valuesOrChild.item.slice(valuesOrChild.start, valuesOrChild.end)
            ),
            `@ [${index}, ${index + valuesOrChild.end - valuesOrChild.start})`
          );
          index += valuesOrChild.end - valuesOrChild.start;
        } else {
          // Recurse into child.
          node = valuesOrChild.child;
          console.log(
            prefix,
            `"${node.creatorID},${node.timestamp} (${
              node.parentValueIndex
            }): ${this.total(node)} @ [${index}, ${index + this.total(node)})`
          );
          stack.push(this.valuesAndChildren(node));
        }
      }
    }
  }

  /**
   * The length of the list.
   */
  get length() {
    return this.total(this.order.rootNode);
  }

  /** Returns an iterator for values in the list, in list order. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.values();
  }

  /**
   * Returns an iterator of [index, value, pos] tuples for every
   * value in the list, in list order.
   */
  *entries(): IterableIterator<[index: number, value: T, pos: Position]> {
    if (this.length === 0) return;

    let index = 0;
    let node: Node | null = this.order.rootNode;
    // Manage our own stack instead of recursing, to avoid stack overflow
    // in deep trees.
    const stack: IterableIterator<ValuesOrChild<T>>[] = [
      // root will indeed have total != 0 since we checked length != 0.
      this.valuesAndChildren(this.order.rootNode),
    ];
    while (node !== null) {
      const iter = stack[stack.length - 1];
      const next = iter.next();
      if (next.done) {
        stack.pop();
        node = node.parentNode;
      } else {
        const valuesOrChild = next.value;
        if (valuesOrChild.isValues) {
          for (let i = 0; i < valuesOrChild.end - valuesOrChild.start; i++) {
            yield [
              index,
              valuesOrChild.item[valuesOrChild.start + i],
              {
                creatorID: node.creatorID,
                timestamp: node.timestamp,
                valueIndex: valuesOrChild.valueIndex + i,
              },
            ];
            index++;
          }
        } else {
          // Recurse into child.
          node = valuesOrChild.child;
          stack.push(this.valuesAndChildren(node));
        }
      }
    }
  }

  /**
   * Yields non-trivial values and Node children
   * for node, in list order. This is used when
   * iterating over the list.
   *
   * Specifically, it yields:
   * - "Sub-items" consisting of a slice of a present item.
   * - Node children with non-zero total.
   *
   * together with enough info to infer their starting valueIndex's.
   *
   * @throws If valuesByNode does not have an entry for node.
   */
  private *valuesAndChildren(node: Node): IterableIterator<ValuesOrChild<T>> {
    const items = this.state.get(node)!.items;
    const children = node.children;
    let childIndex = 0;
    let startValueIndex = 0;
    for (const item of items) {
      const itemSize = typeof item === "number" ? item : item.length;
      // After (next startValueIndex)
      const endValueIndex = startValueIndex + itemSize;
      // Next value to yield
      let valueIndex = startValueIndex;
      for (; childIndex < children.length; childIndex++) {
        const child = children[childIndex];
        if (child.parentValueIndex >= endValueIndex) {
          // child comes after item. End the loop and visit child
          // during the next item.
          break;
        }
        const total = this.total(child);
        if (total !== 0) {
          // Emit child. If needed, first emit values that come before it.
          if (valueIndex < child.parentValueIndex) {
            if (typeof item !== "number") {
              yield {
                isValues: true,
                item,
                start: valueIndex - startValueIndex,
                end: child.parentValueIndex - startValueIndex,
                valueIndex,
              };
            }
            valueIndex = child.parentValueIndex;
          }
          yield { isValues: false, child, total };
        }
      }

      // Emit remaining values in item.
      if (typeof item !== "number" && valueIndex < endValueIndex) {
        yield {
          isValues: true,
          item,
          start: valueIndex - startValueIndex,
          end: itemSize,
          valueIndex,
        };
      }
      startValueIndex = endValueIndex;
    }
    // Visit remaining children (left children among a possible deleted
    // final item (which items omits) and right children).
    for (; childIndex < children.length; childIndex++) {
      const child = children[childIndex];
      const total = this.total(child);
      if (this.total(child) !== 0) {
        yield { isValues: false, child, total };
      }
    }
  }

  /**
   * Returns the total number of present values at this
   * node and its descendants.
   */
  private total(node: Node): number {
    return this.state.get(node)?.total ?? 0;
  }

  /** Returns an iterator for values in the list, in list order. */
  *values(): IterableIterator<T> {
    // OPT: do own walk and yield* value items, w/o encoding positions.
    for (const [, value] of this.entries()) yield value;
  }

  /** Returns an iterator for present positions, in list order. */
  *positions(): IterableIterator<Position> {
    for (const [, , pos] of this.entries()) yield pos;
  }

  /**
   * Returns a copy of a section of this list, as an array.
   * For both start and end, a negative index can be used to indicate an offset from the end of the list.
   * For example, -2 refers to the second to last element of the list.
   * @param start The beginning index of the specified portion of the list.
   * If start is undefined, then the slice begins at index 0.
   * @param end The end index of the specified portion of the list. This is exclusive of the element at the index 'end'.
   * If end is undefined, then the slice extends to the end of the list.
   */
  slice(start?: number, end?: number): T[] {
    const len = this.length;
    if (start === undefined || start < -len) {
      start = 0;
    } else if (start < 0) {
      start += len;
    } else if (start >= len) {
      return [];
    }
    if (end === undefined || end >= len) {
      end = len;
    } else if (end < -len) {
      end = 0;
    } else if (end < 0) {
      end += len;
    }
    if (end <= start) return [];

    // Optimize common case (slice())
    // TODO: opt with Order.items(...)
    if (start === 0 && end === len) {
      return [...this.values()];
    } else {
      // OPT: optimize.
      const ans = new Array<T>(end - start);
      for (let i = 0; i < end - start; i++) {
        ans[i] = this.getAt(start + i);
      }
      return ans;
    }
  }

  /**
   * Returns saved state describing the current state of this LocalList,
   * including its values.
   *
   * The saved state may later be passed to [[load]]
   * on a new instance of LocalList, to reconstruct the
   * same list state.
   *
   * TODO: only saves values, not Order
   */
  save(): ListSavedState<T> {
    const savedStatePre: ListSavedState<T> = {};
    for (const [node, info] of this.state) {
      if (info.items.length === 0) continue;

      let byCreator = savedStatePre[node.creatorID];
      if (byCreator === undefined) {
        byCreator = {};
        savedStatePre[node.creatorID] = byCreator;
      }

      // Deep copy info.items.
      const itemsCopy = new Array<T[] | number>(info.items.length);
      for (let i = 0; i < info.items.length; i++) {
        const item = info.items[i];
        if (typeof item === "number") itemsCopy[i] = item;
        else itemsCopy[i] = item.slice();
      }

      byCreator[node.timestamp] = itemsCopy;
    }

    // Make a (shallow) copy of savedStatePre that touches all
    // creatorIDs in lexicographic order, to ensure consistent JSON
    // serialization order for identical states. (JSON field order is: non-negative
    // integers in numeric order, then string keys in creation order.)
    const sortedCreatorIDs = Object.keys(savedStatePre);
    sortedCreatorIDs.sort();
    const savedState: ListSavedState<T> = {};
    for (const creatorID of sortedCreatorIDs) {
      savedState[creatorID] = savedStatePre[creatorID];
    }

    return savedState;
  }

  /**
   * Loads saved state. The saved state must be from
   * a call to [[save]] on a LocalList whose `source`
   * constructor argument was a replica of this's
   * `source`, so that we can understand the
   * saved state's Positions.
   *
   * TODO: overwrites whole state
   *
   * @param savedState Saved state from a List's
   * [[save]] call.
   */
  load(savedState: ListSavedState<T>): void {
    this.clear();

    // TODO

    // TODO: updateTotals
  }
}

// TODO: should this be itemized instead? For compactness, and in
// case you want to store it that way.
// Indeed, the point of save() is to provide a lazy, non-mergable default instead
// of inventing your own format. (But should provide separate iterator to let you assemble the
// simpler, obvious format.)
export type ListSavedState<T> = {
  [creatorID: string]: {
    [timestamp: number]: (T[] | number)[];
  };
};
