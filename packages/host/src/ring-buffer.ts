export class RingBuffer<T> {
  private items: T[] = [];
  private readonly capacity: number;
  private firstSeq = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      const drop = this.items.length - this.capacity;
      this.items.splice(0, drop);
      this.firstSeq += drop;
    }
  }

  /** Return items whose absolute index is > since. Returns null if since is before ring range (caller should ask client to resync). */
  since(since: number): T[] | null {
    if (since < this.firstSeq - 1) return null;
    const startIdx = since - this.firstSeq + 1;
    if (startIdx < 0) return this.items.slice();
    return this.items.slice(startIdx);
  }

  get size(): number {
    return this.items.length;
  }

  get range(): [number, number] {
    return [this.firstSeq, this.firstSeq + this.items.length - 1];
  }
}
