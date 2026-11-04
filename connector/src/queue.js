export class ActionQueue {
  constructor({minDelayMs = 30000} = {}) {
    this.minDelayMs = Math.max(1000, minDelayMs);
    this.queue = [];
    this.running = false;
  }

  push(action) {
    this.queue.push(action);
    return this.queue.length;
  }

  async drain(run) {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const action = this.queue.shift();
        await run(action);
        if (this.queue.length) await new Promise(r => setTimeout(r, this.minDelayMs));
      }
    } finally {
      this.running = false;
    }
  }
}
