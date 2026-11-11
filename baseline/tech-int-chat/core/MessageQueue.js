/** A rejected operation never poisons the next operation. */
export class MessageQueue {
    constructor() { this.tail = Promise.resolve(); }
    run(operation) {
        const result = this.tail.then(operation);
        this.tail = result.catch(() => {});
        return result;
    }
}
