-- 010_drop_customer_memory.sql
-- customer_memory is dead: after 009 only summary/preferences remained, and neither
-- is read or written anywhere in src/. Memory is the rolling 8-message window
-- (getRecentConversationMessages). No long-term memory is being built.
-- IRREVERSIBLE. A snapshot is taken before destructive migrations.

DROP TABLE IF EXISTS customer_memory CASCADE;
