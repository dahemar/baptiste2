#!/bin/bash

# Quick setup script for R2 migration
# This checks prerequisites and guides you through the process

set -e

echo "=== R2 Migration Setup Checker ==="
echo ""

# Check AWS CLI
if command -v aws &> /dev/null; then
    echo "✓ AWS CLI installed ($(aws --version | head -n1))"
else
    echo "✗ AWS CLI not installed"
    echo "  Install with: brew install awscli"
    exit 1
fi

# Check for credentials
if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
    echo "✗ R2 credentials not set"
    echo ""
    echo "Next steps:"
    echo "1. Go to: https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/api-tokens"
    echo "2. Create an API token with 'Object Read & Write' permissions"
    echo "3. Set environment variables:"
    echo ""
    echo "   export R2_ACCESS_KEY_ID='your-access-key-id'"
    echo "   export R2_SECRET_ACCESS_KEY='your-secret-access-key'"
    echo ""
    echo "4. Run this script again"
    exit 1
else
    echo "✓ R2 credentials set"
fi

echo ""
echo "✓ All prerequisites met!"
echo ""
echo "Ready to migrate. Run:"
echo "  ./scripts/migrate-to-r2.sh"
