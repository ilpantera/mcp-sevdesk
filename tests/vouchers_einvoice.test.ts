import { describe, expect, it, vi } from "vitest";
import { voucherTools } from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

describe("check_and_extract_einvoice", () => {
  it("extracts embedded ZUGFeRD XML from a voucher document without returning base64", async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"></rsm:CrossIndustryInvoice>';
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /EmbeddedFile /Subtype /text#2Fxml >>
stream
${xml}
endstream
endobj
%%EOF`;

    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: [{ document: { id: 123, objectName: "Document" } }] },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: new TextEncoder().encode(pdf).buffer,
        error: undefined,
      });

    const result = await voucherTools.check_and_extract_einvoice.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 42 }
    );

    expect(GET).toHaveBeenNthCalledWith(
      1,
      "/Voucher/{voucherId}",
      expect.objectContaining({ params: { path: { voucherId: 42 } } })
    );
    expect(GET).toHaveBeenNthCalledWith(
      2,
      "/Document/{documentId}",
      expect.objectContaining({ params: { path: { documentId: 123 } }, parseAs: "arrayBuffer" })
    );
    expect(result).toEqual({
      isEinvoice: true,
      format: "ZUGFeRD",
      data: { xml },
    });
  });

  it("returns a non-einvoice result when the voucher has no attached document", async () => {
    const GET = vi.fn().mockResolvedValueOnce({
      data: { objects: [{ id: 42 }] },
      error: undefined,
    });

    const result = await voucherTools.check_and_extract_einvoice.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 42 }
    );

    expect(result).toEqual({
      isEinvoice: false,
      error: "Voucher has no document attached",
    });
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("does not expose the removed standalone PDF tool", () => {
    expect("get_voucher_document_pdf" in voucherTools).toBe(false);
  });
});
