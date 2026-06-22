import { describe, expect, it, vi } from "vitest";
import { voucherTools } from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

describe("get_voucher_document_info", () => {
  it("returns structured document metadata when voucher has a document and image call succeeds", async () => {
    const GET = vi
      .fn()
      // First call: get voucher by ID – returns document id 456
      .mockResolvedValueOnce({
        data: { objects: [{ id: 42, document: { id: 456, objectName: "Document" } }] },
        error: undefined,
      })
      // Second call: getDocumentImage – returns metadata with original PDF
      .mockResolvedValueOnce({
        data: {
          objects: {
            pages: 2,
            mimeType: "image/jpeg",
            originMimeType: "application/pdf",
            filename: "a1b2c3d4e5.pdf",
            contentHash: "abc123",
            content: [],
          },
        },
        error: undefined,
      });

    const result = await voucherTools.get_voucher_document_info.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 42 }
    );

    expect(result).toEqual({
      voucherId: 42,
      document: {
        documentId: 456,
        fileName: "a1b2c3d4e5.pdf",
        mimeType: "application/pdf",
        hasPdf: true,
        hasImagePreview: true,
      },
    });

    expect(GET).toHaveBeenNthCalledWith(
      1,
      "/Voucher/{voucherId}",
      expect.objectContaining({ params: { path: { voucherId: 42 } } })
    );
    expect(GET).toHaveBeenNthCalledWith(
      2,
      "/Voucher/{voucherId}/getDocumentImage",
      expect.objectContaining({ params: { path: { voucherId: 42 } } })
    );
  });

  it("returns null document when voucher has no attached document", async () => {
    const GET = vi.fn().mockResolvedValueOnce({
      data: { objects: [{ id: 42 }] },
      error: undefined,
    });

    const result = await voucherTools.get_voucher_document_info.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 42 }
    );

    expect(result).toEqual({ voucherId: 42, document: null });
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("returns documentId with nulls when the image call fails", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: [{ id: 42, document: { id: 789, objectName: "Document" } }] },
        error: undefined,
      })
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await voucherTools.get_voucher_document_info.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 42 }
    );

    expect(result).toEqual({
      voucherId: 42,
      document: {
        documentId: 789,
        fileName: null,
        mimeType: null,
        hasPdf: false,
        hasImagePreview: false,
      },
    });
  });

  it("detects hasPdf from filename extension when originMimeType is missing", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: [{ id: 1, document: { id: 11, objectName: "Document" } }] },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: {
            mimeType: "image/png",
            filename: "scan.PDF",
            content: [],
          },
        },
        error: undefined,
      });

    const result = await voucherTools.get_voucher_document_info.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.document?.hasPdf).toBe(true);
    expect(result.document?.hasImagePreview).toBe(true);
    expect(result.document?.mimeType).toBeNull();
  });

  it("returns hasImagePreview false when image mimeType is not an image type", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: [{ id: 1, document: { id: 22, objectName: "Document" } }] },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: {
            originMimeType: "application/pdf",
            filename: "doc.pdf",
            content: [],
          },
        },
        error: undefined,
      });

    const result = await voucherTools.get_voucher_document_info.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.document?.hasPdf).toBe(true);
    expect(result.document?.hasImagePreview).toBe(false);
  });
});

describe("get_voucher_document_info_batch", () => {
  it("returns metadata for each voucher in the batch", async () => {
    const GET = vi.fn().mockImplementation((path: string, init: { params: { path: { voucherId: number } } }) => {
      const voucherId = init?.params?.path?.voucherId;
      if (path === "/Voucher/{voucherId}") {
        if (voucherId === 10) {
          return Promise.resolve({
            data: { objects: [{ id: 10, document: { id: 100, objectName: "Document" } }] },
            error: undefined,
          });
        }
        // voucher 20: no document
        return Promise.resolve({ data: { objects: [{ id: 20 }] }, error: undefined });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: {
            objects: {
              mimeType: "image/jpeg",
              originMimeType: "application/pdf",
              filename: "receipt.pdf",
              content: [],
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_document_info_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [10, 20] }
    );

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);

    const r10 = result.results.find((r) => r.voucherId === 10);
    expect(r10?.ok).toBe(true);
    expect(r10?.data?.document).toEqual({
      documentId: 100,
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      hasPdf: true,
      hasImagePreview: true,
    });

    const r20 = result.results.find((r) => r.voucherId === 20);
    expect(r20?.ok).toBe(true);
    expect(r20?.data?.document).toBeNull();
  });

  it("marks result as failed when voucher fetch throws", async () => {
    const GET = vi.fn().mockRejectedValueOnce(new Error("Not found"));

    const result = await voucherTools.get_voucher_document_info_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [99] }
    );

    expect(result.ok).toBe(false);
    const r99 = result.results[0];
    expect(r99.ok).toBe(false);
    expect(r99.errors[0].code).toBe("DOCUMENT_INFO_READ_FAILED");
  });
});
