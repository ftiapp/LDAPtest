'use client';

import { useState } from 'react';

export default function DebugPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState('');

  const runConnectionTest = async () => {
    setLoading(true);
    setError('');
    setResults(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          username: 'connection-test', 
          password: 'connection-test' 
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResults(data);
      } else {
        setError(data.error || 'Connection test failed');
        setResults(data);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              LDAP Connection Diagnostics
            </h1>
            <p className="text-gray-600 mb-6">
              This tool helps diagnose LDAP connectivity issues on Kinsta deployment.
              Use this to identify if your application's outbound IP needs to be whitelisted.
            </p>

            <div className="mb-6">
              <button
                onClick={runConnectionTest}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Running Test...
                  </>
                ) : (
                  'Run Connection Test'
                )}
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-6">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            )}

            {results && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 text-blue-600 px-4 py-3">
                  <h3 className="text-sm font-medium text-blue-800">Test Results</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    {results.success ? '✅ Connection successful' : '❌ Connection failed'}
                  </p>
                </div>

                {/* Outbound IP Information */}
                {results.outboundIP && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">🌐 Outbound IP Address</h3>
                    <p className="text-sm text-gray-600 mb-2">
                      Your application is currently connecting from: <code className="bg-gray-200 px-2 py-1 rounded">{results.outboundIP}</code>
                    </p>
                    <p className="text-sm text-gray-500">
                      This IP needs to be whitelisted in your LDAP server firewall. If this IP changes after deployment/restart, you may need to whitelist all Kinsta IP ranges.
                    </p>
                  </div>
                )}

                {/* Configuration */}
                {results.config && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">⚙️ LDAP Configuration</h3>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-sm font-medium text-gray-500">LDAP URL</dt>
                        <dd className="text-sm text-gray-900">{results.config.url}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Base DN</dt>
                        <dd className="text-sm text-gray-900">{results.config.baseDN}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Bind DN</dt>
                        <dd className="text-sm text-gray-900">{results.config.bindDN}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">TLS Enabled</dt>
                        <dd className="text-sm text-gray-900">{results.config.tlsEnabled ? 'Yes' : 'No'}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">TLS Reject Unauthorized</dt>
                        <dd className="text-sm text-gray-900">{results.config.tlsRejectUnauthorized ? 'Yes' : 'No'}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Connection Timeout</dt>
                        <dd className="text-sm text-gray-900">{results.config.connectTimeout}ms</dd>
                      </div>
                      {results.config.retryAttempts && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Retry Attempts</dt>
                          <dd className="text-sm text-gray-900">{results.config.retryAttempts}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

                {/* Error Details */}
                {results.details && (
                  <div className="bg-yellow-50 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">📋 Detailed Information</h3>
                    <p className="text-sm text-gray-700">{results.details}</p>
                    {results.bindError && (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-700">Bind Error:</p>
                        <p className="text-sm text-gray-600">{results.bindError}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Kinsta IP Ranges */}
                {results.kinstaIPRanges && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">🔧 Kinsta IP Ranges</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      If your outbound IP changes, whitelist all these ranges in your LDAP server:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {results.kinstaIPRanges.map((range: string, index: number) => (
                        <code key={index} className="text-xs bg-gray-200 px-2 py-1 rounded block">
                          {range}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {/* Troubleshooting Steps */}
                <div className="bg-amber-50 rounded-lg p-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">🔍 Troubleshooting Steps</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                    <li>Check if your outbound IP ({results.outboundIP || 'Unknown'}) is whitelisted in your LDAP server firewall</li>
                    <li>Verify port 636 (LDAPS) is open from your Kinsta application to your LDAP server</li>
                    <li>Ensure your LDAP server certificate is valid or set LDAP_TLS_REJECT_UNAUTHORIZED=false</li>
                    <li>If the IP changes after deployment, whitelist all Kinsta IP ranges shown above</li>
                    <li>Check your LDAP server logs for connection attempts from your application</li>
                    <li>Verify the bind DN and password are correct</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
