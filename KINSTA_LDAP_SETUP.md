# Kinsta LDAP Authentication Setup

## ปัญหา
Kinsta hosting block outbound LDAP ports (389/636) ทำให้เกิด ECONNRESET error

## วิธีแก้ไข (เลือก 1 วิธี)

### วิธีที่ 1: SSH Tunnel (แนะนำสุด)

**ข้อดี:**
- ปลอดภัยสูงสุด
- ไม่ต้องสร้าง additional server
- Traffic ผ่าน SSH encryption

**ขั้นตอน:**

1. **Setup SSH Server** ที่สามารถเข้าถึง LDAP ได้
   - ใช้ server ใน office/on-premise
   - หรือ cloud server ที่ connect ไป LDAP ได้

2. **เพิ่ม Environment Variables ใน Kinsta:**
   ```
   SSH_TUNNEL_ENABLED=true
   SSH_HOST=your-ssh-server.com
   SSH_PORT=22
   SSH_USERNAME=ssh_user
   SSH_PASSWORD=your_ssh_password
   LDAP_REMOTE_HOST=ldap-server.internal
   LDAP_REMOTE_PORT=636
   ```

3. **ทดสอบ:**
   ```
   username: connection-test
   password: connection-test
   ```

### วิธีที่ 2: HTTP Proxy

**ข้อดี:**
- ใช้ HTTP/HTTPS port 443 (Kinsta ไม่ block)
- สามารถ load balance ได้

**ขั้นตอน:**

1. **Deploy proxy server** บน server ที่เข้าถึง LDAP ได้:
   ```bash
   npm install express ldapjs cors
   node ldap-proxy-server.js
   ```

2. **เพิ่ม Environment Variables ใน Kinsta:**
   ```
   USE_LDAP_PROXY=true
   PROXY_LDAP_URL=https://your-proxy-server.com:3001
   PROXY_API_KEY=your-secret-api-key
   ```

### วิธีที่ 3: Kinsta Private Network (Premium)

**ข้อดี:**
- Direct connection
- High performance

**ขั้นตอน:**
1. ติดต่อ Kinsta support เพื่อ setup private network
2. Connect LDAP server ผ่าน private network
3. ใช้ LDAP URL แบบ private IP

## Environment Variables ที่จำเป็น

```bash
# LDAP Config (ทุกวิธี)
LDAP_URL=ldaps://your-ldap-server:636
LDAP_BASE_DN=DC=company,DC=com
LDAP_BIND_DN=CN=admin,OU=Users,DC=company,DC=com
LDAP_BIND_PASSWORD=your_bind_password
LDAP_DOMAIN_SUFFIX=company.com
LDAP_TLS_REJECT_UNAUTHORIZED=false

# SSH Tunnel (วิธีที่ 1)
SSH_TUNNEL_ENABLED=true
SSH_HOST=ssh-server.com
SSH_USERNAME=ssh_user
SSH_PASSWORD=ssh_password
LDAP_REMOTE_HOST=ldap.internal
LDAP_REMOTE_PORT=636

# HTTP Proxy (วิธีที่ 2)
USE_LDAP_PROXY=true
PROXY_LDAP_URL=https://proxy-server.com:3001
PROXY_API_KEY=secret-key
```

## Testing

Deploy แล้วทดสอบด้วย:
- username: `connection-test`
- password: `connection-test`

ดู logs ใน Kinsta เพื่อ confirm วิธีที่ใช้งานได้

## Security Recommendations

1. **SSH Tunnel:**
   - ใช้ SSH key แทน password
   - Limit SSH user permissions
   - Monitor SSH access logs

2. **HTTP Proxy:**
   - ใช้ HTTPS + API key
   - Rate limiting
   - Monitor proxy logs

3. **General:**
   - ใช้ LDAPS (port 636)
   - Strong bind password
   - Regular credential rotation
