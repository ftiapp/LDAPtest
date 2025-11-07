# API Gateway Deployment Guide

## Overview

This guide shows how to deploy the enhanced LDAP API Gateway that acts as a middle-tier service, allowing Kinsta applications to access LDAP services through HTTPS (port 443) instead of direct LDAP ports.

## Architecture

```
Kinsta App (Internet) → API Gateway (HTTPS:443) → LDAP Server (636/389)
```

## Features

- ✅ HTTPS support (port 443)
- ✅ API key authentication
- ✅ Rate limiting
- ✅ Request logging
- ✅ Health monitoring
- ✅ Multiple service support
- ✅ SSL/TLS encryption
- ✅ Service-specific API keys

## Deployment Options

### Option 1: On-Premise Server (Recommended)

1. **Server Requirements**
   - Node.js 18+ 
   - Network access to LDAP server
   - Public IP or DNS for Kinsta access
   - SSL certificate (for production)

2. **Setup Steps**

```bash
# Clone and setup
git clone <your-repo>
cd ldaptest2

# Install dependencies
npm install

# Copy environment template
cp gateway-env-example.txt .env

# Edit configuration
nano .env
```

3. **Environment Configuration**

```bash
# Gateway Settings
PROXY_PORT=443
SSL_ENABLED=true
SSL_KEY_PATH=/etc/ssl/certs/gateway-key.pem
SSL_CERT_PATH=/etc/ssl/certs/gateway-cert.pem

# LDAP Settings
LDAP_URL=ldaps://your-ldap-server:636
LDAP_BASE_DN=DC=company,DC=com
LDAP_BIND_DN=CN=ldap-service,OU=Service Accounts,DC=company,DC=com
LDAP_BIND_PASSWORD=your_bind_password

# Security
PROXY_API_KEY=your-secure-api-key-here
```

4. **SSL Certificate Setup**

```bash
# Option A: Let's Encrypt (recommended)
sudo apt install certbot
sudo certbot certonly --standalone -d your-gateway-domain.com

# Option B: Self-signed (for testing)
openssl req -x509 -newkey rsa:4096 -keyout gateway-key.pem -out gateway-cert.pem -days 365 -nodes
```

5. **Run the Gateway**

```bash
# Development (HTTP)
npm run gateway:dev

# Production (HTTPS)
npm run gateway:start
```

### Option 2: Cloud Server (AWS/Azure/GCP)

1. **Create VM Instance**
   - Ubuntu 20.04+ or CentOS 8+
   - Open port 443 in firewall
   - Assign static IP

2. **Install Dependencies**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2
```

3. **Deploy Application**

```bash
# Clone repository
git clone <your-repo>
cd ldaptest2

# Install dependencies
npm install

# Setup environment
cp gateway-env-example.txt .env
nano .env

# Start with PM2
pm2 start ldap-proxy-server.js --name "api-gateway"
pm2 startup
pm2 save
```

### Option 3: Docker Deployment

1. **Create Dockerfile**

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 443

CMD ["node", "ldap-proxy-server.js"]
```

2. **Docker Compose**

```yaml
version: '3.8'
services:
  api-gateway:
    build: .
    ports:
      - "443:443"
    environment:
      - NODE_ENV=production
      - SSL_ENABLED=true
    volumes:
      - ./ssl:/app/ssl:ro
    restart: unless-stopped
```

3. **Run Container**

```bash
docker-compose up -d
```

## Kinsta Configuration

Update your Kinsta app environment:

```bash
# Use API Gateway instead of direct LDAP
USE_LDAP_PROXY=true
PROXY_LDAP_URL=https://your-gateway-domain.com
PROXY_API_KEY=your-secure-api-key-here

# Disable direct LDAP and SSH tunnel
SSH_TUNNEL_ENABLED=false
LDAP_URL=  # Can be left empty or as fallback
```

## Security Best Practices

1. **API Keys**
   - Use strong, random API keys
   - Rotate keys regularly
   - Use different keys per service

2. **SSL/TLS**
   - Always use HTTPS in production
   - Use certificates from trusted CA
   - Enable HSTS headers

3. **Network Security**
   - Use firewall to restrict access
   - Allow only necessary ports
   - Consider VPN for additional security

4. **Monitoring**
   - Enable request logging
   - Monitor health endpoints
   - Set up alerts for failures

## Testing the Gateway

1. **Health Check**

```bash
curl https://your-gateway-domain.com/health
```

2. **Gateway Info**

```bash
curl https://your-gateway-domain.com/gateway
```

3. **Authentication Test**

```bash
curl -X POST https://your-gateway-domain.com/api/ldap/auth \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"username":"testuser","password":"testpass"}'
```

## Adding More Services

The gateway supports multiple services. Add new services in the configuration:

```javascript
// In ldap-proxy-server.js
const GATEWAY_CONFIG = {
  services: {
    ldap: {
      path: '/api/ldap',
      description: 'LDAP Authentication Service'
    },
    database: {
      path: '/api/db',
      target: 'http://localhost:3306',
      description: 'Database Service'
    },
    files: {
      path: '/api/files',
      target: 'http://localhost:8080',
      description: 'File Service'
    }
  }
};
```

## Troubleshooting

1. **SSL Issues**
   - Check certificate paths
   - Verify certificate validity
   - Check file permissions

2. **Connection Issues**
   - Verify LDAP server connectivity
   - Check firewall rules
   - Review logs

3. **Authentication Issues**
   - Validate API keys
   - Check LDAP credentials
   - Review user DN format

## Performance Optimization

1. **Enable Connection Pooling**
2. **Use Redis for caching**
3. **Enable compression**
4. **Monitor resource usage**

## Monitoring and Logging

The gateway includes built-in monitoring:

- Request logging
- Health checks
- Service status
- Error tracking

Access logs at: `/var/log/api-gateway/`

## Support

For issues and questions:
1. Check health endpoints
2. Review application logs
3. Verify network connectivity
4. Validate configuration
