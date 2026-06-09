ALTER TABLE `eras` ADD `categories` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `categories` text;--> statement-breakpoint
UPDATE `eras` SET `categories` = json_array(trim(`category`)) WHERE `category` IS NOT NULL AND trim(`category`) != '';