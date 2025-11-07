# LDAP Proxy Solutions for Kinsta

## ปัญหา
Kinsta ไม่สามารถเชื่อมต่อ LDAP โดยตรงเนื่องจาก:
- Outbound IP ไม่คงที่
- Firewall บน LDAP server ไม่อนุญาต
- Network policy restrictions

## ทางแก้ไข 3 วิธี

### วิธีที่ 1: HTTP LDAP Proxy (แนะนำสุด)

**Concept:** สร้าง HTTP API ที่ทำหน้าที่เป็น LDAP bridge

**Architecture:**
```
Kinsta App → HTTPS → Proxy Server (On-premise/VPN) → LDAP Server
```

**Step 1: Deploy Proxy Server**
```bash
# บน server ที่เข้าถึง LDAP ได้
npm install express ldapjs cors

# ตั้งค่า environment variables
export LDAP_URL="ldaps://your-ldap-server:636"
export LDAP_BASE_DN="dc=company,dc=com"
export LDAP_BIND_DN="cn=ldap-service,ou=Service Accounts,dc=company,dc=com"
export LDAP_BIND_PASSWORD="your-password"
export PROXY_API_KEY="your-secret-key"

# Start proxy server
node ldap-proxy-server.js
```

**Step 2: Configure Kinsta**
```bash
# ใน Kinsta Environment Variables
USE_LDAP_PROXY=true
PROXY_LDAP_URL=https://your-proxy-server.com/api/proxy/ldap
PROXY_API_KEY=your-secret-key
```

**Step 3: Deploy with PM2 (Production)**
```bash
npm install -g pm2
pm2 start ldap-proxy-server.js --name "ldap-proxy"
pm2 startup
pm2 save
```

**Step 4: Docker Deployment (Optional)**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["node", "ldap-proxy-server.js"]
```

### วิธีที่ 2: SSH Tunnel Proxy

**Concept:** ใช้ SSH tunnel สร้าง connection ไป LDAP server

**Requirements:**
- SSH access ไป server ใน network เดียวกับ LDAP
- Node.js ssh2 library

**Configuration:**
```bash
# ใน Kinsta Environment Variables
SSH_TUNNEL_ENABLED=true
SSH_HOST=your-bastion-server.com
SSH_PORT=22
SSH_USERNAME=ssh-user
SSH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
LDAP_REMOTE_HOST=ldap-server.local
LDAP_REMOTE_PORT=636
```

**Install Dependencies:**
```bash
npm install node-ssh
```

### วิธีที่ 3: Cloud SQL/LDAP Service

**Concept:** ใช้ managed LDAP service บน cloud

**Options:**
- AWS Directory Service
- Azure Active Directory Domain Services
- Google Cloud Managed Service for Microsoft AD
- JumpCloud (Cloud LDAP)

**Example - AWS Directory Service:**
```bash
# AWS Environment Variables
LDAP_URL=ldaps://ds-xxxxx.aws.com
LDAP_BASE_DN=dc=corp,dc=example,dc=com
LDAP_BIND_DN=cn=Admin,cn=Users,dc=corp,dc=example,dc=com
```

## Security Best Practices

### 1. API Key Security
```javascript
// ใช้ environment variables สำหรับ API keys
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// Generate secure API key
const crypto = require('crypto');
const apiKey = crypto.randomBytes(32).toString('hex');
```

### 2. TLS/SSL
```javascript
// เปิด HTTPS สำหรับ proxy server
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt')
};

https.createServer(options, app).listen(443);
```

### 3. Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests
});

app.use('/api/', limiter);
```

### 4. Logging & Monitoring
```javascript
// Log authentication attempts
app.post('/auth', (req, res) => {
  const { username } = req.body;
  console.log(`[${new Date().toISOString()}] Auth attempt: ${username} from ${req.ip}`);
  // ... authentication logic
});
```

## Deployment Options

### Option A: On-Premise Server
- Server ใน office/datacenter
- เข้าถึง LDAP โดยตรง
- Expose HTTPS endpoint

### Option B: Cloud Server (VPN)
- EC2/Azure VM/GCP VM
- VPN connection ไป office network
- Run proxy server บน cloud

### Option C: Container Deployment
```yaml
# docker-compose.yml
version: '3.8'
services:
  ldap-proxy:
    build: .
    ports:
      - "3001:3001"
    environment:
      - LDAP_URL=ldaps://ldap-server:636
      - LDAP_BASE_DN=dc=company,dc=com
      - PROXY_API_KEY=${PROXY_API_KEY}
    restart: unless-stopped
```

### Option D: Serverless (Advanced)
```javascript
// AWS Lambda function
exports.handler = async (event) => {
  const { username, password } = JSON.parse(event.body);
  
  // LDAP authentication logic
  const result = await authenticateUser(username, password);
  
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
};
```

## Testing

### Test Proxy Server
```bash
# Test health endpoint
curl https://your-proxy-server.com/health

# Test authentication
curl -X POST https://your-proxy-server.com/auth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"username":"testuser","password":"testpass"}'
```

### Test Kinsta Integration
```bash
# Test connection from Kinsta
curl -X POST https://your-app.kinsta.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"connection-test","password":"connection-test"}'
```

## Troubleshooting

### Common Issues
1. **Proxy server not accessible**
   - Check firewall rules
   - Verify SSL certificate
   - Test network connectivity

2. **Authentication failures**
   - Check LDAP credentials
   - Verify base DN format
   - Check user search filters

3. **Performance issues**
   - Add connection pooling
   - Implement caching
   - Monitor response times

### Monitoring
```javascript
// Add health checks
setInterval(async () => {
  try {
    const response = await fetch(`${PROXY_LDAP_URL}/health`);
    if (!response.ok) {
      console.error('Proxy server unhealthy');
    }
  } catch (error) {
    console.error('Proxy server unreachable:', error);
  }
}, 60000); // Check every minute
```

## Cost Comparison

| Solution | Cost | Complexity | Security |
|----------|------|------------|----------|
| HTTP Proxy | Low (server cost) | Medium | High |
| SSH Tunnel | Very Low | High | Medium |
| Cloud LDAP | Medium | Low | Very High |
| Direct LDAP | Free | Low | Medium (if IP whitelisted) |

## Recommendation

**For most cases:** HTTP Proxy Solution
- Easy to implement
- Secure (HTTPS + API key)
- Reliable
- Cost-effective

**For enterprise:** Cloud Managed LDAP
- No maintenance
- High availability
- Built-in security
- Higher cost but worth it
