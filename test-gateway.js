#!/usr/bin/env node

// Test script for API Gateway
const https = require('https');
const http = require('http');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:443';
const API_KEY = process.env.PROXY_API_KEY || 'your-secret-api-key';

function testGateway() {
  console.log('🧪 Testing API Gateway...\n');
  
  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  makeRequest('GET', '/health', null, (err, data) => {
    if (err) {
      console.log('❌ Health check failed:', err.message);
    } else {
      console.log('✅ Health check passed');
      console.log('   Status:', data.status);
      console.log('   Services:', data.services);
    }
    
    // Test 2: Gateway info
    console.log('\n2. Testing gateway info...');
    makeRequest('GET', '/gateway', null, (err, data) => {
      if (err) {
        console.log('❌ Gateway info failed:', err.message);
      } else {
        console.log('✅ Gateway info passed');
        console.log('   Name:', data.name);
        console.log('   Version:', data.version);
        console.log('   SSL:', data.ssl);
        console.log('   Services:', data.services.length);
      }
      
      // Test 3: Service health
      console.log('\n3. Testing LDAP service health...');
      makeRequest('GET', '/health/ldap', null, (err, data) => {
        if (err) {
          console.log('❌ LDAP service health failed:', err.message);
        } else {
          console.log('✅ LDAP service health passed');
          console.log('   Service:', data.service);
          console.log('   Status:', data.status);
        }
        
        // Test 4: Authentication (with test credentials)
        console.log('\n4. Testing LDAP authentication...');
        const authPayload = {
          username: 'test',
          password: 'test'
        };
        
        makeRequest('POST', '/api/ldap/auth', authPayload, (err, data) => {
          if (err) {
            console.log('❌ Authentication test failed:', err.message);
          } else {
            console.log('✅ Authentication test passed');
            console.log('   Success:', data.success);
            console.log('   Message:', data.message);
          }
          
          console.log('\n🎉 Gateway testing complete!');
        });
      });
    });
  });
}

function makeRequest(method, path, payload, callback) {
  const isHttps = GATEWAY_URL.startsWith('https://');
  const client = isHttps ? https : http;
  const url = new URL(GATEWAY_URL + path);
  
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  };
  
  if (payload) {
    options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(payload));
  }
  
  const req = client.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          callback(null, parsed);
        } else {
          callback(new Error(`HTTP ${res.statusCode}: ${parsed.error || data}`), null);
        }
      } catch (e) {
        callback(new Error(`Invalid response: ${data}`), null);
      }
    });
  });
  
  req.on('error', (err) => {
    callback(err, null);
  });
  
  if (payload) {
    req.write(JSON.stringify(payload));
  }
  
  req.end();
}

// Run tests
if (require.main === module) {
  testGateway();
}

module.exports = { testGateway };
