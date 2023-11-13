/**
 * A map from "Node IDs" `{ creatorID, timestamp }` to values.
 *
 * We can't use Map for this because we want by-value equality for object keys.
 */
export class NodeMap<T> {
  /**
   * A two-level map (creatorID -> (timestamp -> T)) storing this NodeMap's state.
   */
  readonly state = new Map<string, Map<number, T>>();

  get(node: { creatorID: string; timestamp: number }): T | undefined {
    return this.state.get(node.creatorID)?.get(node.timestamp);
  }

  /**
   * Exploded form of `get`.
   */
  get2(creatorID: string, timestamp: number): T | undefined {
    return this.state.get(creatorID)?.get(timestamp);
  }

  set(node: { creatorID: string; timestamp: number }, value: T): void {
    let byCreator = this.state.get(node.creatorID);
    if (byCreator === undefined) {
      byCreator = new Map();
      this.state.set(node.creatorID, byCreator);
    }
    byCreator.set(node.timestamp, value);
  }

  delete(node: { creatorID: string; timestamp: number }): boolean {
    const byCreator = this.state.get(node.creatorID);
    if (byCreator === undefined) return false;
    const had = byCreator.delete(node.timestamp);
    if (byCreator.size === 0) this.state.delete(node.creatorID);
    return had;
  }

  *values(): IterableIterator<T> {
    for (const byCreator of this.state.values()) yield* byCreator.values();
  }

  isEmpty() {
    return this.state.size === 0;
  }

  /**
   * Returns an arbitrary key that is present in this map.
   *
   * If the map is empty, behavior is undefined.
   */
  someKey(): { creatorID: string; timestamp: number } {
    const [creatorID, byCreator] = this.state.entries().next().value as [
      string,
      Map<number, T>
    ];
    const timestamp = byCreator.keys().next().value as number;
    return { creatorID, timestamp };
  }
}
