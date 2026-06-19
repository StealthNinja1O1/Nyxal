CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_fetched_at` integer,
	`last_fetch_error` text
);
--> statement-breakpoint
CREATE TABLE `mcp_tools` (
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`input_schema` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `name`),
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `tool_overrides` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `bots` ADD `mcp_server_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bots` DROP COLUMN `allow_renaming`;--> statement-breakpoint
ALTER TABLE `bots` DROP COLUMN `allow_lorebook_editing`;--> statement-breakpoint
ALTER TABLE `characters` ADD `system_prompt` text;