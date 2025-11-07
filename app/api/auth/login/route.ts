import { NextRequest, NextResponse } from 'next/server';

// Environment variable validation
function validateLDAPConfig() {
  const required = ['LDAP_URL', 'LDAP_BASE_DN', 'LDAP_BIND_DN', 'LDAP_BIND_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate LDAP URL format
  const url = process.env.LDAP_URL!;
  if (!url.startsWith('ldap://') && !url.startsWith('ldaps://')) {
    throw new Error('LDAP_URL must start with ldap:// or ldaps://');
  }
  
  // For LDAPS, ensure proper port
  if (url.startsWith('ldaps://') && !url.includes(':636') && !url.includes(':')) {
    console.warn('LDAPS URL without explicit port 636, appending...');
    process.env.LDAP_URL = url.replace('ldaps://', 'ldaps://your-ldap-server:636');
  }
}

validateLDAPConfig();

// Get LDAP URL - direct connection only
function getEffectiveLDAPUrl(): string {
  return LDAP_URL!;
}

// Proxy configuration
const USE_LDAP_PROXY = process.env.USE_LDAP_PROXY === 'true';
const PROXY_LDAP_URL = process.env.PROXY_LDAP_URL;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

const LDAP_URL = process.env.LDAP_URL;
const LDAP_BASE_DN = process.env.LDAP_BASE_DN;
const LDAP_DOMAIN_SUFFIX = process.env.LDAP_DOMAIN_SUFFIX;
const LDAP_ALT_DOMAIN_SUFFIX = process.env.LDAP_ALT_DOMAIN_SUFFIX;
const LDAP_BIND_DN = process.env.LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD;
const LDAP_TLS_REJECT_UNAUTHORIZED = process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'true';
const LDAP_CONNECT_TIMEOUT = parseInt(process.env.LDAP_CONNECT_TIMEOUT || '30000');
const LDAP_CONNECTION_RETRY_ATTEMPTS = parseInt(process.env.LDAP_CONNECTION_RETRY_ATTEMPTS || '4');
const LDAP_CONNECTION_RETRY_DELAY = parseInt(process.env.LDAP_CONNECTION_RETRY_DELAY || '1000');

// HTTP Proxy Authentication
async function authenticateViaProxy(username: string, password: string): Promise<boolean> {
  if (!PROXY_LDAP_URL) {
    throw new Error('PROXY_LDAP_URL is not configured');
  }

  try {
    console.log('Authenticating via HTTP proxy...');
    
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(`${PROXY_LDAP_URL}/api/gateway/ldap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PROXY_API_KEY || ''}`,
      },
      body: JSON.stringify({
        username,
        password,
        config: {
          ldapUrl: LDAP_URL,
          baseDN: LDAP_BASE_DN,
          bindDN: LDAP_BIND_DN,
          bindPassword: LDAP_BIND_PASSWORD,
          domainSuffix: LDAP_DOMAIN_SUFFIX,
        }
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Proxy authentication failed: ${error}`);
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Proxy authentication error:', error);
    throw error;
  }
}

async function testLDAPConnection(): Promise<{ success: boolean; details: string; outboundIP?: string }> {
  try {
    const ldap = await import('ldapjs');
    const effectiveUrl = getEffectiveLDAPUrl();
    
    const testClient = ldap.createClient({
      url: effectiveUrl,
      tlsOptions: {
        rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
      },
      connectTimeout: LDAP_CONNECT_TIMEOUT,
    });

    // Get outbound IP for debugging
    let outboundIP = 'Unknown';
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      outboundIP = data.ip;
    } catch (ipError) {
      console.log('Could not determine outbound IP:', ipError);
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, LDAP_CONNECT_TIMEOUT);

      testClient.on('connect', () => {
        clearTimeout(timeout);
        console.log('LDAP connection established successfully');
        resolve();
      });
      
      testClient.on('error', (err) => {
        clearTimeout(timeout);
        console.error('LDAP connection error:', err);
        reject(err);
      });
    });

    testClient.unbind();
    return { 
      success: true, 
      details: 'LDAP connection test successful',
      outboundIP
    };
  } catch (connError: any) {
    console.error('Connection test failed:', connError);
    return { 
      success: false, 
      details: connError?.message || 'Unknown connection error',
      outboundIP: 'Unknown'
    };
  }
}

async function authenticateWithLDAP(username: string, password: string): Promise<boolean> {
  if (!LDAP_URL || !LDAP_BASE_DN || !LDAP_BIND_DN || !LDAP_BIND_PASSWORD) {
    throw new Error('LDAP configuration is incomplete');
  }

  // Get effective LDAP URL (direct connection)
  const effectiveLDAPUrl = getEffectiveLDAPUrl();

  // Try both domain suffixes
  const domains = [LDAP_DOMAIN_SUFFIX, LDAP_ALT_DOMAIN_SUFFIX].filter(Boolean);
  
  for (const domain of domains) {
    try {
      const userPrincipalName = `${username}@${domain}`;

      console.log(`Trying authentication for: ${userPrincipalName}`);

      // First, bind as admin to search for the user
      const ldap = await import('ldapjs');
      
      let adminClient: any = null;
      let lastError: Error | null = null;
      
      // Retry connection with exponential backoff
      for (let attempt = 1; attempt <= LDAP_CONNECTION_RETRY_ATTEMPTS; attempt++) {
        try {
          console.log(`Connection attempt ${attempt}/${LDAP_CONNECTION_RETRY_ATTEMPTS}`);
          
          adminClient = ldap.createClient({
            url: effectiveLDAPUrl,
            tlsOptions: {
              rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
            },
            connectTimeout: LDAP_CONNECT_TIMEOUT,
          });

          // Wait for connection with timeout
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Connection timeout after ${LDAP_CONNECT_TIMEOUT}ms`));
            }, LDAP_CONNECT_TIMEOUT);

            adminClient.on('connect', () => {
              clearTimeout(timeout);
              console.log('LDAP client connected successfully');
              resolve();
            });
            
            adminClient.on('error', (err: Error) => {
              clearTimeout(timeout);
              console.error('LDAP client connection error:', err);
              reject(err);
            });
          });
          
          break; // Connection successful
        } catch (connError) {
          lastError = connError as Error;
          console.error(`Connection attempt ${attempt} failed:`, connError);
          
          if (adminClient) {
            try {
              adminClient.unbind();
            } catch (unbindError) {
              console.error('Unbind error during retry:', unbindError);
            }
          }
          
          if (attempt < LDAP_CONNECTION_RETRY_ATTEMPTS) {
            const delay = LDAP_CONNECTION_RETRY_DELAY * Math.pow(2, attempt - 1);
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!adminClient) {
        throw lastError || new Error('Failed to establish LDAP connection after all retries');
      }

      // Try different bind DN formats for Active Directory
      const bindDNFormats = [
        LDAP_BIND_DN.replace(/\\\\/g, '\\'), // Fix double backslashes first
        LDAP_BIND_DN, // Original format
      ];

      let adminBindSuccessful = false;

      for (const bindDN of bindDNFormats) {
        try {
          console.log(`Trying admin bind with DN: ${bindDN}`);
          await new Promise<void>((resolve, reject) => {
            adminClient.bind(bindDN, LDAP_BIND_PASSWORD, (err: any) => {
              if (err) {
                reject(err);
              } else {
                console.log(`Admin bind successful with: ${bindDN}`);
                resolve();
              }
            });
          });
          adminBindSuccessful = true;
          break;
        } catch (bindError) {
          console.log(`Bind attempt failed for ${bindDN}, trying next format...`);
          continue;
        }
      }

      if (!adminBindSuccessful) {
        throw new Error('All admin bind attempts failed');
      }

      // Search for the user with multiple filter options
      const searchFilters = [
        `(userPrincipalName=${userPrincipalName})`,
        `(sAMAccountName=${username})`,
        `(mail=${userPrincipalName})`,
        `(|(userPrincipalName=${userPrincipalName})(sAMAccountName=${username})(mail=${userPrincipalName}))`
      ];
      
      let searchResult: { dn: string; attributes: any } | null = null;
      
      for (const filter of searchFilters) {
        if (searchResult) break; // Already found user
        
        try {
          console.log(`Trying search with filter: ${filter}`);
          searchResult = await new Promise<{ dn: string; attributes: any }>((resolve, reject) => {
            adminClient.search(
              LDAP_BASE_DN,
              {
                scope: 'sub',
                filter: filter,
                attributes: ['dn', 'userPrincipalName', 'cn', 'mail', 'sAMAccountName', 'distinguishedName'],
              },
              (err: any, res: any) => {
                if (err) {
                  console.error('Search failed:', err);
                  reject(err);
                  return;
                }

                const entries: Array<{ dn: string; attributes: any }> = [];
                
                res.on('searchEntry', (entry: any) => {
                  // The DN is in entry.objectName, but it's an LdapDn object
                  // Convert it to string using toString() or .dn property
                  let userDN = entry.objectName;
                  
                  console.log('Raw DN object:', userDN);
                  console.log('DN type:', typeof userDN);
                  console.log('DN constructor:', userDN?.constructor?.name);
                  
                  // Handle LdapDn object
                  if (userDN && typeof userDN === 'object' && 'toString' in userDN) {
                    userDN = (userDN as any).toString();
                  }
                  
                  const attributes = entry.pojo?.attributes || [];
                  
                  // Also try to get DN from attributes
                  const distinguishedName = attributes.find((attr: any) => attr.type === 'distinguishedName')?.values?.[0] || 
                                           entry.dn;
                  
                  console.log('Found entry with DN (string):', userDN);
                  console.log('Alternative DN from attributes:', distinguishedName);
                  
                  entries.push({
                    dn: userDN || distinguishedName,
                    attributes: attributes
                  });
                });
                
                res.on('end', () => {
                  if (entries.length === 0) {
                    console.log(`User not found with filter: ${filter}`);
                    reject(new Error('User not found'));
                  } else {
                    console.log('User found with DN:', entries[0].dn);
                    resolve(entries[0]);
                  }
                });
                
                res.on('error', (err: any) => {
                  console.error('Search error:', err);
                  reject(err);
                });
              }
            );
          });
        } catch (err) {
          console.log(`Search failed with filter ${filter}, trying next...`);
          continue;
        }
      }
      
      if (!searchResult) {
        throw new Error('User not found with any search filter');
      }

      // Close admin connection properly
      await new Promise<void>((resolve) => {
        adminClient.unbind((err: any) => {
          if (err) console.error('Admin unbind error:', err);
          resolve();
        });
      });

      // Validate that we have a DN
      if (!searchResult.dn || typeof searchResult.dn !== 'string') {
        throw new Error('Invalid DN returned from search');
      }

      // Now try to authenticate as the user
      const userClient = ldap.createClient({
        url: effectiveLDAPUrl,
        tlsOptions: {
          rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
        },
        connectTimeout: LDAP_CONNECT_TIMEOUT,
      });

      await new Promise<void>((resolve, reject) => {
        userClient.bind(searchResult.dn, password, (err: any) => {
          if (err) {
            console.error('User bind failed:', err);
            reject(err);
          } else {
            console.log('User authentication successful');
            resolve();
          }
        });
      });

      // Close user connection properly
      await new Promise<void>((resolve) => {
        userClient.unbind((err: any) => {
          if (err) console.error('User unbind error:', err);
          resolve();
        });
      });

      return true;

    } catch (error) {
      console.error(`Authentication failed for domain ${domain}:`, error);
      // Try next domain if this one failed
      continue;
    }
  }

  throw new Error('Authentication failed');
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Debug: Log environment variables (remove in production)
    console.log('Environment variables:', {
      LDAP_URL: !!LDAP_URL,
      LDAP_BASE_DN: !!LDAP_BASE_DN,
      LDAP_DOMAIN_SUFFIX: !!LDAP_DOMAIN_SUFFIX,
      LDAP_ALT_DOMAIN_SUFFIX: !!LDAP_ALT_DOMAIN_SUFFIX,
      LDAP_BIND_DN: !!LDAP_BIND_DN,
      LDAP_BIND_PASSWORD: !!LDAP_BIND_PASSWORD,
      LDAP_TLS_REJECT_UNAUTHORIZED: LDAP_TLS_REJECT_UNAUTHORIZED,
    });
    
    console.log('LDAP Configuration:', {
      LDAP_URL,
      LDAP_BASE_DN,
      LDAP_DOMAIN_SUFFIX,
      LDAP_ALT_DOMAIN_SUFFIX,
      LDAP_BIND_DN,
      LDAP_CONNECT_TIMEOUT,
    });

    // For testing purposes, allow a simple test login
    if (username === 'test' && password === 'test') {
      return NextResponse.json({ success: true, message: 'Login successful' });
    }

    // Add comprehensive connection test endpoint
    if (username === 'connection-test' && password === 'connection-test') {
      console.log('Running comprehensive connection test...');
      
      const connectionTest = await testLDAPConnection();
      
      if (!connectionTest.success) {
        return NextResponse.json({ 
          error: 'Connection test failed', 
          details: connectionTest.details,
          outboundIP: connectionTest.outboundIP,
          config: {
            url: LDAP_URL!,
            baseDN: LDAP_BASE_DN!,
            bindDN: LDAP_BIND_DN!,
            tlsEnabled: LDAP_URL!.startsWith('ldaps://'),
            tlsRejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
            connectTimeout: LDAP_CONNECT_TIMEOUT,
            retryAttempts: LDAP_CONNECTION_RETRY_ATTEMPTS
          },
          kinstaIPRanges: [
            '34.1.128.0/20',
            '34.1.192.0/20',
            '34.2.16.0/20',
            '34.2.128.0/17',
            '34.21.128.0/17',
            '34.87.0.0/17',
            '34.87.128.0/18',
            '34.104.58.0/23',
            '34.104.106.0/23',
            '34.124.42.0/23',
            '34.124.128.0/17',
            '34.126.64.0/18',
            '34.126.128.0/18',
            '34.128.44.0/23',
            '34.128.60.0/23',
            '34.142.128.0/17',
            '34.143.128.0/17',
            '34.152.104.0/23',
            '34.153.40.0/23',
            '34.153.232.0/23',
            '34.157.82.0/23',
            '34.157.88.0/23',
            '34.157.210.0/23',
            '34.158.32.0/19',
            '34.177.72.0/23',
            '35.185.176.0/20',
            '35.186.144.0/20',
            '35.187.224.0/19',
            '35.197.128.0/19',
            '35.198.192.0/18',
            '35.213.128.0/18',
            '35.220.24.0/23',
            '35.234.192.0/20',
            '35.240.128.0/17',
            '35.242.24.0/23',
            '35.247.128.0/18',
            '136.110.0.0/18'
          ]
        }, { status: 500 });
      }
      
      // Test admin bind if connection successful
      try {
        const ldap = await import('ldapjs');
        const testClient = ldap.createClient({
          url: LDAP_URL!,
          tlsOptions: {
            rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
          },
          connectTimeout: LDAP_CONNECT_TIMEOUT,
        });

        await new Promise<void>((resolve, reject) => {
          testClient.on('connect', () => {
            resolve();
          });
          
          testClient.on('error', (err) => {
            reject(err);
          });
        });

        await new Promise<void>((resolve, reject) => {
          testClient.bind(LDAP_BIND_DN!, LDAP_BIND_PASSWORD!, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        testClient.unbind();
        
        return NextResponse.json({ 
          success: true, 
          message: 'LDAP connection and bind test successful',
          details: connectionTest.details,
          outboundIP: connectionTest.outboundIP,
          config: {
            url: LDAP_URL!,
            baseDN: LDAP_BASE_DN!,
            bindDN: LDAP_BIND_DN!,
            tlsEnabled: LDAP_URL!.startsWith('ldaps://'),
            tlsRejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
            connectTimeout: LDAP_CONNECT_TIMEOUT,
            retryAttempts: LDAP_CONNECTION_RETRY_ATTEMPTS
          }
        });
      } catch (bindError: any) {
        return NextResponse.json({ 
          error: 'Connection successful but bind failed', 
          connectionDetails: connectionTest.details,
          bindError: bindError?.message || 'Unknown bind error',
          outboundIP: connectionTest.outboundIP,
          config: {
            url: LDAP_URL!,
            baseDN: LDAP_BASE_DN!,
            bindDN: LDAP_BIND_DN!,
            tlsEnabled: LDAP_URL!.startsWith('ldaps://'),
            tlsRejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED
          }
        }, { status: 500 });
      }
    }

    // Try LDAP authentication
    let authenticated = false;
    
    if (USE_LDAP_PROXY) {
      console.log('Using LDAP proxy for authentication...');
      try {
        authenticated = await authenticateViaProxy(username, password);
      } catch (proxyError) {
        console.error('Proxy authentication failed, falling back to direct LDAP:', proxyError);
        // Fallback to direct LDAP if proxy fails
        authenticated = await authenticateWithLDAP(username, password);
      }
    } else {
      authenticated = await authenticateWithLDAP(username, password);
    }

    if (authenticated) {
      return NextResponse.json({ success: true, message: 'Login successful' });
    } else {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: error.message || 'Authentication failed' },
      { status: 401 }
    );
  } finally {
  }
}