# ADR-0001: Version 1 Runtime Architecture

- Status: Accepted
- Date: 2026-08-16

## Context

ระบบเดิมเป็น Next.js full-stack application และมี domain services, Prisma, authentication และ analysis pipeline ที่ใช้งานได้อยู่แล้ว Requirement ใหม่ต้องแยก Web, API, Worker และ Database ให้ชัดเจน แต่กำหนดให้ Version 1 เป็น Modular Monolith และห้ามลบของเดิมโดยไม่จำเป็น

## Decision

- Next.js เป็น Web UI และ BFF ระหว่างช่วงเปลี่ยนผ่าน
- NestJS เป็น framework สำหรับ API modules ใหม่และ background worker
- Worker ใช้ NestJS application context โดยไม่เปิด HTTP server
- PostgreSQL เป็น system of record และ pgvector เป็น vector store
- Redis/BullMQ เป็น queue สำหรับงาน parsing, embedding, indexing และ insight
- ใช้ Strangler Migration: capability ใหม่เข้า boundary ใหม่ก่อน ส่วน service เดิมย้ายเมื่อมี regression test
- ทุก runtime อยู่ repository เดียวและ deploy ผ่าน Docker Compose ใน Version 1

## Consequences

- ทีมใช้ TypeScript และ contract ชุดเดียวกันทั้ง Web/API/Worker
- ลดความเสี่ยงจาก big-bang rewrite
- ช่วงเปลี่ยนผ่านจะมี Next.js routes และ NestJS modules อยู่ร่วมกัน จึงต้องกำหนด ownership ของ endpoint ชัดเจน
- ห้ามเข้าถึง database ข้าม domain โดยไม่มี repository/service boundary
