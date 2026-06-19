// register the kept slash commands: /togglerandom /togglementions /togglebot
// /ask + the "Ask <char>" message context menu

import { REST, Routes, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } from "discord.js";
import type { Logger } from "../utils/logger";

export class CommandManager {
  private rest: REST;

  constructor(token: string, private log: Logger) {
    this.rest = new REST({ version: "10" }).setToken(token);
  }

  async registerCommands(applicationId: string, characterName = "Character"): Promise<void> {
    const contextMenuCmd = new ContextMenuCommandBuilder()
      .setName(`Ask ${characterName}`.slice(0, 32))
      .setType(ApplicationCommandType.Message)
      .toJSON();
    // guild-install + user-install so it works anywhere
    (contextMenuCmd as any).integration_types = [0, 1];
    (contextMenuCmd as any).contexts = [0, 1, 2];

    const askCmd = new SlashCommandBuilder()
      .setName("ask")
      .setDescription(`Send a prompt directly to ${characterName}`)
      .addStringOption((o) => o.setName("prompt").setDescription("Your message").setRequired(true))
      .toJSON();
    (askCmd as any).integration_types = [0, 1];
    (askCmd as any).contexts = [0, 1, 2];

    const commands = [
      new SlashCommandBuilder().setName("togglerandom").setDescription("Toggle random responses"),
      new SlashCommandBuilder().setName("togglementions").setDescription("Toggle replies to mentions"),
      new SlashCommandBuilder().setName("togglebot").setDescription("Enable/disable bot responses"),
    ].map((c) => c.toJSON());

    try {
      await this.rest.put(Routes.applicationCommands(applicationId), {
        body: [...commands, contextMenuCmd, askCmd],
      });
      this.log.info("Slash commands registered");
    } catch (err) {
      this.log.error("Failed to register commands:", err);
    }
  }
}
