CREATE TABLE `llm_request_capture` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` text NOT NULL,
	`source` text NOT NULL,
	`model` text NOT NULL,
	`temperature` real NOT NULL,
	`messages` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
