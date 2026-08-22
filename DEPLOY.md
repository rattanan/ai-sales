# วิธี Deploy

ให้ทำขั้นตอนนี้เฉพาะเมื่อผู้ใช้สั่งให้ deploy เท่านั้น และต้องทำตามลำดับดังต่อไปนี้

## 1. Commit และ Push จากเครื่อง Local

ตรวจสอบรายการเปลี่ยนแปลงก่อน commit:

```bash
git status
git diff
```

จากนั้น commit และ push ขึ้น `origin/main`:

```bash
git add <files>
git commit -m "<commit message>"
git push origin main
```

ต้องตรวจสอบให้แน่ใจว่า `git push` สำเร็จก่อนดำเนินการขั้นถัดไป

## 2. SSH เข้า Server

```bash
ssh ntop
```

## 3. เข้า Directory ของ Application

```bash
cd /opt/apps/ai-sales
```

## 4. รัน Deploy Script

```bash
./deploy.sh
```

Deploy ถือว่าสำเร็จเมื่อ `deploy.sh` จบด้วย exit code `0` และไม่มีข้อความ error
