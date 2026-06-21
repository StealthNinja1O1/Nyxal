ALTER TABLE `bots` ADD `comfyui_workflow_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bots` ADD `comfyui_default_workflow_id` text REFERENCES comfyui_workflows(id);