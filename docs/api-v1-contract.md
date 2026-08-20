# InsightKM API v1 Contract

API ใหม่ใช้ prefix `/api/v1` และ response shape เดียวกันทุก endpoint

## Success

```json
{
  "data": {},
  "meta": {
    "requestId": "request-12345678",
    "timestamp": "2026-08-16T12:00:00.000Z"
  },
  "error": null
}
```

## Failure

```json
{
  "data": null,
  "meta": {
    "requestId": "request-12345678",
    "timestamp": "2026-08-16T12:00:00.000Z"
  },
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the request.",
    "fieldErrors": {
      "name": ["Name is required"]
    }
  }
}
```

## Rules

- Client ส่ง `x-request-id` ได้เมื่อเป็นอักขระ `[a-zA-Z0-9._:-]` ความยาว 8–128 ตัว มิฉะนั้น server สร้าง UUID ใหม่
- Response ต้องคืน `x-request-id` header ตรงกับ `meta.requestId`
- ห้ามส่ง stack trace, raw provider response, SQL credential หรือ secret ใน error
- Validation ใช้ HTTP 422, authentication 401, authorization 403, missing resource 404, conflict 409 และ unexpected error 500
- List endpoint เพิ่ม `meta.pagination` และใช้ cursor เป็นค่าเริ่มต้น
- Endpoint เดิมนอก `/api/v1` คง contract เดิมระหว่าง Strangler Migration และต้องย้ายก่อนประกาศ V1 stable

Implementation อยู่ที่ `server/http/api-response.ts` และตัวอย่าง endpoint คือ `GET /api/v1/health`
