import { NextRequest, NextResponse } from 'next/server';

// LDAP Gateway API Route - ใช้ใน Next.js project เดียวกัน
const LDAP_URL = process.env.LDAP_URL;
const LDAP_BASE_DN = process.env.LDAP_BASE_DN;
const LDAP_BIND_DN = process.env.LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD;
const LDAP_DOMAIN_SUFFIX = process.env.LDAP_DOMAIN_SUFFIX;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

function checkApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.substring(7);
  return token === GATEWAY_API_KEY;
}

export async function POST(request: NextRequest) {
  try {
    // Check API key
    if (!checkApiKey(request)) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    console.log(`Gateway auth request for user: ${username}`);

    // Direct LDAP authentication
    const ldap = await import('ldapjs');
    
    let adminClient: any = null;
    let userClient: any = null;

    try {
      // Create admin client
      adminClient = ldap.createClient({
        url: LDAP_URL!,
        tlsOptions: {
          rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
        },
        connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT || '30000'),
      });

      // Bind as admin
      await new Promise<void>((resolve, reject) => {
        adminClient.bind(LDAP_BIND_DN!, LDAP_BIND_PASSWORD!, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Search for user
      const searchResult = await new Promise<{ dn: string }>((resolve, reject) => {
        const searchFilters = [
          `(sAMAccountName=${username})`,
          `(userPrincipalName=${username}@${LDAP_DOMAIN_SUFFIX})`,
          `(|(sAMAccountName=${username})(userPrincipalName=${username}@${LDAP_DOMAIN_SUFFIX}))`
        ];

        let found = false;
        let userDN = '';

        const tryFilter = (index: number) => {
          if (index >= searchFilters.length || found) {
            if (found) resolve({ dn: userDN });
            else reject(new Error('User not found'));
            return;
          }

          const filter = searchFilters[index];
          console.log(`Gateway trying search filter: ${filter}`);

          adminClient.search(
            LDAP_BASE_DN!,
            {
              scope: 'sub',
              filter: filter,
              attributes: ['dn', 'userPrincipalName', 'sAMAccountName'],
            },
            (err: any, res: any) => {
              if (err) {
                tryFilter(index + 1);
                return;
              }

              res.on('searchEntry', (entry: any) => {
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
        url: LDAP_URL!,
        tlsOptions: {
          rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
        },
        connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT || '30000'),
      });

      await new Promise<void>((resolve, reject) => {
        userClient.bind(searchResult.dn, password, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log(`Gateway authentication successful for: ${username}`);
      return NextResponse.json({ success: true, message: 'Authentication successful' });

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

  } catch (error: any) {
    console.error('Gateway authentication error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Authentication failed' 
    }, { status: 401 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    name: 'LDAP Gateway API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoint: '/api/gateway/ldap'
  });
}
