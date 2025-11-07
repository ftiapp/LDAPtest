// LDAP Proxy Server - Enhanced API Gateway
// สำหรับ deploy บน server ที่เข้าถึง LDAP ได้ (on-premise, VPN, หรือ private network)
// รองรับ HTTPS (port 443) และหลายบริการ

const express = require('express');
const ldap = require('ldapjs');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PROXY_PORT || 443; // Default to HTTPS port

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// LDAP Configuration
const LDAP_CONFIG = {
  url: process.env.LDAP_URL || 'ldaps://your-ldap-server:636',
  baseDN: process.env.LDAP_BASE_DN || 'DC=company,DC=com',
  bindDN: process.env.LDAP_BIND_DN,
  bindPassword: process.env.LDAP_BIND_PASSWORD,
  domainSuffix: process.env.LDAP_DOMAIN_SUFFIX || 'company.com',
  tlsOptions: {
    rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },
  connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT || '30000'),
};

// API Gateway Configuration
const GATEWAY_CONFIG = {
  // Services configuration
  services: {
    ldap: {
      path: '/api/ldap',
      description: 'LDAP Authentication Service'
    },
    // Add more services here
    // example: {
    //   path: '/api/example',
    //   target: 'http://localhost:3002',
    //   description: 'Example Service'
    // }
  },
  
  // SSL Configuration
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    key: process.env.SSL_KEY_PATH,
    cert: process.env.SSL_CERT_PATH,
    ca: process.env.SSL_CA_PATH
  }
};

// API Key for security
const API_KEY = process.env.PROXY_API_KEY || 'your-secret-api-key';

// Enhanced API key middleware with service-specific keys
function checkApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }
  
  const token = authHeader.substring(7);
  
  // Check for service-specific API keys
  const serviceKey = process.env[`${req.path.split('/')[2]?.toUpperCase()}_API_KEY`];
  const validKey = serviceKey || API_KEY;
  
  if (token !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
}

// Gateway info endpoint
app.get('/gateway', (req, res) => {
  res.json({
    name: 'LDAP API Gateway',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    services: Object.keys(GATEWAY_CONFIG.services).map(key => ({
      name: key,
      ...GATEWAY_CONFIG.services[key]
    })),
    ssl: GATEWAY_CONFIG.ssl.enabled,
    port: PORT
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    ldapUrl: LDAP_CONFIG.url,
    services: Object.keys(GATEWAY_CONFIG.services).length
  });
});

// Service-specific health check
app.get('/health/:service', (req, res) => {
  const service = req.params.service;
  if (!GATEWAY_CONFIG.services[service]) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  res.json({ 
    service,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// LDAP Authentication endpoint (updated path)
app.post('/api/ldap/auth', checkApiKey, async (req, res) => {
  const { username, password, config } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  let adminClient = null;
  let userClient = null;

  try {
    console.log(`Proxy auth request for user: ${username}`);
    
    // Use provided config or default
    const ldapConfig = config || LDAP_CONFIG;
    
    // Create admin client
    adminClient = ldap.createClient({
      url: ldapConfig.url,
      tlsOptions: ldapConfig.tlsOptions,
      connectTimeout: ldapConfig.connectTimeout,
    });

    // Bind as admin
    await new Promise((resolve, reject) => {
      adminClient.bind(ldapConfig.bindDN, ldapConfig.bindPassword, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Search for user
    const searchResult = await new Promise((resolve, reject) => {
      const searchFilters = [
        `(sAMAccountName=${username})`,
        `(userPrincipalName=${username}@${ldapConfig.domainSuffix})`,
        `(|(sAMAccountName=${username})(userPrincipalName=${username}@${ldapConfig.domainSuffix}))`
      ];

      let found = false;
      let userDN = '';

      // Try each filter
      const tryFilter = (index) => {
        if (index >= searchFilters.length || found) {
          if (found) resolve({ dn: userDN });
          else reject(new Error('User not found'));
          return;
        }

        const filter = searchFilters[index];
        console.log(`Proxy trying search filter: ${filter}`);

        adminClient.search(
          ldapConfig.baseDN,
          {
            scope: 'sub',
            filter: filter,
            attributes: ['dn', 'userPrincipalName', 'sAMAccountName'],
          },
          (err, res) => {
            if (err) {
              tryFilter(index + 1);
              return;
            }

            res.on('searchEntry', (entry) => {
              userDN = entry.objectName?.toString() || entry.dn;
              found = true;
              console.log(`Proxy found user: ${userDN}`);
            });

            res.on('end', () => {
              setTimeout(() => tryFilter(index + 1), 100);
            });

            res.on('error', () => {
              tryFilter(index + 1);
            });
          }
        );
      };

      tryFilter(0);
    });

    // Authenticate as user
    userClient = ldap.createClient({
      url: ldapConfig.url,
      tlsOptions: ldapConfig.tlsOptions,
      connectTimeout: ldapConfig.connectTimeout,
    });

    await new Promise((resolve, reject) => {
      userClient.bind(searchResult.dn, password, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`Proxy authentication successful for: ${username}`);
    res.json({ success: true, message: 'Authentication successful' });

  } catch (error) {
    console.error('Proxy authentication error:', error);
    res.status(401).json({ 
      success: false, 
      error: error.message || 'Authentication failed' 
    });
  } finally {
    // Cleanup connections
    if (adminClient) {
      try {
        adminClient.unbind();
      } catch (e) {
        console.error('Admin unbind error:', e);
      }
    }
    if (userClient) {
      try {
        userClient.unbind();
      } catch (e) {
        console.error('User unbind error:', e);
      }
    }
  }
});

// Start server with HTTPS support
function startServer() {
  if (GATEWAY_CONFIG.ssl.enabled && GATEWAY_CONFIG.ssl.key && GATEWAY_CONFIG.ssl.cert) {
    // HTTPS server
    const sslOptions = {
      key: fs.readFileSync(GATEWAY_CONFIG.ssl.key),
      cert: fs.readFileSync(GATEWAY_CONFIG.ssl.cert),
    };
    
    if (GATEWAY_CONFIG.ssl.ca) {
      sslOptions.ca = fs.readFileSync(GATEWAY_CONFIG.ssl.ca);
    }
    
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(PORT, () => {
      console.log(`🔒 LDAP API Gateway running on HTTPS port ${PORT}`);
      console.log(`📍 Gateway URL: https://your-domain.com:${PORT}`);
      console.log(`🔗 LDAP URL: ${LDAP_CONFIG.url}`);
      console.log(`📊 Services: ${Object.keys(GATEWAY_CONFIG.services).length}`);
      console.log('✅ Ready to handle authentication requests...');
    });
    
    return httpsServer;
  } else {
    // HTTP server (for development)
    app.listen(PORT, () => {
      console.log(`⚠️  LDAP API Gateway running on HTTP port ${PORT} (SSL disabled)`);
      console.log(`📍 Gateway URL: http://localhost:${PORT}`);
      console.log(`🔗 LDAP URL: ${LDAP_CONFIG.url}`);
      console.log(`📊 Services: ${Object.keys(GATEWAY_CONFIG.services).length}`);
      console.log('✅ Ready to handle authentication requests...');
    });
  }
}

// Start the server
const server = startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
