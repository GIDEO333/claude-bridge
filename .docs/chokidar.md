# Chokidar v4 — AI-Optimized Reference

## Install
```
npm install chokidar
```

## Core API

```typescript
import { watch } from 'chokidar';

// Watch a path (file or directory)
const watcher = watch('path/to/dir', {
    persistent: true,          // keep process alive while watching
    ignoreInitial: false,      // fire 'add' for existing files on start
    depth: 0,                  // don't recurse into subdirectories (0 = top-level only)
    awaitWriteFinish: {
        stabilityThreshold: 500,  // ms the file size must stay constant
        pollInterval: 100         // ms between size checks
    },
    ignored: /(^|[\/\\])\../  // ignore dotfiles
});
```

## Events
```typescript
watcher
    .on('add', (filePath) => { /* file created */ })
    .on('change', (filePath) => { /* file modified */ })
    .on('unlink', (filePath) => { /* file deleted */ })
    .on('addDir', (dirPath) => { /* directory created */ })
    .on('unlinkDir', (dirPath) => { /* directory deleted */ })
    .on('error', (err) => { /* error */ })
    .on('ready', () => { /* initial scan complete */ });
```

## Close watcher
```typescript
await watcher.close();
```

## Key Notes
- Returns a `FSWatcher` instance (chokidar v4, not Node's native `fs.watch`)
- `awaitWriteFinish` is essential for large file writes (prevents partial-read race conditions)
- `depth: 0` means only watch files directly inside the path, not subdirectories
