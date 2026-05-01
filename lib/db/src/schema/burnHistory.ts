import { sql } from "drizzle-orm";
import { index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const burnHistoryTable = pgTable(
  "burn_history",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    tokenAddress: varchar("token_address").notNull(),
    tokenSymbol: varchar("token_symbol").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    amount: varchar("amount").notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    txHash: varchar("tx_hash").notNull(),
    recoveredNative: varchar("recovered_native"),
    // NFT support: tokenType discriminates between fungible ERC-20 burns
    // (default for legacy rows) and ERC-721 / ERC-1155 burns. tokenId is
    // populated for NFTs only, collectionName is the human-readable
    // collection name when the indexer surfaces one.
    tokenType: varchar("token_type", { length: 16 }).notNull().default("erc20"),
    tokenId: varchar("token_id"),
    collectionName: varchar("collection_name", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("IDX_burn_history_user_created").on(table.userId, table.createdAt)],
);

export const insertBurnHistorySchema = createInsertSchema(burnHistoryTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertBurnHistory = z.infer<typeof insertBurnHistorySchema>;
export type BurnHistoryRow = typeof burnHistoryTable.$inferSelect;
