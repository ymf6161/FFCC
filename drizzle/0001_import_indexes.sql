DROP INDEX `transactions_dedupe_unique`;--> statement-breakpoint
CREATE INDEX `transactions_account_external_id_idx` ON `transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe_unique` ON `transactions` (`account_id`,`dedupe_key`,`dedupe_occurrence`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `balance_checkpoints_account_date_source_unique` ON `balance_checkpoints` (`account_id`,`date`,`source`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_profiles_household_signature_unique` ON `bank_profiles` (`household_id`,`header_signature`);