-- A stopped post is CANCELLED, not erased (contract: status tracking includes Cancelled).
--
-- Until now the portal's only way to stop a post was discard_social_post, which soft-deletes it: the post vanished
-- from every list, and nobody could later see that it had been planned and stopped. Synapse's own studio already
-- marks a stopped post 'cancelled' (synapse_posts.status); agency posts get the same.
--
-- ADD VALUE stands alone in its own migration: Postgres will not let a new enum value be used in the transaction
-- that adds it, and the next migration uses it.
alter type public.social_post_status add value if not exists 'cancelled';
