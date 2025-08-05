#!/bin/bash
echo "Starting backend setup..."

# Install Node.js dependencies
npm install

# Optional: Run tests or any setup scripts
# npm test

echo "Setup complete! Project is ready to go."


#!/bin/bash
echo "Starting backing up folder setup..."
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)" # Timestamp for uniqueness
mkdir -p $BACKUP_DIR
# Exclude backup dirs with rsync for safety
rsync -av --exclude="backup*" ./ $BACKUP_DIR
echo "Done!"

