import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(), owner: text('owner').notNull(),
  name: text('name').notNull(), property: integer('property').notNull(),
  kiosk: integer('kiosk').notNull(), date: text('date').notNull(),
  start: integer('start').notNull(), end: integer('end').notNull(),
}, t => [index('idx_bookings_date').on(t.date), index('idx_bookings_owner').on(t.owner)]);
export const slots = sqliteTable('slots', {
  booking: text('booking').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  kiosk: integer('kiosk').notNull(), date: text('date').notNull(), minute: integer('minute').notNull(),
}, t => [uniqueIndex('idx_slots_availability').on(t.kiosk, t.date, t.minute), index('idx_slots_booking').on(t.booking)]);
