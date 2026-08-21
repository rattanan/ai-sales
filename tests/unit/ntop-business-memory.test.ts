import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackNtopSalesIntent, hasNtopSalesSignal } from "@/server/services/ntop-intent-service";
import { NtopClient } from "@/server/integrations/ntop/client";
import { requireConfirmedNtopWrite } from "@/server/integrations/ntop/tools";

describe("NTOP Business Memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("extracts the V1 Thai opportunity example without inventing a write", () => {
    const result = fallbackNtopSalesIntent("วันนี้คุยกับบริษัท ABC สนใจ Cloud DR งบประมาณ 2 ล้านบาท คาดว่าจะจัดซื้อ Q4");
    expect(result).toMatchObject({ intent: "CREATE_OPPORTUNITY", company: "ABC", solution: "Cloud DR", estimatedValue: "2000000" });
    expect(result.expectedCloseDate).toMatch(/-12-31T/);
  });

  it("does not intercept ordinary knowledge questions", () => {
    expect(hasNtopSalesSignal("ช่วยสรุปคู่มือการติดตั้งระบบให้หน่อย")).toBe(false);
    expect(fallbackNtopSalesIntent("ช่วยสรุปคู่มือการติดตั้งระบบให้หน่อย").intent).toBe("NONE");
  });

  it("keeps credentials server-side and sends idempotency on writes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "p-1" } }), { status: 201, headers: { "content-type": "application/json" } }));
    const client = new NtopClient("https://ntop.example.test/api/v1", "secret-service-token", 5_000);
    await client.createProspect({ companyName: "ABC" }, "action-key");
    expect(fetchMock).toHaveBeenCalledWith("https://ntop.example.test/api/v1/prospects", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer secret-service-token", "idempotency-key": "action-key" }) }));
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
