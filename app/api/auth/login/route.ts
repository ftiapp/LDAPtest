import { NextRequest, NextResponse } from 'next/server';

const LDAP_URL = process.env.LDAP_URL;
const LDAP_BASE_DN = process.env.LDAP_BASE_DN;
const LDAP_DOMAIN_SUFFIX = process.env.LDAP_DOMAIN_SUFFIX;
const LDAP_ALT_DOMAIN_SUFFIX = process.env.LDAP_ALT_DOMAIN_SUFFIX;
const LDAP_BIND_DN = process.env.LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD;
const LDAP_TLS_REJECT_UNAUTHORIZED = process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'true';
const LDAP_CONNECT_TIMEOUT = parseInt(process.env.LDAP_CONNECT_TIMEOUT || '30000');

async function authenticateWithLDAP(username: string, password: string): Promise<boolean> {
  if (!LDAP_URL || !LDAP_BASE_DN || !LDAP_BIND_DN || !LDAP_BIND_PASSWORD) {
    throw new Error('LDAP configuration is incomplete');
  }

  // Try both domain suffixes
  const domains = [LDAP_DOMAIN_SUFFIX, LDAP_ALT_DOMAIN_SUFFIX].filter(Boolean);
  
  for (const domain of domains) {
    try {
      const userPrincipalName = `${username}@${domain}`;

      console.log(`Trying authentication for: ${userPrincipalName}`);

      // First, bind as admin to search for the user
      const ldap = await import('ldapjs');
      const adminClient = ldap.createClient({
        url: LDAP_URL,
        tlsOptions: {
          rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
        },
        connectTimeout: LDAP_CONNECT_TIMEOUT,
      });

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
            adminClient.bind(bindDN, LDAP_BIND_PASSWORD, (err) => {
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
              (err, res) => {
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
                
                res.on('error', (err) => {
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
        adminClient.unbind((err) => {
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
        url: LDAP_URL,
        tlsOptions: {
          rejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED,
        },
        connectTimeout: LDAP_CONNECT_TIMEOUT,
      });

      await new Promise<void>((resolve, reject) => {
        userClient.bind(searchResult.dn, password, (err) => {
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
        userClient.unbind((err) => {
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

    // Add connection test endpoint
    if (username === 'connection-test' && password === 'connection-test') {
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
            console.log('LDAP connection established successfully');
            resolve();
          });
          
          testClient.on('error', (err) => {
            console.error('LDAP connection error:', err);
            reject(err);
          });
        });

        testClient.unbind();
        return NextResponse.json({ 
          success: true, 
          message: 'LDAP connection test successful',
          config: {
            url: LDAP_URL!,
            baseDN: LDAP_BASE_DN!,
            bindDN: LDAP_BIND_DN!,
            tlsEnabled: LDAP_URL!.startsWith('ldaps://'),
            tlsRejectUnauthorized: LDAP_TLS_REJECT_UNAUTHORIZED
          }
        });
      } catch (connError: any) {
        console.error('Connection test failed:', connError);
        return NextResponse.json({ 
          error: 'Connection test failed', 
          details: connError?.message || 'Unknown connection error' 
        }, { status: 500 });
      }
    }

    // Try LDAP authentication
    const authenticated = await authenticateWithLDAP(username, password);

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
  }
}