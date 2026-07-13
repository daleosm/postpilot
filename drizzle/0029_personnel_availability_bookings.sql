ALTER TYPE "booking_type" ADD VALUE IF NOT EXISTS 'leave';
ALTER TYPE "booking_type" ADD VALUE IF NOT EXISTS 'training';
ALTER TYPE "booking_type" ADD VALUE IF NOT EXISTS 'sick';
ALTER TYPE "booking_type" ADD VALUE IF NOT EXISTS 'unavailable';

ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "is_freelancer" boolean DEFAULT false NOT NULL;
