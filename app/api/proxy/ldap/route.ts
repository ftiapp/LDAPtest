import { NextRequest, NextResponse } from 'next/server';

// HTTP LDAP Proxy - แปลง HTTP request เป็น LDAP connection
const PROXY_LDAP_URL = process.env.PROXY_LDAP_URL;
const PROXY_LDAP_BASE_DN = process.env.PROXY_LDAP_BASE_DN;
const PROXY_LDAP_BIND_DN = process.env.PROXY_LDAP_BIND_DN;
const PROXY_LDAP_BIND_PASSWORD = process.env.PROXY_LDAP_BIND_PASSWORD;
const PROXY_LDAP_DOMAIN_SUFFIX = process.env.PROXY_LDAP_DOMAIN_SUFFIX;

// ถ้ามี proxy config จะใช้ proxy ถ้าไม่มีจะใช้ direct LDAP
const USE_PROXY = process.env.USE_LDAP_PROXY === 'true';

async function authenticateViaProxy(username: string, password: string): Promise<boolean> {
  if (!PROXY_LDAP_URL || !PROXY_LDAP_BIND_DN || !PROXY_LDAP_BIND_PASSWORD) {
    throw new Error('Proxy LDAP configuration is incomplete');
  }

  try {
    // เรียก proxy service ที่ทำงานบน server ที่เข้าถึง LDAP ได้
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${PROXY_LDAP_URL}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PROXY_API_KEY || ''}`,
      },
      body: JSON.stringify({
        username,
        password,
        baseDN: PROXY_LDAP_BASE_DN,
        bindDN: PROXY_LDAP_BIND_DN,
        bindPassword: PROXY_LDAP_BIND_PASSWORD,
        domainSuffix: PROXY_LDAP_DOMAIN_SUFFIX,
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

// Simple LDAP-over-HTTP proxy server (สำหรับ deploy บน server ที่เข้าถึง LDAP ได้)
export async function POST(request: NextRequest) {
  try {
    const { action, username, password, config } = await request.json();

    if (action === 'auth') {
      // Proxy authentication
      const ldap = await import('ldapjs');
      
      const client = ldap.createClient({
        url: config.ldapUrl,
        tlsOptions: {
          rejectUnauthorized: false, // สำหรับ proxy สามารถปิดได้
        },
        connectTimeout: 30000,
      });

      // Admin bind
      await new Promise<void>((resolve, reject) => {
        client.bind(config.bindDN, config.bindPassword, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Search user
      const searchResult = await new Promise<any>((resolve, reject) => {
        client.search(
          config.baseDN,
          {
            scope: 'sub',
            filter: `(sAMAccountName=${username})`,
            attributes: ['dn'],
          },
          (err: any, res: any) => {
            if (err) reject(err);
            
            let userDN = '';
            res.on('searchEntry', (entry: any) => {
              userDN = entry.objectName?.toString() || entry.dn;
            });
            
            res.on('end', () => {
              if (userDN) resolve({ dn: userDN });
              else reject(new Error('User not found'));
            });
            
            res.on('error', reject);
          }
        );
      });

      // User authentication
      const userClient = ldap.createClient({
        url: config.ldapUrl,
        tlsOptions: { rejectUnauthorized: false },
        connectTimeout: 30000,
      });

      await new Promise<void>((resolve, reject) => {
        userClient.bind(searchResult.dn, password, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Cleanup
      client.unbind();
      userClient.unbind();

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Proxy error:', error);
    return NextResponse.json({ 
      error: error.message || 'Proxy operation failed' 
    }, { status: 500 });
  }
}
