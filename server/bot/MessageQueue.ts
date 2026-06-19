// per-channel FIFO message queue
import type { Message } from "discord.js";
import type { Logger } from "./utils/logger";

export class MessageQueue {
  private queues = new Map<string, Message[]>();

  constructor(private log: Logger) {}

  enqueue(channelId: string, message: Message): void {
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = [];
      this.queues.set(channelId, queue);
    }
    queue.push(message);
    this.log.debug(
      `Message queued for channel ${channelId} (queue depth: ${queue.length}) - ${message.author.username}: "${message.content.slice(0, 80)}"`,
    );
  }

  dequeue(channelId: string): Message | undefined {
    const queue = this.queues.get(channelId);
    if (!queue || queue.length === 0) return undefined;
    const message = queue.shift()!;
    if (queue.length === 0) this.queues.delete(channelId);
    return message;
  }

  hasPending(channelId: string): boolean {
    const queue = this.queues.get(channelId);
    return !!queue && queue.length > 0;
  }

  size(channelId: string): number {
    return this.queues.get(channelId)?.length ?? 0;
  }

  clear(channelId: string): void {
    this.queues.delete(channelId);
  }
}
