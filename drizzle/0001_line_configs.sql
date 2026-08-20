CREATE TABLE `line_configs` (
  `line` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `color` text NOT NULL,
  `logo` text DEFAULT '' NOT NULL,
  `updated_at` integer NOT NULL
);
