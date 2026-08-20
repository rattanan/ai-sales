# Phase 0 Platform Runbook

## Local startup

```bash
cp .env.example .env
docker compose up -d postgres redis worker mysql-fixture
npm run db:generate
npm run db:deploy
```

MySQL fixture ใช้ host port `3307` เป็นค่าเริ่มต้นเพื่อไม่ชนกับ MySQL ของเครื่อง กำหนด `MYSQL_FIXTURE_PORT` เมื่อต้องการเปลี่ยน

## Verify pgvector

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

ต้องได้หนึ่งแถว หากไม่ได้ให้ตรวจว่า PostgreSQL ใช้ image `pgvector/pgvector:pg17` ก่อน apply migration

## Verify worker

เมื่อ Redis และ Worker ทำงานแล้ว:

```bash
npm run worker:health
```

ผลสำเร็จต้องเป็น JSON ที่มี `status: "ok"`, request ID, worker ID และ completed time

## Platform health

```bash
curl -H 'x-request-id: local-health-check' http://localhost:3000/api/v1/health
```

สถานะ `ok` ต้องมี Application, Database, Redis และ Worker เป็น `up` หาก dependency ใดล้มเหลว endpoint คืน HTTP 503 พร้อมสถานะ `degraded` โดยไม่เปิดเผย credential

## Migration safety

1. สำรองฐานข้อมูลก่อน production deploy
2. รัน `npm run db:deploy` ด้วย deployment identity ที่จำกัดสิทธิ์
3. ตรวจ `vector` extension และ application health
4. Deploy Worker ก่อนเปิด API ที่ enqueue job ใหม่
5. Migration ใน Phase 0 เป็น additive และไม่ลบ table/column เดิม

## Rollback

- Application/Worker image สามารถ rollback เป็น version ก่อนหน้าได้
- ห้าม drop `vector` extension ระหว่าง rollback เพราะ migration เป็น additive และ Phase ถัดไปอาจสร้าง vector column
- หาก Worker ผิดปกติให้หยุด Worker; queued jobs คงอยู่ใน Redis และ business state ต้องอยู่ใน PostgreSQL
