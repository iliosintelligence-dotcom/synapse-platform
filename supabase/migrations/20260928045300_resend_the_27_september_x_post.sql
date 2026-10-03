-- RESEND ONE X POST, AS THE LIVE TEST OF THE 280-CHARACTER FIX.
--
-- Eden, 2026-09-28: "go ahead. to synapse X." The X post of 27 September (the
-- ₦120M New Bodija duplex, 913 characters) failed in trypost with "An
-- unexpected error occurred while publishing", like every X caption over X's
-- 280. social-publish now fits X captions to 280 and sends at most four
-- photos. This puts that one row back in the queue, due now, with its tries
-- reset and the old failure and delivery verdict cleared; drain-social-queue
-- picks it up within a minute and confirm-social-delivery records whether X
-- took it. It goes out on Synapse's X account, as it did before.

update public.social_posts
   set status         = 'scheduled',
       scheduled_at   = now(),
       attempts       = 0,
       failure_reason = null,
       payload        = payload - 'delivery' - 'delivery_error' - 'trypost_detail'
                                - 'trypost_status' - 'delivery_checked_at'
 where platform = 'x'
   and leg = 'synapse'
   and status = 'failed'
   and deleted_at is null
   and created_at = '2026-09-27 10:05:12.824554+00';
