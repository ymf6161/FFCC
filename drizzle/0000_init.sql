CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`notify_email` text,
	`notify_phone` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_household_user_unique` ON `household_members` (`household_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `household_members_user_idx` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`financial_year_start_month` integer DEFAULT 4 NOT NULL,
	`financial_year_start_day` integer DEFAULT 6 NOT NULL,
	`onboarding_progress` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`opening_balance_date` text NOT NULL,
	`is_liquid` integer NOT NULL,
	`include_in_net_worth` integer DEFAULT true NOT NULL,
	`is_manual` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_household_idx` ON `accounts` (`household_id`);--> statement-breakpoint
CREATE TABLE `balance_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance` integer NOT NULL,
	`source` text NOT NULL,
	`import_batch_id` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `balance_checkpoints_account_date_idx` ON `balance_checkpoints` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`maaser_effect` text DEFAULT 'none' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categories_household_idx` ON `categories` (`household_id`);--> statement-breakpoint
CREATE TABLE `manual_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `manual_valuations_household_date_idx` ON `manual_valuations` (`household_id`,`date`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text,
	`amount` integer NOT NULL,
	`reserve_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_transaction_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`raw_description` text NOT NULL,
	`merchant` text,
	`category_id` text,
	`source` text NOT NULL,
	`booking_status` text DEFAULT 'booked' NOT NULL,
	`external_id` text,
	`dedupe_key` text NOT NULL,
	`dedupe_occurrence` integer DEFAULT 1 NOT NULL,
	`import_batch_id` text,
	`status` text DEFAULT 'unconfirmed' NOT NULL,
	`confidence` integer,
	`transfer_group_id` text,
	`refund_of_id` text,
	`reserve_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_of_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transactions_household_date_idx` ON `transactions` (`household_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_group_idx` ON `transactions` (`transfer_group_id`);--> statement-breakpoint
CREATE INDEX `transactions_refund_of_idx` ON `transactions` (`refund_of_id`);--> statement-breakpoint
CREATE INDEX `transactions_import_batch_idx` ON `transactions` (`import_batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe_unique` ON `transactions` (`account_id`,`dedupe_key`,`dedupe_occurrence`);--> statement-breakpoint
CREATE TABLE `household_merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`merchant_id` text,
	`name` text NOT NULL,
	`category_id` text,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_merchants_household_name_unique` ON `household_merchants` (`household_id`,`name`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`match_patterns` text NOT NULL,
	`lookup_result` text,
	`suggested_category` text,
	`looked_up_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_canonical_name_unique` ON `merchants` (`canonical_name`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`origin` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rules_household_priority_idx` ON `rules` (`household_id`,`priority`);--> statement-breakpoint
CREATE TABLE `cash_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`raw_text` text,
	`voice_file_path` text,
	`transcript` text,
	`parsed_expenses` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_notes_household_idx` ON `cash_notes` (`household_id`);--> statement-breakpoint
CREATE TABLE `digests` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`sent_at` text,
	`reply_raw_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `digests_household_idx` ON `digests` (`household_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`type` text NOT NULL,
	`options` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`answer` text,
	`answered_by` text,
	`channel` text,
	`digest_id` text,
	`answered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `questions_household_status_idx` ON `questions` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `questions_subject_idx` ON `questions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`file_path` text NOT NULL,
	`source` text NOT NULL,
	`parsed_merchant` text,
	`parsed_date` text,
	`parsed_total` integer,
	`line_items` text,
	`matched_transaction_id` text,
	`match_confidence` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipts_household_idx` ON `receipts` (`household_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_household_idx` ON `events` (`household_id`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `persons_household_idx` ON `persons` (`household_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tags_household_idx` ON `tags` (`household_id`);--> statement-breakpoint
CREATE TABLE `transaction_events` (
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `event_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transaction_persons` (
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `person_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`household_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`target_date` text,
	`reserve_id` text,
	`account_id` text,
	`progress_method` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reserve_id`) REFERENCES `reserves`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goals_household_idx` ON `goals` (`household_id`);--> statement-breakpoint
CREATE TABLE `maaser_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`origin` text NOT NULL,
	`source_transaction_id` text,
	`source_split_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_split_id`) REFERENCES `transaction_splits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maaser_ledger_household_date_idx` ON `maaser_ledger` (`household_id`,`date`);--> statement-breakpoint
CREATE TABLE `maaser_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`percentage_bp` integer NOT NULL,
	`effective_from` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maaser_settings_household_from_idx` ON `maaser_settings` (`household_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `reserve_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`reserve_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`origin` text NOT NULL,
	`source_transaction_id` text,
	`source_split_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reserve_id`) REFERENCES `reserves`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_split_id`) REFERENCES `transaction_splits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reserve_movements_household_date_idx` ON `reserve_movements` (`household_id`,`date`);--> statement-breakpoint
CREATE TABLE `reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target` integer,
	`funding_rule` text DEFAULT 'manual' NOT NULL,
	`funding_value` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reserves_household_idx` ON `reserves` (`household_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`reason` text NOT NULL,
	`import_batch_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_household_created_idx` ON `audit_log` (`household_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bank_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`mapping` text NOT NULL,
	`header_signature` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_profiles_household_idx` ON `bank_profiles` (`household_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`account_id` text NOT NULL,
	`bank_profile_id` text,
	`file_name` text NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`near_duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`undone_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_profile_id`) REFERENCES `bank_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batches_household_idx` ON `import_batches` (`household_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_after` text NOT NULL,
	`locked_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_household_status_idx` ON `jobs` (`household_id`,`status`);