# Kinsta Gateway Setup Guide

## 🎯 ใช้ API Gateway บน Kinsta โดยตรง

แทนที่จะ deploy gateway บน server ภายนอก เราสามารถ deploy บน Kinsta ได้เลย!

## 🏗️ Architecture

```
Frontend (Kinsta) → API Gateway (Kinsta) → SSH Tunnel → LDAP Server
```

## 📋 ขั้นตอนการตั้งค่า

### 1. สร้าง Kinsta Application ใหม่

1. **ไปที่ Kinsta Dashboard**
2. **Add Application** → **GitHub**
3. **เลือก repository นี้**
4. **Build settings:**
   - **Build command:** `npm install`
   - **Start command:** `npm run kinsta-gateway`
   - **Node.js version:** 20.x

### 2. ตั้งค่า Environment Variables

ใน Kinsta Dashboard → Settings → Environment variables:

```bash
GATEWAY_API_KEY=your-secure-api-key-here
PORT=3000

# SSH Tunnel (ใช้ค่าเดิมจาก env-ssh-example.txt)
SSH_HOST=203.151.40.52
SSH_PORT=22
SSH_USERNAME=your_ssh_username
SSH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
...your private key...
-----END PRIVATE KEY-----

# LDAP Settings
LDAP_REMOTE_HOST=your-ldap-server.internal
LDAP_REMOTE_PORT=636
LDAP_URL=ldaps://your-ldap-server:636
LDAP_BASE_DN=DC=company,DC=com
LDAP_BIND_DN=CN=ldap-service,OU=Service Accounts,DC=company,DC=com
LDAP_BIND_PASSWORD=your_bind_password
LDAP_DOMAIN_SUFFIX=company.com
```

### 3. Deploy

กด **Deploy** และรอจนกว่าจะเสร็จ

## 🔗 การใช้งาน

### Gateway URL (หลังจาก deploy):

```bash
# Kinsta จะให้ URL ประมาณนี้
https://your-app-name.kinsta.app
```

### ตั้งค่าใน Frontend App:

```bash
USE_LDAP_PROXY=true
PROXY_LDAP_URL=https://your-gateway-app.kinsta.app
PROXY_API_KEY=your-secure-api-key-here
```

## 🧪 การทดสอบ

### 1. Health Check:

```bash
curl https://your-gateway-app.kinsta.app/health
```

### 2. Gateway Info:

```bash
curl https://your-gateway-app.kinsta.app/gateway
```

### 3. Authentication Test:

```bash
curl -X POST https://your-gateway-app.kinsta.app/api/ldap/auth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"username":"testuser","password":"testpass"}'
```

## ✅ ข้อดี

- **ไม่ต้องมี server ภายนอก**
- **ใช้ Kinsta ได้เลย**
- **SSH Tunnel ปลอดภัย**
- **Auto-scaling จาก Kinsta**
- **SSL certificate ฟรีจาก Kinsta**

## 🔧 การแก้ไขปัญหา

### SSH Tunnel ไม่เชื่อมต่อ:

1. **ตรวจสอบ SSH credentials**
2. **ตรวจสอบว่า LDAP server สามารถเข้าถึงได้จาก SSH host**
3. **ดูที่ Kinsta logs**

### Authentication ไม่ทำงาน:

1. **ตรวจสอบ LDAP configuration**
2. **ตรวจสอบ bind DN และ password**
3. **ทดสอบกับ user ที่มีอยู่จริง**

## 📊 Monitoring

Kinsta มี built-in monitoring:
- **Response time**
- **Error rate** 
- **Resource usage**
- **Custom logs**

## 🔄 การอัปเดต

1. **Push code ไป GitHub**
2. **Kinsta จะ auto-deploy**
3. **หรือ manual deploy จาก dashboard**

## 💡 Tips

- **ใช้ API key ที่ปลอดภัย**
- **เปิด request logging ใน development**
- **ตั้งค่า rate limiting ให้เหมาะสม**
- **ใช้ Kinsta's preview branches สำหรับ testing**

นี่คือวิธีที่ง่ายที่สุดในการใช้ API Gateway กับ Kinsta! 🚀
