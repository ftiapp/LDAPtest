// Kinsta API Gateway - ทำงานบน Kinsta ใช้ SSH Tunnel เชื่อมต่อ LDAP
// เหมาะสำหรับ deploy บน Kinsta โดยตรง

const express = require('express');
const ldap = require('ldapjs');
const cors = require('cors');
const { Client } = require('ssh2');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Configuration
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

// SSH Tunnel Configuration
const SSH_CONFIG = {
  host: process.env.SSH_HOST,
  port: parseInt(process.env.SSH_PORT || '22'),
  username: process.env.SSH_USERNAME,
  privateKey: process.env.SSH_PRIVATE_KEY,
  password: process.env.SSH_PASSWORD,
  remoteHost: process.env.LDAP_REMOTE_HOST || 'localhost',
  remotePort: parseInt(process.env.LDAP_REMOTE_PORT || '636'),
  localPort: parseInt(process.env.SSH_LOCAL_PORT || '1389'),
};

// API Key
const API_KEY = process.env.GATEWAY_API_KEY || 'your-secret-api-key';

// SSH Tunnel Manager
class SSHTunnelManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      this.client = new Client();

      this.client.on('ready', () => {
        console.log('SSH client ready');
        
        // Setup forward tunnel
        this.client.forwardOut(
          '127.0.0.1',
          SSH_CONFIG.localPort,
          SSH_CONFIG.remoteHost,
          SSH_CONFIG.remotePort,
          (err, stream) => {
            if (err) {
              reject(err);
              return;
            }
            console.log(`SSH tunnel established: 127.0.0.1:${SSH_CONFIG.localPort} -> ${SSH_CONFIG.remoteHost}:${SSH_CONFIG.remotePort}`);
            this.isConnected = true;
            resolve();
          }
        );
      });

      this.client.on('error', (err) => {
        console.error('SSH connection error:', err);
        reject(err);
      });

      const connectConfig = {
        host: SSH_CONFIG.host,
        port: SSH_CONFIG.port,
        username: SSH_CONFIG.username,
        readyTimeout: 30000,
      };

      if (SSH_CONFIG.privateKey) {
        connectConfig.privateKey = SSH_CONFIG.privateKey;
      } else if (SSH_CONFIG.password) {
        connectConfig.password = SSH_CONFIG.password;
      }

      this.client.connect(connectConfig);
    });
  }

  getLDAPUrl() {
    if (!this.isConnected) {
      throw new Error('SSH tunnel not connected');
    }
    
    // Convert LDAPS to LDAP for tunnel (since we're tunneling the raw connection)
    const isSecure = LDAP_CONFIG.url.startsWith('ldaps://');
    if (isSecure) {
      return `ldap://127.0.0.1:${SSH_CONFIG.localPort}`;
    }
    return LDAP_CONFIG.url;
  }

  async disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
      console.log('SSH tunnel closed');
    }
  }
}

const tunnelManager = new SSHTunnelManager();

// API Key middleware
function checkApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }
  
  const token = authHeader.substring(7);
  if (token !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
}

// Gateway info
app.get('/gateway', (req, res) => {
  res.json({
    name: 'Kinsta LDAP API Gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sshTunnel: {
      enabled: !!SSH_CONFIG.host,
      connected: tunnelManager.isConnected,
      remoteHost: SSH_CONFIG.remoteHost,
      remotePort: SSH_CONFIG.remotePort,
      localPort: SSH_CONFIG.localPort
    },
    port: PORT
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    sshTunnel: tunnelManager.isConnected,
    ldapUrl: LDAP_CONFIG.url
  });
});

// LDAP Authentication endpoint
app.post('/api/ldap/auth', checkApiKey, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  let adminClient = null;
  let userClient = null;

  try {
    console.log(`Gateway auth request for user: ${username}`);
    
    // Ensure SSH tunnel is connected
    await tunnelManager.connect();
    
    // Get tunneled LDAP URL
    const ldapUrl = tunnelManager.getLDAPUrl();
    console.log(`Using LDAP URL: ${ldapUrl}`);
    
    // Create admin client
    adminClient = ldap.createClient({
      url: ldapUrl,
      tlsOptions: LDAP_CONFIG.tlsOptions,
      connectTimeout: LDAP_CONFIG.connectTimeout,
    });

    // Bind as admin
    await new Promise((resolve, reject) => {
      adminClient.bind(LDAP_CONFIG.bindDN, LDAP_CONFIG.bindPassword, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Search for user
    const searchResult = await new Promise((resolve, reject) => {
      const searchFilters = [
        `(sAMAccountName=${username})`,
        `(userPrincipalName=${username}@${LDAP_CONFIG.domainSuffix})`,
        `(|(sAMAccountName=${username})(userPrincipalName=${username}@${LDAP_CONFIG.domainSuffix}))`
      ];

      let found = false;
      let userDN = '';

      const tryFilter = (index) => {
        if (index >= searchFilters.length || found) {
          if (found) resolve({ dn: userDN });
          else reject(new Error('User not found'));
          return;
        }

        const filter = searchFilters[index];
        console.log(`Gateway trying search filter: ${filter}`);

        adminClient.search(
          LDAP_CONFIG.baseDN,
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
              console.log(`Gateway found user: ${userDN}`);
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
      url: ldapUrl,
      tlsOptions: LDAP_CONFIG.tlsOptions,
      connectTimeout: LDAP_CONFIG.connectTimeout,
    });

    await new Promise((resolve, reject) => {
      userClient.bind(searchResult.dn, password, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`Gateway authentication successful for: ${username}`);
    res.json({ success: true, message: 'Authentication successful' });

  } catch (error) {
    console.error('Gateway authentication error:', error);
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Kinsta LDAP API Gateway running on port ${PORT}`);
  console.log(`📍 Gateway URL: https://your-app.kinsta.app`);
  console.log(`🔗 LDAP URL: ${LDAP_CONFIG.url}`);
  console.log(`🌐 SSH Tunnel: ${SSH_CONFIG.host}:${SSH_CONFIG.port} -> ${SSH_CONFIG.remoteHost}:${SSH_CONFIG.remotePort}`);
  console.log('✅ Ready to handle authentication requests...');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await tunnelManager.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await tunnelManager.disconnect();
  process.exit(0);
});
