# ADR-0003: pgvector and Storage Abstraction

- Status: Accepted
- Date: 2026-08-16

## Context

Version 1 ต้องค้นเอกสารและ database metadata แบบ semantic โดยเน้นการ deploy ที่ง่าย และต้องเก็บไฟล์บน Local/NFS ก่อนรองรับ S3/MinIO ในอนาคต

## Decision

- ใช้ PostgreSQL `vector` extension ผ่าน image `pgvector/pgvector:pg17`
- Vector row ต้องผูก tenant/workspace, ACL scope, source version, embedding model และ checksum
- Retrieval ต้องกรอง ACL ใน database query ก่อนนำ candidate ไป rerank
- ใช้ storage interface เดิมต่อยอดเป็น Local/NFS adapter
- Database เก็บ metadata และ opaque storage key ไม่เก็บ absolute path ที่เปิดเผยโครงสร้าง host โดยไม่จำเป็น

## Consequences

- ไม่ต้องดูแล vector database แยกใน V1
- ต้องวัด index/query performance ก่อนกำหนด dimension/index type ใน Phase 2
- การเปลี่ยน embedding model ต้องสร้าง version ใหม่และ re-index แบบไม่ทำลาย index ที่ใช้งานอยู่
