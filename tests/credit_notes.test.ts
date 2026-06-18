import { describe, it, expect, beforeAll } from "vitest";
import { getClient, hasApiToken } from "./setup.js";
import { creditNoteTools } from "../src/tools/credit_notes.js";
import type { SevdeskClient } from "../src/client.js";

describe("Credit Notes API (lesend)", () => {
  let client: SevdeskClient;

  beforeAll(() => {
    if (hasApiToken) {
      client = getClient();
    }
  });

  describe("list_credit_notes", () => {
    it.skipIf(!hasApiToken)("sollte Gutschriften auflisten können", async () => {
      const result = await creditNoteTools.list_credit_notes.handler(client, {
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("objects");
      expect(Array.isArray(result.objects)).toBe(true);
    });

    it.skipIf(!hasApiToken)("sollte Gutschriften nach Status filtern können", async () => {
      const result = await creditNoteTools.list_credit_notes.handler(client, {
        status: "100",
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("objects");
    });
  });

  describe("get_credit_note", () => {
    it.skipIf(!hasApiToken)("sollte Fehler bei ungültiger ID werfen", async () => {
      await expect(
        creditNoteTools.get_credit_note.handler(client, {
          creditNoteId: 999999999,
        })
      ).rejects.toThrow();
    });
  });
});
