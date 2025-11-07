# Kinsta LDAP Authentication Deployment Guide

## ปัญหาที่พบบ่อย (Common Issues)

เมื่อ deploy แอปพลิเคชัน LDAP authentication ไปยัง Kinsta และใช้งานได้บน local แต่ไม่ทำงานบน production สาเหตุหลักคือ:

1. **Outbound IP Address Changes** - Kinsta อาจมอบหมาย outbound IP ใหม่เมื่อ deploy/restart/rebalance
2. **Firewall/Network Restrictions** - LDAP server ไม่อนุญาตให้ IP ของ Kinsta เข้าถึง
3. **TLS Certificate Issues** - ปัญหาการ verify certificate บน production

## การแก้ปัญหา (Solutions)

### 1. ตรวจสอบ Outbound IP ปัจจุบัน

ใช้ debug tool ที่สร้างขึ้น:
```
https://your-app.kinsta.app/debug
```

หรือ test ผ่าน API:
```bash
curl -X POST https://your-app.kinsta.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"connection-test","password":"connection-test"}'
```

### 2. Whitelist IP Addresses

มี 2 วิธี:

**วิธี A: Whitelist เฉพาะ IP ปัจจุบัน**
- รับ IP จาก debug tool
- เพิ่ม IP นี้ใน firewall ของ LDAP server
- แต่ IP อาจเปลี่ยนเมื่อ restart

**วิธี B: Whitelist ทุก IP ของ Kinsta (แนะนำ)**
เพิ่ม IP ranges ต่อไปนี้ใน firewall:

```
34.1.128.0/20
34.1.192.0/20
34.2.16.0/20
34.2.128.0/17
34.21.128.0/17
34.87.0.0/17
34.87.128.0/18
34.104.58.0/23
34.104.106.0/23
34.124.42.0/23
34.124.128.0/17
34.126.64.0/18
34.126.128.0/18
34.128.44.0/23
34.128.60.0/23
34.142.128.0/17
34.143.128.0/17
34.152.104.0/23
34.153.40.0/23
34.153.232.0/23
34.157.82.0/23
34.157.88.0/23
34.157.210.0/23
34.158.32.0/19
34.177.72.0/23
35.185.176.0/20
35.186.144.0/20
35.187.224.0/19
35.197.128.0/19
35.198.192.0/18
35.213.128.0/18
35.220.24.0/23
35.234.192.0/20
35.240.128.0/17
35.242.24.0/23
35.247.128.0/18
136.110.0.0/18
```

### 3. Environment Variables สำหรับ Kinsta

ตั้งค่าใน Kinsta Environment Variables:

```bash
LDAP_URL=ldaps://your-ldap-server.com:636
LDAP_BASE_DN=DC=company,DC=com
LDAP_BIND_DN=CN=ldap-service,OU=Service Accounts,DC=company,DC=com
LDAP_BIND_PASSWORD=your-bind-password
LDAP_DOMAIN_SUFFIX=company.com
LDAP_ALT_DOMAIN_SUFFIX=company.local
LDAP_TLS_REJECT_UNAUTHORIZED=false
LDAP_CONNECT_TIMEOUT=30000
LDAP_CONNECTION_RETRY_ATTEMPTS=4
LDAP_CONNECTION_RETRY_DELAY=1000
```

**คำอธิบาย:**
- `LDAP_TLS_REJECT_UNAUTHORIZED=false`: สำหรับปัญหา TLS certificate (ใช้เฉพาะตอนทดสอบ)
- `LDAP_CONNECTION_RETRY_ATTEMPTS=4`: ลองเชื่อมต่อ 4 ครั้ง
- `LDAP_CONNECT_TIMEOUT=30000`: รอ 30 วินาที

### 4. Port Configuration

ตรวจสอบว่า:
- Port 636 (LDAPS) เปิดจาก Kinsta ไป LDAP server
- Port 389 (LDAP) ถ้าใช้ non-secure connection

### 5. TLS Certificate Issues

ถ้าเจอปัญหา TLS certificate:

**ชั่วคราว (สำหรับทดสอบ):**
```bash
LDAP_TLS_REJECT_UNAUTHORIZED=false
```

**ถาวร:**
- ติดตั้ง certificate chain ที่ถูกต้องบน LDAP server
- ใช้ certificate ที่ signed โดย CA ที่เชื่อถือได้
- ตรวจสอบว่า certificate ไม่หมดอายุ

## การทดสอบ (Testing)

### 1. Local Testing
```bash
npm run dev
# เข้า http://localhost:3000/debug
```

### 2. Production Testing
```bash
# Deploy ไป Kinsta แล้วทดสอบ
curl -X POST https://your-app.kinsta.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

### 3. Connection Test
```bash
curl -X POST https://your-app.kinsta.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"connection-test","password":"connection-test"}'
```

## Monitoring และ Logging

ตรวจสอบ logs ใน Kinsta:
1. เข้า Kinsta Dashboard
2. เลือก Application
3. ดูที่ "Logs" > "Application logs"
4. ค้นหา error messages:
   - "Connection timeout"
   - "TLS handshake failed"
   - "Bind failed"

## Troubleshooting Checklist

- [ ] Whitelist Kinsta IP ranges ใน LDAP server firewall
- [ ] Port 636 เปิดจาก Kinsta ไป LDAP server
- [ ] Environment variables ถูกต้องทั้งหมด
- [ ] TLS certificate ถูกต้อง (หรือตั้งค่า REJECT_UNAUTHORIZED=false)
- [ ] Bind DN และ password ถูกต้อง
- [ ] Base DN ถูกต้อง
- [ ] Domain suffix ถูกต้อง

## ติดต่อ Support

ถ้ายังไม่ได้:
1. ส่ง logs จาก Kinsta
2. แจ้ง outbound IP ปัจจุบัน
3. แจ้ง timestamp ของการทดสอบ
4. ตรวจสอบ LDAP server logs ด้วย

## Security Best Practices

- หลังจากทดสอบสำเร็จ ให้ตั้งค่า `LDAP_TLS_REJECT_UNAUTHORIZED=true`
- ใช้ environment variables สำหรับ sensitive data
- Monitor logs เป็นประจำ
- ใช้ least privilege สำหรับ bind account
