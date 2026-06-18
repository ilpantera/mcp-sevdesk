import { describe, it, expect, beforeAll } from "vitest";
import { getClient, hasApiToken } from "./setup.js";
import { reportTools } from "../src/tools/reports.js";
import type { SevdeskClient } from "../src/client.js";

describe("Reports API (lesend)", () => {
  let client: SevdeskClient;

  beforeAll(() => {
    if (hasApiToken) {
      client = getClient();
    }
  });

  describe("get_profit_and_loss", () => {
    it.skipIf(!hasApiToken)("sollte Gewinn- und Verlustrechnung abrufen können", async () => {
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - 365 * 24 * 60 * 60;

      const result = await reportTools.get_profit_and_loss.handler(client, {
        startDate: String(oneYearAgo),
        endDate: String(now),
      });

      expect(result).toBeDefined();
    });
  });

  describe("get_asset_report", () => {
    it.skipIf(!hasApiToken)("sollte Anlagenbericht abrufen können", async () => {
      const now = Math.floor(Date.now() / 1000);
      const oneYearAgo = now - 365 * 24 * 60 * 60;

      const result = await reportTools.get_asset_report.handler(client, {
        startDate: String(oneYearAgo),
        endDate: String(now),
      });

      expect(result).toBeDefined();
    });
  });
});
