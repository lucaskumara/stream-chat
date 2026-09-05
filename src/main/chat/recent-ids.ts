export class RecentIds {
  private readonly ids = new Set<string>()
  private readonly order: string[] = []

  constructor(private readonly limit: number) {}

  has(id: string): boolean {
    return this.ids.has(id)
  }

  add(id: string): void {
    if (this.ids.has(id)) return

    this.ids.add(id)
    this.order.push(id)

    while (this.order.length > this.limit) {
      const oldest = this.order.shift()
      if (oldest !== undefined) this.ids.delete(oldest)
    }
  }
}
