CREATE TABLE `oidc_config` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`label` text DEFAULT 'OIDC' NOT NULL,
	`issuer` text,
	`client_id` text,
	`client_secret` text,
	`scopes` text DEFAULT 'openid profile email' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
