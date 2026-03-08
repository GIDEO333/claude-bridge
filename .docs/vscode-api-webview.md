# VSCode Extension API — Webview Reference

## Register WebviewViewProvider (Sidebar Panel)
```typescript
import * as vscode from 'vscode';

class MyPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'myExtension.panel'; // matches package.json

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        // Receive messages FROM webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'abort': vscode.commands.executeCommand('...'); break;
            }
        });
    }

    // Send message TO webview
    postMessage(data: object) {
        this._view?.webview.postMessage(data);
    }
}

// Register in activate()
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MyPanel.viewType, provider)
);
```

## package.json — Declare Panel in Sidebar
```json
"contributes": {
    "views": {
        "explorer": [{
            "id": "myExtension.panel",
            "name": "My Panel",
            "type": "webview"
        }]
    },
    "commands": [{
        "command": "myExtension.refresh",
        "title": "Refresh"
    }]
}
```

## Webview HTML → Extension Messaging
```html
<script>
    const vscode = acquireVsCodeApi();

    // Send to extension
    vscode.postMessage({ command: 'abort', processId: '...' });

    // Receive from extension
    window.addEventListener('message', (event) => {
        const data = event.data; // { type, payload }
        console.log(data);
    });
</script>
```

## File Watching from Extension
```typescript
const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern('/path/to/dir', '*.json')
);
watcher.onDidChange((uri) => { /* file changed */ });
watcher.onDidCreate((uri) => { /* file created */ });
context.subscriptions.push(watcher);
```

## Key Notes
- `webview.html` must include proper CSP meta tag for security
- Use `webview.asWebviewUri()` to convert local file paths for use in webview src attributes
- All state inside webview is lost on panel hide — use `vscode.getState()` / `vscode.setState()` to persist
