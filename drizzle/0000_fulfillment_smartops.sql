CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`barcode` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`line` text NOT NULL,
	`side` text DEFAULT 'A' NOT NULL,
	`bay` integer DEFAULT 1 NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`loss` integer DEFAULT 0 NOT NULL,
	`exp_date` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`);
--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);
--> statement-breakpoint
CREATE INDEX `idx_products_line_side` ON `products` (`line`,`side`);
--> statement-breakpoint
CREATE TABLE `roles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'STAFF' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_logs_created_at` ON `logs` (`created_at`);
--> statement-breakpoint
CREATE TABLE `picking_items` (
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`picked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `product_id`)
);
--> statement-breakpoint
CREATE TABLE `pog_files` (
	`id` text PRIMARY KEY NOT NULL,
	`line` text NOT NULL,
	`side` text NOT NULL,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pog_line_side` ON `pog_files` (`line`,`side`);
--> statement-breakpoint
PRAGMA optimize;
