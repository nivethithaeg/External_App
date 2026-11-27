-- Subscriptions are not part of PlaynX (removed from the owner portal). Both tables were empty and unused.
-- company_subscriptions points at subscription_plans, so it goes first.
DROP TABLE IF EXISTS company_subscriptions;
DROP TABLE IF EXISTS subscription_plans;
