CREATE TABLE `chat_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`start_message_id` text,
	`end_message_id` text,
	`token_estimate` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_summary_state` (
	`bot_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`last_summarized_message_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bot_id`, `channel_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `summary` text NOT NULL DEFAULT '{"enabled":true,"summaryThresholdTokens":2000,"maxSummariesPerChat":10,"rollingWindowMessages":30,"summaryModel":"","minSummaryTokens":100,"countFallbackRatio":0.5}';