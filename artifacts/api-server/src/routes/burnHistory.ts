import { Router, type IRouter, type Request, type Response } from "express";
import {
  RecordBurnHistoryBody,
  ListBurnHistoryResponse,
} from "@workspace/api-zod";
import { withUserClient } from "../lib/userDb";
import { notifyBurn } from "../lib/discord";

const router: IRouter = Router();

router.get("/burn-history", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await withUserClient(req.user.id, async (client) => {
      const r = await client.query(
        `SELECT id, chain_id, token_address, token_symbol, token_decimals,
                amount, mode, tx_hash, recovered_native,
                token_type, token_id, collection_name, created_at
         FROM burn_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.id],
      );
      return r.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        chainId: row.chain_id,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        tokenDecimals: row.token_decimals,
        amount: row.amount,
        mode: row.mode,
        txHash: row.tx_hash,
        recoveredNative: row.recovered_native,
        tokenType: row.token_type ?? "erc20",
        tokenId: row.token_id,
        collectionName: row.collection_name,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      }));
    });
    res.json(ListBurnHistoryResponse.parse({ items: rows }));
  } catch (err) {
    req.log.error({ err }, "Failed to list burn history");
    res.status(500).json({ error: "Failed to load history" });
  }
});

router.post("/burn-history", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = RecordBurnHistoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const data = parsed.data;
  try {
    const item = await withUserClient(req.user.id, async (client) => {
      const r = await client.query(
        `INSERT INTO burn_history
           (user_id, chain_id, token_address, token_symbol, token_decimals,
            amount, mode, tx_hash, recovered_native,
            token_type, token_id, collection_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, chain_id, token_address, token_symbol, token_decimals,
                   amount, mode, tx_hash, recovered_native,
                   token_type, token_id, collection_name, created_at`,
        [
          req.user.id,
          data.chainId,
          data.tokenAddress,
          data.tokenSymbol,
          data.tokenDecimals,
          data.amount,
          data.mode,
          data.txHash,
          data.recoveredNative ?? null,
          data.tokenType ?? "erc20",
          data.tokenId ?? null,
          data.collectionName ?? null,
        ],
      );
      const row = r.rows[0];
      return {
        id: row.id,
        chainId: row.chain_id,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        tokenDecimals: row.token_decimals,
        amount: row.amount,
        mode: row.mode,
        txHash: row.tx_hash,
        recoveredNative: row.recovered_native,
        tokenType: row.token_type ?? "erc20",
        tokenId: row.token_id,
        collectionName: row.collection_name,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      };
    });

    // Fire-and-forget Discord notification
    notifyBurn({
      tokenSymbol:    item.tokenSymbol,
      tokenAddress:   item.tokenAddress ?? '',
      amount:         item.amount,
      mode:           item.mode,
      txHash:         item.txHash,
      recoveredNative: item.recoveredNative,
      tokenType:      item.tokenType,
      tokenId:        item.tokenId,
      collectionName: item.collectionName,
    });

    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to insert burn history");
    res.status(500).json({ error: "Failed to record burn" });
  }
});

export default router;
