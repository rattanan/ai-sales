import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackNtopSalesIntent,
  hasNtopSalesSignal,
} from "@/server/services/ntop-intent-service";
import { NtopClient } from "@/server/integrations/ntop/client";
import { requireConfirmedNtopWrite } from "@/server/integrations/ntop/tools";

describe("NTOP Business Memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("extracts the V1 Thai opportunity example without inventing a write", () => {
    const result = fallbackNtopSalesIntent(
      "วันนี้คุยกับบริษัท ABC สนใจ Cloud DR งบประมาณ 2 ล้านบาท คาดว่าจะจัดซื้อ Q4",
    );
    expect(result).toMatchObject({
      intent: "CREATE_OPPORTUNITY",
      company: "ABC",
      solution: "Cloud DR",
      estimatedValue: "2000000",
    });
    expect(result.expectedCloseDate).toMatch(/-12-31T/);
  });

  it("extracts a Thai customer prefix without treating the product acronym as the company", () => {
    const result = fallbackNtopSalesIntent(
      "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
    );
    expect(result).toMatchObject({
      intent: "CREATE_OPPORTUNITY",
      company: "ธกศ.",
      requirement: "Fix IP",
      solution: "Fix IP",
      estimatedValue: "10000",
    });
  });

  it("resolves an explicit Prospect follow-up from recent user context", () => {
    const result = fallbackNtopSalesIntent("ช่วยสร้างเป็น Prospect ให้ที", [
      "ตอนนี้โปรที่มี Fix IP มีราคาอะไรบ้าง",
      "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
    ]);
    expect(result).toMatchObject({
      intent: "CREATE_PROSPECT",
      company: "ธกศ.",
      requirement: "Fix IP",
      solution: "Fix IP",
      estimatedValue: "10000",
    });
  });

  it("does not intercept ordinary knowledge questions", () => {
    expect(hasNtopSalesSignal("ช่วยสรุปคู่มือการติดตั้งระบบให้หน่อย")).toBe(
      false,
    );
    expect(
      fallbackNtopSalesIntent("ช่วยสรุปคู่มือการติดตั้งระบบให้หน่อย").intent,
    ).toBe("NONE");
  });

  it("does not mistake the NTOP source name for a customer", () => {
    expect(
      fallbackNtopSalesIntent("ช่วยออกแบบ Solution Design จาก NTOP").company,
    ).toBeNull();
  });

  it("keeps credentials server-side and sends idempotency on writes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "p-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new NtopClient(
      "https://ntop.example.test/api/v1",
      "secret-service-token",
      5_000,
    );
    await client.createProspect({ companyName: "ABC" }, "action-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntop.example.test/api/v1/prospects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret-service-token",
          "idempotency-key": "action-key",
        }),
      }),
    );
  });

  it("fetches a Prospect detail resource with the configured credential", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "p/1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new NtopClient(
      "https://ntop.example.test/api/v1",
      "secret-service-token",
      5_000,
    );

    await client.getProspect("p/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntop.example.test/api/v1/prospects/p%2F1",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-service-token",
        }),
      }),
    );
  });

  it("fetches Lead and Product detail resources with the configured credential", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { id: "detail-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new NtopClient(
      "https://ntop.example.test/api/v1",
      "secret-service-token",
      5_000,
    );

    await client.getLead("lead/1");
    await client.getProduct("product/1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://ntop.example.test/api/v1/leads/lead%2F1",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-service-token",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://ntop.example.test/api/v1/products/product%2F1",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-service-token",
        }),
      }),
    );
  });

  it("blocks write tools until the confirmation boundary", () => {
    expect(() =>
      requireConfirmedNtopWrite("create_opportunity", false),
    ).toThrow("explicit user confirmation");
    expect(() =>
      requireConfirmedNtopWrite("create_opportunity", true),
    ).not.toThrow();
    expect(() => requireConfirmedNtopWrite("search_ntop", false)).not.toThrow();
  });
});
