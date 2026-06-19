CREATE TABLE `tool_call_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`args` text NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text,
	`ms` integer DEFAULT 0 NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`channel_id` text,
	`message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
