const fs = require('fs');
const path = require('path');

const dataDir = 'packages/pipeline/data/raw/2025-12-01';
const manifestPath = 'packages/pipeline/data/raw/2025-12-01/manifest.jsonl';

// Find all .gz files
function findGzFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findGzFiles(fullPath));
    } else if (item.endsWith('.gz')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Create manifest entries
function createManifestEntry(filePath) {
  const stat = fs.statSync(filePath);
  // Extract the key from the path - remove the data/raw/2025-12-01/ prefix
  const key = filePath.replace(/^packages\/pipeline\/data\/raw\/2025-12-01\//, '');

  return {
    source_key: key,
    local_path: filePath,
    size_bytes: stat.size,
    last_modified: stat.mtime.toISOString(),
    downloaded_at_utc: new Date().toISOString()
  };
}

// Main function
function main() {
  console.log('Finding .gz files...');
  const gzFiles = findGzFiles(dataDir);
  console.log(`Found ${gzFiles.length} .gz files`);

  console.log('Creating manifest entries...');
  const entries = gzFiles.map(createManifestEntry);

  console.log('Writing manifest file...');
  const manifestContent = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(manifestPath, manifestContent);

  console.log(`Manifest created with ${entries.length} entries at ${manifestPath}`);
}

main();