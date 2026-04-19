CREATE TABLE `skill_scopes` (
  `scope_type` text NOT NULL,
  `scope_id` text NOT NULL,
  `config` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_skill_scopes_scope_type` ON `skill_scopes` (`scope_type`);
--> statement-breakpoint
CREATE INDEX `idx_skill_scopes_scope_id` ON `skill_scopes` (`scope_id`);
