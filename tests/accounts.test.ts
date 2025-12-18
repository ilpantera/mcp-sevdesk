import { describe, it, expect, beforeAll } from "vitest";
import { getClient, hasApiToken } from "./setup.js";
import { accountTools } from "../src/tools/accounts.js";
import type { SevdeskClient } from "../src/client.js";

describe("Accounts API (lesend)", () => {
  let client: SevdeskClient;

  beforeAll(() => {
    if (hasApiToken) {
      client = getClient();
    }
  });

  describe("list_check_accounts", () => {
    it.skipIf(!hasApiToken)("sollte Bankkonten auflisten können", async () => {
      const result = await accountTools.list_check_accounts.handler(client, {});

      expect(result).toBeDefined();
      expect(result).toHaveProperty("objects");
      expect(Array.isArray(result.objects)).toBe(true);
    });
  });

  describe("get_check_account", () => {
    it.skipIf(!hasApiToken)("sollte ein einzelnes Bankkonto abrufen können", async () => {
      const listResult = await accountTools.list_check_accounts.handler(client, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const checkAccountId = Number(listResult.objects[0].id);
        const result = await accountTools.get_check_account.handler(client, {
          checkAccountId,
        });

        expect(result).toBeDefined();
        expect(result).toHaveProperty("objects");
      }
    });

    it.skipIf(!hasApiToken)("sollte Fehler bei ungültiger ID werfen", async () => {
      await expect(
        accountTools.get_check_account.handler(client, {
          checkAccountId: 999999999,
        })
      ).rejects.toThrow();
    });
  });

  describe("get_check_account_balance", () => {
    it.skipIf(!hasApiToken)("sollte Kontostand abrufen können", async () => {
      const listResult = await accountTools.list_check_accounts.handler(client, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const checkAccountId = Number(listResult.objects[0].id);
        const result = await accountTools.get_check_account_balance.handler(client, {
          checkAccountId,
        });

        expect(result).toBeDefined();
        expect(result).toHaveProperty("objects");
      }
    });

    it.skipIf(!hasApiToken)("sollte Kontostand zu einem bestimmten Datum abrufen können", async () => {
      const listResult = await accountTools.list_check_accounts.handler(client, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const checkAccountId = Number(listResult.objects[0].id);
        const result = await accountTools.get_check_account_balance.handler(client, {
          checkAccountId,
          date: "2024-01-01",
        });

        expect(result).toBeDefined();
        expect(result).toHaveProperty("objects");
      }
    });
  });

  describe("list_transactions", () => {
    it.skipIf(!hasApiToken)("sollte Transaktionen auflisten können", async () => {
      const listResult = await accountTools.list_check_accounts.handler(client, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const checkAccountId = Number(listResult.objects[0].id);
        const result = await accountTools.list_transactions.handler(client, {
          checkAccountId,
          limit: 10,
        });

        expect(result).toBeDefined();
        expect(result).toHaveProperty("objects");
        expect(Array.isArray(result.objects)).toBe(true);
      }
    });

    it.skipIf(!hasApiToken)("sollte Transaktionen mit Datumsfilter abrufen können", async () => {
      const listResult = await accountTools.list_check_accounts.handler(client, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const checkAccountId = Number(listResult.objects[0].id);
        const startDate = Math.floor(new Date("2024-01-01").getTime() / 1000).toString();
        const endDate = Math.floor(new Date("2024-12-31").getTime() / 1000).toString();

        const result = await accountTools.list_transactions.handler(client, {
          checkAccountId,
          startDate,
          endDate,
          limit: 10,
        });

        expect(result).toBeDefined();
        expect(result).toHaveProperty("objects");
      }
    });
  });

  describe("get_transaction", () => {
    it.skipIf(!hasApiToken)("sollte eine einzelne Transaktion abrufen können", async () => {
      const accountsResult = await accountTools.list_check_accounts.handler(client, {});

      if (accountsResult.objects && accountsResult.objects.length > 0) {
        const checkAccountId = Number(accountsResult.objects[0].id);
        const transactionsResult = await accountTools.list_transactions.handler(client, {
          checkAccountId,
          limit: 1,
        });

        if (transactionsResult.objects && transactionsResult.objects.length > 0) {
          const transactionId = Number(transactionsResult.objects[0].id);
          const result = await accountTools.get_transaction.handler(client, {
            transactionId,
          });

          expect(result).toBeDefined();
          expect(result).toHaveProperty("objects");
        }
      }
    });
  });
});
