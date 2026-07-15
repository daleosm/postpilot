-- Guest accounts replace CRM contacts on bookings. CRM contacts remain attached
-- to client accounts and shows, but are not attendees or access principals.
DROP INDEX IF EXISTS "bookings_client_contact_idx";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "client_contact_id";
