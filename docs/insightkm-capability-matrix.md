# InsightKM Capability Matrix

สถานะ ณ วันที่ 16 สิงหาคม 2026 หลัง Phase 8 implementation; operational Pilot gates แยกติดตามในเอกสาร Phase 8

| Domain        | Requirement V1                          | Baseline | Target phase | หมายเหตุ                                                    |
| ------------- | --------------------------------------- | -------- | ------------ | ----------------------------------------------------------- |
| Identity      | Local authentication                    | Partial  | 1            | มี Auth.js, Argon2id, reset และ lockout แล้ว                |
| Identity      | Embedded signed authentication          | Missing  | 3            | ต้องเพิ่ม replay/origin protection                          |
| Identity      | External authentication API             | Missing  | 3            | ต้องสร้าง Shadow User โดยไม่เก็บ password                   |
| Authorization | Admin/Manager/User และ ACL ทุก resource | Partial  | 1–3          | มี flexible RBAC และ DataSource/Dashboard access            |
| AI Provider   | OpenAI-compatible chat                  | Partial  | 1            | มี provider abstraction แต่ยังไม่มี Admin CRUD              |
| AI Provider   | Embedding provider                      | Missing  | 1–2          | ต้องแยก chat/embedding configuration                        |
| Bot           | Multi-bot management                    | Missing  | 2            | ต้องเพิ่ม version, access และ provider config               |
| Knowledge     | Rack/Source/Document ACL                | Missing  | 2–3          | ใช้ deny-by-default                                         |
| Knowledge     | File parsing และ RAG                    | Missing  | 2            | Excel import เดิมใช้ storage interface ต่อได้               |
| Knowledge     | Shared Folder/NFS                       | Missing  | 4            | Application ห้าม mount NFS เอง                              |
| Knowledge     | Web URL source                          | Missing  | 4            | ต้องมี SSRF protection                                      |
| Database      | MySQL metadata/read-only SQL            | Partial  | 5            | มี metadata discovery และ AST guard แล้ว                    |
| Database      | PostgreSQL/MSSQL/Oracle                 | Partial  | 5            | Oracle มี connector บางส่วน; ที่เหลือเป็น placeholder       |
| Legacy API    | Registry และ read-only invocation       | Complete | 6            | Domain/DNS/IP allowlist, encrypted auth และ masking         |
| Chat          | Conversation/history/citation/feedback  | Missing  | 2            | Copilot เดิมเป็น dashboard-scoped เท่านั้น                  |
| Memory        | Conversation/User memory                | Complete | 7            | Consent history, expiry, hard deletion และ secret rejection |
| Insight       | Chat-derived Business Insight           | Complete | 7            | ACL-scoped, evidence-bound และ versioned snapshots          |
| Privacy       | PII masking ก่อน External LLM           | Complete | 1, 8         | Central gateway, policy labels และ category/count-only log  |
| Audit         | Security/admin audit                    | Complete | 1            | Immutable view/export และ reasoned Chat Log access          |
| Platform      | PostgreSQL/pgvector                     | Partial  | 0            | PostgreSQL มีแล้ว; เพิ่ม vector extension ใน Phase 0        |
| Platform      | Redis/BullMQ worker                     | Missing  | 0            | เพิ่มเป็น process แยกใน Phase 0                             |
| Platform      | Docker Compose/Nginx                    | Complete | 0, 8         | App/Worker/DB/Redis/storage และ Nginx pilot profile         |
| Quality       | Unit/integration/E2E                    | Partial  | ทุก Phase    | มี Vitest/Playwright และ connector tests                    |

## Baseline rule

- `Ready`: ใช้งานจริงได้และมี test ครอบคลุม critical path
- `Partial`: มีองค์ประกอบเดิมที่นำไปต่อได้ แต่ยังไม่ผ่าน requirement ทั้งหมด
- `Missing`: ยังไม่มี implementation ที่ใช้เป็น V1 capability ได้

Matrix นี้ต้องอัปเดตเมื่อ Phase Gate ผ่าน ไม่อัปเดตจากการสร้าง UI placeholder เพียงอย่างเดียว
