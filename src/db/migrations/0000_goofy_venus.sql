CREATE TABLE `eras` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description_md` text,
	`description_html` text,
	`start_date` text NOT NULL,
	`start_precision` text DEFAULT 'day' NOT NULL,
	`end_date` text,
	`end_precision` text,
	`color` text,
	`category` text,
	`cover_media_id` text,
	`visibility` text DEFAULT 'inherit' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `eras_user_start_idx` ON `eras` (`user_id`,`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `eras_user_slug_uq` ON `eras` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`era_id` text,
	`post_id` text,
	`storage_key` text NOT NULL,
	`public_url` text,
	`thumb_url` text,
	`width` integer,
	`height` integer,
	`mime` text,
	`alt` text,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`era_id`) REFERENCES `eras`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_post_idx` ON `media` (`post_id`);--> statement-breakpoint
CREATE INDEX `media_era_idx` ON `media` (`era_id`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_provider_uid_uq` ON `oauth_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `oauth_user_idx` ON `oauth_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`era_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`body_md` text,
	`body_html` text,
	`event_date` text NOT NULL,
	`event_precision` text DEFAULT 'day' NOT NULL,
	`event_end_date` text,
	`visibility` text DEFAULT 'inherit' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`era_id`) REFERENCES `eras`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `posts_era_date_idx` ON `posts` (`era_id`,`event_date`);--> statement-breakpoint
CREATE INDEX `posts_user_vis_idx` ON `posts` (`user_id`,`visibility`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_user_slug_uq` ON `posts` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`scope` text NOT NULL,
	`era_id` text,
	`grantee_user_id` text,
	`invite_email` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`era_id`) REFERENCES `eras`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grantee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_scope_era_grantee_uq` ON `shares` (`scope`,`era_id`,`grantee_user_id`);--> statement-breakpoint
CREATE INDEX `shares_grantee_idx` ON `shares` (`grantee_user_id`);--> statement-breakpoint
CREATE INDEX `shares_owner_scope_era_idx` ON `shares` (`owner_user_id`,`scope`,`era_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`bio` text,
	`birth_date` text,
	`default_visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uq` ON `users` (`handle`);