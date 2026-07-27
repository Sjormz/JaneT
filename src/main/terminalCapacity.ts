export class NativeTerminalCapacity {
  private readonly owners = new Set<string>();

  constructor(readonly limit = 64) {}

  reserve(owner: string): void {
    if (this.owners.has(owner)) {
      throw new Error(`Terminal id ${owner} is already in use`);
    }
    if (this.owners.size >= this.limit) {
      throw new Error(`Native terminal limit of ${this.limit} reached`);
    }
    this.owners.add(owner);
  }

  release(owner: string): void {
    this.owners.delete(owner);
  }
}
