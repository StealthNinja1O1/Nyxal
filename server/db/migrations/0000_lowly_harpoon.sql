CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`discord_token` text NOT NULL,
	`channel_ids` text NOT NULL,
	`allowed_user_ids` text NOT NULL,
	`mention_trigger_allowed_user_ids` text NOT NULL,
	`trigger_keywords` text NOT NULL,
	`llm_provider_id` text,
	`llm_model` text NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`vision_provider_id` text,
	`vision_model` text,
	`enable_vision` integer DEFAULT false NOT NULL,
	`random_response_rate` integer DEFAULT 50 NOT NULL,
	`max_history_messages` integer DEFAULT 30 NOT NULL,
	`max_context_tokens` integer DEFAULT 20000 NOT NULL,
	`ignore_other_bots` integer DEFAULT true NOT NULL,
	`reply_to_mentions` integer DEFAULT true NOT NULL,
	`add_timestamps` integer DEFAULT true NOT NULL,
	`add_nothink` integer DEFAULT false NOT NULL,
	`enable_user_status` integer DEFAULT false NOT NULL,
	`allow_renaming` integer DEFAULT false NOT NULL,
	`allow_lorebook_editing` integer DEFAULT false NOT NULL,
	`min_response_interval_seconds` integer DEFAULT 0 NOT NULL,
	`max_recursion_depth` integer DEFAULT 2 NOT NULL,
	`log_level` text DEFAULT 'INFO' NOT NULL,
	`status` text NOT NULL,
	`comfyui` text NOT NULL,
	`websearch` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`llm_provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vision_provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`mes_example` text DEFAULT '' NOT NULL,
	`depth_prompt` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_bot_id_unique` ON `characters` (`bot_id`);--> statement-breakpoint
CREATE TABLE `command_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`commands` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `llm_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`provider_id` text,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`ms` integer DEFAULT 0 NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `llm_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` text,
	`level` text NOT NULL,
	`scope` text DEFAULT 'system' NOT NULL,
	`message` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`keys` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`case_sensitive` integer DEFAULT false NOT NULL,
	`selective` integer DEFAULT false NOT NULL,
	`secondary_keys` text NOT NULL,
	`selective_logic` integer DEFAULT 0 NOT NULL,
	`constant` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`scan_depth` integer,
	`probability` integer DEFAULT 100 NOT NULL,
	`use_probability` integer DEFAULT false NOT NULL,
	`extensions` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `static_lorebook_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`keys` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`case_sensitive` integer DEFAULT false NOT NULL,
	`selective` integer DEFAULT false NOT NULL,
	`secondary_keys` text NOT NULL,
	`selective_logic` integer DEFAULT 0 NOT NULL,
	`constant` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`scan_depth` integer,
	`probability` integer DEFAULT 100 NOT NULL,
	`use_probability` integer DEFAULT false NOT NULL,
	`extensions` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
