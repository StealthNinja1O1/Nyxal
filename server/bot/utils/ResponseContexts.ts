import { AttachmentBuilder, Message, CommandInteraction, TextChannel } from "discord.js";

export interface AttachmentData {
  buffer: Buffer;
  name: string;
}

export interface ResponseContext {
  sendReply(content: string): Promise<string | undefined>;
  sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined>;
}

export class MessageResponseContext implements ResponseContext {
  constructor(private message: Message) {}

  async sendReply(content: string): Promise<string | undefined> {
    if (!content?.trim()) return undefined;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [];
    let firstId: string | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const sent = await this.message.reply(chunks[i]!);
      if (i === 0) firstId = sent.id;
    }
    return firstId;
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined> {
    const channel = this.message.channel as TextChannel;
    const sent = await channel.send({ content: content || undefined, files: files?.length ? files : undefined });
    return sent.id;
  }
}

export class InteractionResponseContext implements ResponseContext {
  constructor(
    private interaction:
      | CommandInteraction
      | {
          editReply: (content: string) => Promise<any>;
          followUp: (options: { content?: string; files?: AttachmentBuilder[] }) => Promise<any>;
        },
  ) {}

  async sendReply(content: string): Promise<string | undefined> {
    if (!content?.trim()) return undefined;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [content];
    const first = await this.interaction.editReply(chunks[0]!);
    const firstId = first?.id;
    for (let i = 1; i < chunks.length; i++) await this.interaction.followUp({ content: chunks[i]! });
    return firstId;
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined> {
    const sent = await this.interaction.followUp({
      content: content || undefined,
      files: files?.length ? files : undefined,
    });
    return sent?.id;
  }
}
