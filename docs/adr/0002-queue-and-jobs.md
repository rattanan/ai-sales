# ADR-0002: Redis and BullMQ for Background Jobs

- Status: Accepted
- Date: 2026-08-16

## Context

Document parsing, embedding, folder refresh และ business-insight generation เป็นงานที่ใช้เวลานานและต้อง retry ได้ การทำใน HTTP request จะสร้าง timeout และทำให้ recovery ยาก

## Decision

- ใช้ Redis และ BullMQ
- Worker เป็น process แยกจาก Web/API
- Job payload เก็บเฉพาะ identifier และ sanitized configuration ห้ามใส่ secret/raw document content โดยไม่จำเป็น
- Job handler ต้อง idempotent และบันทึกสถานะใน PostgreSQL ก่อน acknowledge completion
- ทุก queue มี bounded concurrency, retry with backoff และ failed-job retention
- Phase 0 เริ่มจาก `system:health-check` job เพื่อพิสูจน์ connectivity และ lifecycle

## Consequences

- Redis กลายเป็น runtime dependency แต่ไม่ใช่ system of record
- การ restart Redis/Worker ต้องไม่ทำให้สถานะธุรกิจสูญหาย
- ต้องเพิ่ม queue depth, failed count และ processing latency ใน System Health ภายหลัง
