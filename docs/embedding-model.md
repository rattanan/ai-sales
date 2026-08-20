# Embedding Model Configuration

ใช้ Ollama embedding API ตามค่าต่อไปนี้:

- Endpoint: `https://ollama.rattanan.dev/api/embed`
- Model: `qwen3-embedding:4b`

ตัวอย่าง request:

```bash
curl https://ollama.rattanan.dev/api/embed \
  -d '{
    "model": "qwen3-embedding:4b",
    "input": "บริษัทโทรคมนาคมแห่งชาติให้บริการโครงสร้างพื้นฐานดิจิทัล"
  }'
```

ให้ใช้ model และ endpoint นี้เป็นค่าเริ่มต้นสำหรับงานสร้าง embeddings ของระบบ จนกว่าจะมีการบันทึกการเปลี่ยนแปลงใหม่
