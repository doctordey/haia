CREATE INDEX "signal_configs_user_id_idx" ON "signal_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_configs_source_id_idx" ON "signal_configs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "signal_configs_account_id_idx" ON "signal_configs" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "signal_configs" ADD CONSTRAINT "signal_configs_source_account_uniq" UNIQUE("source_id","account_id");