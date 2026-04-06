CREATE INDEX "signal_executions_linked_execution_id_idx" ON "signal_executions" USING btree ("linked_execution_id");--> statement-breakpoint
CREATE INDEX "signal_sources_user_id_idx" ON "signal_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_journal_entry_time_idx" ON "trade_journal" USING btree ("entry_time");