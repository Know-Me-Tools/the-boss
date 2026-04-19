CREATE TABLE `agent_runtime_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `runtime_kind` text NOT NULL,
  `config` text NOT NULL,
  `is_default` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_profiles_kind` ON `agent_runtime_profiles` (`runtime_kind`);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_profiles_default` ON `agent_runtime_profiles` (`runtime_kind`,`is_default`);
--> statement-breakpoint
CREATE TABLE `agent_runtime_settings` (
  `runtime_kind` text PRIMARY KEY NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `config` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_settings_enabled` ON `agent_runtime_settings` (`enabled`);
--> statement-breakpoint
CREATE TABLE `agent_runtime_session_bindings` (
  `session_id` text NOT NULL,
  `runtime_kind` text NOT NULL,
  `agent_id` text,
  `runtime_session_id` text NOT NULL,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`session_id`, `runtime_kind`),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_session_bindings_agent_id` ON `agent_runtime_session_bindings` (`agent_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_session_bindings_runtime_session_id` ON `agent_runtime_session_bindings` (`runtime_session_id`);
--> statement-breakpoint
CREATE TABLE `agent_runtime_skill_syncs` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text,
  `session_id` text,
  `skill_id` text NOT NULL,
  `runtime_kind` text NOT NULL,
  `external_ref` text,
  `checksum` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `last_error` text,
  `synced_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_skill_syncs_agent_runtime` ON `agent_runtime_skill_syncs` (`agent_id`,`runtime_kind`);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_skill_syncs_session_runtime` ON `agent_runtime_skill_syncs` (`session_id`,`runtime_kind`);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_skill_syncs_skill` ON `agent_runtime_skill_syncs` (`skill_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_runtime_skill_syncs_status` ON `agent_runtime_skill_syncs` (`status`);
