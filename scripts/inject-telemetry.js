const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const connString = process.env.TELEMETRY_CONNECTION_STRING;
const posthogKey = process.env.POSTHOG_API_KEY;
const posthogHost = process.env.POSTHOG_HOST;

if (connString) {
    pkg.telemetryConnectionString = connString;
    console.log('✓ Telemetry connection string injected');
} else {
    console.log('⚠ No telemetry connection string found');
}

if (posthogKey) {
    pkg.posthogApiKey = posthogKey;
    console.log('✓ PostHog API key injected');
} else {
    console.log('⚠ No PostHog API key found');
}

if (posthogHost) {
    pkg.posthogHost = posthogHost;
    console.log('✓ PostHog host injected');
}

fs.writeFileSync(
    path.resolve(__dirname, '..', 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
);
