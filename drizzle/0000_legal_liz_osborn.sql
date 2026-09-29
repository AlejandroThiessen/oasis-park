CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`property` integer NOT NULL,
	`kiosk` integer NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bookings_date` ON `bookings` (`date`);--> statement-breakpoint
CREATE INDEX `idx_bookings_owner` ON `bookings` (`owner`);--> statement-breakpoint
CREATE TABLE `slots` (
	`booking` text NOT NULL,
	`kiosk` integer NOT NULL,
	`date` text NOT NULL,
	`minute` integer NOT NULL,
	FOREIGN KEY (`booking`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slots_availability` ON `slots` (`kiosk`,`date`,`minute`);--> statement-breakpoint
CREATE INDEX `idx_slots_booking` ON `slots` (`booking`);