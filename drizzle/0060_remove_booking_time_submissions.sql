-- Custom SQL migration file, put your code below! --
-- Actual times and overtime live directly on bookings. Confirmation details are
-- now written to activity_log, so this duplicate audit table is no longer used.
DROP TABLE IF EXISTS "booking_time_submissions";
