import { describe, it, expect, beforeAll } from "vitest";
import { getClient, hasApiToken } from "./setup.js";
import { orderTools } from "../src/tools/orders.js";
import type { SevdeskClient } from "../src/client.js";

describe("Orders API (lesend)", () => {
  let client: SevdeskClient;

  beforeAll(() => {
    if (hasApiToken) {
      client = getClient();
    }
  });

  describe("list_orders", () => {
    it.skipIf(!hasApiToken)("sollte Aufträge auflisten können", async () => {
      const result = await orderTools.list_orders.handler(client, {
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("objects");
      expect(Array.isArray(result.objects)).toBe(true);
    });

    it.skipIf(!hasApiToken)("sollte Aufträge nach Status filtern können", async () => {
      const result = await orderTools.list_orders.handler(client, {
        status: "100",
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("objects");
    });
  });

  describe("get_order", () => {
    it.skipIf(!hasApiToken)("sollte Fehler bei ungültiger ID werfen", async () => {
      await expect(
        orderTools.get_order.handler(client, {
          orderId: 999999999,
        })
      ).rejects.toThrow();
    });
  });
});
