import * as vscode from 'vscode';
import * as os from 'os';
import WebSocket from 'ws';
import { StatusBarState } from './types';
import { 
    WEBVIEW_SETTINGS, 
    WEBSOCKET_CONFIG, 
    URLS, 
    STORAGE_KEYS, 
    STATUS_BAR_CONFIG,
    COMMANDS 
} from './constants';

let ws: WebSocket | null = null;
let authToken: string | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectAttempts = 0;
let pingInterval: any;
let view: vscode.Webview | null;

interface WebSocketMessage {
    type: string;
    data?: any;
    token?: string;
    status?: string;
    message?: string;
}

type StatusType = 'connected' | 'connecting' | 'disconnected' | 'error' | 'initializing';

export function activate(context: vscode.ExtensionContext) {
    console.log('Devek.dev is now active!');

    // Create and register view container
    class DevekViewProvider implements vscode.WebviewViewProvider {
        public static readonly viewType = WEBVIEW_SETTINGS.IDENTIFIERS.VIEW_CONTAINER;

        resolveWebviewView(
            webviewView: vscode.WebviewView,
            _context: vscode.WebviewViewResolveContext,
            _token: vscode.CancellationToken,
        ): void | Thenable<void> {
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: []
            };

            // If logged in, show app, otherwise show login
            if (authToken) {
                webviewView.webview.html = getAppHtml();
            } else {
                webviewView.webview.html = getLoginHtml();
            }
            view = webviewView.webview;
            // Handle messages from the webview
            webviewView.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'login':
                        const success = await handleLoginAttempt(context);
                        if (success) {
                            webviewView.webview.html = getAppHtml();
                        } else {
                            webviewView.webview.postMessage({ 
                                type: 'error', 
                                message: 'Invalid email or password' 
                            });
                        }
                        break;
                    case 'register':
                        vscode.env.openExternal(vscode.Uri.parse(URLS.APP));
                        break;
                }
            });
        }
    }

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DevekViewProvider.viewType, new DevekViewProvider())
    );

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 
        STATUS_BAR_CONFIG.ALIGNMENT_PRIORITY
    );
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LOGIN, showView),  // Just use showView here
        vscode.commands.registerCommand(COMMANDS.LOGOUT, () => handleLogout(context)),
        vscode.commands.registerCommand(COMMANDS.RECONNECT, () => connectToWebSocket(context)),
        vscode.commands.registerCommand(COMMANDS.SHOW_MENU, showMenu),
        vscode.commands.registerCommand(COMMANDS.SHOW_APP, showView)
    );

    // Load saved token from storage
    authToken = context.globalState.get(STORAGE_KEYS.AUTH_TOKEN) || null;
    
    // Initialize connection
    if (authToken) {
        connectToWebSocket(context);
    } else {
        updateStatusBar('disconnected');
        showLoginPrompt();
    }
}

function getLoginHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 20px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .container {
                    width: ${WEBVIEW_SETTINGS.COLUMN_WIDTH}px;
                    margin: 0 auto;
                }
                form {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }
                input {
                    width: 100%;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    box-sizing: border-box;
                }
                input:focus {
                    outline: 2px solid var(--vscode-focusBorder);
                    border-color: transparent;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    width: 100%;
                    transition: background-color 0.2s;
                }
                button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    margin-top: 10px;
                    display: none;
                    padding: 8px;
                    border-radius: 4px;
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }
                .register-link {
                    text-align: center;
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid var(--vscode-input-border);
                }
                .register-link a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                .register-link a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Login to Devek.dev</h2>
                <div class="error" id="error-message"></div>
                <button type="submit" id="loginButton" onClick="handleSubmit()">Login</button>
                <div class="register-link">
                    Not yet registered? <a href="#" onclick="register()">Register here</a>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const button = document.getElementById('loginButton');
                const errorElement = document.getElementById('error-message');
                
                function handleSubmit() {
                    vscode.postMessage({
                        command: 'login'
                    });
                }

                function register() {
                    vscode.postMessage({
                        command: 'register'
                    });
                }

                function showError(message) {
                    errorElement.textContent = message;
                    errorElement.style.display = 'block';
                    button.disabled = false;
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'error') {
                        showError(message.message);
                    }
                });
            </script>
        </body>
        </html>
    `;
}

function showLoginWebview(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        WEBVIEW_SETTINGS.IDENTIFIERS.LOGIN,
        WEBVIEW_SETTINGS.TITLES.LOGIN,
        { 
            viewColumn: vscode.ViewColumn.Active, 
            preserveFocus: true 
        },
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Set editor group width
    vscode.commands.executeCommand('workbench.action.setEditorLayoutVirtualWidth', WEBVIEW_SETTINGS.COLUMN_WIDTH);

    let loginInProgress = false;

    panel.webview.html = getLoginHtml();

    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'login':
                    if (loginInProgress) { 
                        return;
                    };
                    loginInProgress = true;

                    try {
                        const success = await handleLoginAttempt(context);
                        if (success) {
                            panel.dispose();
                            showAppWebview(context);
                        } else {
                            panel.webview.postMessage({ 
                                type: 'error', 
                                message: 'Invalid email or password' 
                            });
                        }
                    } catch (error) {
                        panel.webview.postMessage({ 
                            type: 'error', 
                            message: 'Failed to connect to server' 
                        });
                    } finally {
                        loginInProgress = false;
                    }
                    break;
                case 'register':
                    vscode.env.openExternal(vscode.Uri.parse(URLS.APP));
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
}

function getAppHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    width: ${WEBVIEW_SETTINGS.COLUMN_WIDTH}px;
                    height: 100vh;
                    overflow: hidden;
                }
                iframe {
                    width: 100%;
                    height: 100vh;
                    border: none;
                }
            </style>
        </head>
        <body>
            <iframe src="${URLS.APP}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </body>
        </html>
    `;
}

function showAppWebview(_context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        WEBVIEW_SETTINGS.IDENTIFIERS.APP,
        WEBVIEW_SETTINGS.TITLES.APP,
        { 
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: true 
        },
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Set editor group width
    vscode.commands.executeCommand('workbench.action.setEditorLayoutVirtualWidth', WEBVIEW_SETTINGS.COLUMN_WIDTH);

    panel.webview.html = getAppHtml();
}

function handleLoginAttempt(context: vscode.ExtensionContext): Promise<boolean> {
    return new Promise((resolve) => {
        updateStatusBar('connecting');
        
        let loginTimeout = setTimeout(() => {
            resolve(false);
            vscode.window.showErrorMessage('Login attempt timed out');
            updateStatusBar('disconnected');
        }, WEBSOCKET_CONFIG.TIMEOUT);

        connectToWebSocket(context, { type: 'plugin_login' }, (data) => {
            clearTimeout(loginTimeout);
            resolve(data);
        });
    });
}

function handleLogout(context: vscode.ExtensionContext) {
    authToken = null;
    context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, null);
    if (ws) {
        clearInterval(pingInterval);
        ws.close();
    }
    updateStatusBar('disconnected');
    showLoginPrompt();
}

function showMenu() {
    const items: { [key: string]: string } = {
        'View App': 'Open Devek.dev application',
        'View Status': authToken ? 'Connected' : 'Disconnected',
        'Logout': 'Sign out from Devek.dev',
        'Reconnect': 'Try reconnecting to server',
        'Learn More': 'Visit Devek.dev documentation'
    };

    vscode.window.showQuickPick(
        Object.keys(items).map(label => ({
            label,
            description: items[label],
            picked: label === 'View Status' && !!authToken
        }))
    ).then(async selection => {
        if (!selection) { 
            return; 
        }

        switch (selection.label) {
            case 'View App':
                await showView();
                break;
            case 'Logout':
                vscode.commands.executeCommand(COMMANDS.LOGOUT);
                break;
            case 'Reconnect':
                vscode.commands.executeCommand(COMMANDS.RECONNECT);
                break;
            case 'Learn More':
                vscode.env.openExternal(vscode.Uri.parse(URLS.DOCS));
                break;
            case 'View Status':
                showConnectionStatus();
                break;
        }
    });
}


function showConnectionStatus() {
    if (!authToken) {
        vscode.window.showInformationMessage('Not connected to Devek.dev', 'Login').then(selection => {
            if (selection === 'Login') {
                vscode.commands.executeCommand(COMMANDS.LOGIN);
            }
        });
        return;
    }

    const status = ws?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected';
    const hostname = os.hostname();
    const message = `Status: ${status}\nDevice: ${hostname}\nEnvironment: ${vscode.env.appName}`;
    
    vscode.window.showInformationMessage(message, 'Reconnect', 'Logout').then(selection => {
        if (selection === 'Reconnect') {
            vscode.commands.executeCommand(COMMANDS.RECONNECT);
        } else if (selection === 'Logout') {
            vscode.commands.executeCommand(COMMANDS.LOGOUT);
        }
    });
}

function updateStatusBar(status: StatusType) {
    const stateKey = status.toUpperCase() as StatusBarState;
    const currentStatus = STATUS_BAR_CONFIG.STATES[stateKey];
    statusBarItem.text = currentStatus.text;
    statusBarItem.tooltip = currentStatus.tooltip;
    statusBarItem.command = currentStatus.command;
    statusBarItem.show();
}

function showLoginPrompt() {
    vscode.window.showInformationMessage(
        'Please login to use Devek.dev',
        'Login',
        'Learn More'
    ).then(async selection => {
        if (selection === 'Login') {
            await showView();
        } else if (selection === 'Learn More') {
            vscode.env.openExternal(vscode.Uri.parse(URLS.DOCS));
        }
    });
}

export function openUrl(url: string) {
    const uri = vscode.Uri.parse(url);
    vscode.env.openExternal(uri);
  }

function connectToWebSocket(context: vscode.ExtensionContext, loginData?: WebSocketMessage, loginCallback?: (success: boolean) => void) {
    if (ws) {
        clearInterval(pingInterval);
        ws.close();
    }

    ws = new WebSocket(URLS.WEBSOCKET);
    updateStatusBar('connecting');

    ws.on('open', () => {
        console.log('Connected to WebSocket server');
        reconnectAttempts = 0;
        
        if (authToken) {
            ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
        } else if (loginData) {
            ws?.send(JSON.stringify(loginData));
        }

        // Start ping interval
        pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            } else {
                clearInterval(pingInterval);
            }
        }, WEBSOCKET_CONFIG.PING_INTERVAL);
    });

    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data.toString());
            switch (response.type) {
                case 'init':
                    updateStatusBar('connected');
                    if (loginCallback) {
                        loginCallback(true);
                    }
                    break;

                case 'pong':
                    console.log('Received pong:', response.data?.timestamp);
                    break;
                case 'plugin_login':
                    openUrl(response.data.url);
                    break;
                case 'plugin_auth':                    
                    authToken = response.data.token;
                    context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, authToken);
                    view.html = getAppHtml();
                    ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
                    break;
                default:
                    if (response.status === 'success') {
                        if (response.token) {
                            authToken = response.token;
                            context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, authToken);
                            ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
                        }
                    } else if (response.status === 'error') {
                        console.error('Server error:', response.message);
                        if (response.message?.includes('Authentication failed')) {
                            authToken = null;
                            context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, null);
                            updateStatusBar('disconnected');
                            if (loginCallback) {
                                loginCallback(false);
                            }
                            vscode.window.showErrorMessage('Authentication failed. Please log in again.');
                        }
                    }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                updateStatusBar('error');
            }
            if (loginCallback) {
                loginCallback(false);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(pingInterval);
        updateStatusBar('error');
        if (loginCallback) {
            loginCallback(false);
        }
        handleReconnection(context);
    });

    ws.on('close', () => {
        console.log('Disconnected from WebSocket server');
        clearInterval(pingInterval);
        if (authToken) {
            updateStatusBar('error');
            handleReconnection(context);
        }
    });

    // Listen for document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (!authToken || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }

            const document = event.document;
            const changes = event.contentChanges;
            const timestamp = new Date().toISOString();

            changes.forEach(change => {
                const { range, text } = change;
                const { start, end } = range;

                if (text.length === 0 && start.line === end.line && start.character === end.character) {
                    return;
                }

                const changeData = {
                    type: 'change',
                    data: {
                        document_uri: document.uri.fsPath.replace(/\\/g, '/'),
                        timestamp,
                        start_line: start.line,
                        start_character: start.character,
                        end_line: end.line,
                        end_character: end.character,
                        text,
                        computer_name: os.hostname(),
                        environment: vscode.env.appName
                    }
                };

                console.log('Sending code change:', JSON.stringify(changeData, null, 2));

                ws?.send(JSON.stringify(changeData), (error) => {
                    if (error) {
                        console.error('Failed to send code change:', error);
                        vscode.window.showErrorMessage('Failed to sync code change');
                    }
                });
            });
        })
    );
}

function handleReconnection(context: vscode.ExtensionContext) {
    if (reconnectAttempts < WEBSOCKET_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        updateStatusBar('connecting');
        
        const delay = WEBSOCKET_CONFIG.RECONNECT_INTERVAL * Math.min(reconnectAttempts, 3); // Progressive backoff
        setTimeout(() => {
            if (authToken) {
                connectToWebSocket(context);
            } else {
                updateStatusBar('disconnected');
            }
        }, delay);
    } else {
        vscode.window.showErrorMessage(
            'Failed to connect to Devek.dev. Would you like to try again?',
            'Retry',
            'Cancel'
        ).then(selection => {
            if (selection === 'Retry') {
                reconnectAttempts = 0;
                connectToWebSocket(context);
            } else {
                updateStatusBar('disconnected');
            }
        });
    }
}

async function showView() {
    try {
        // Show/focus the sidebar first
        await vscode.commands.executeCommand('workbench.view.extension.devek-sidebar');
        
        // Focus our specific view within the sidebar
        await vscode.commands.executeCommand('devekViewContainer.focus');
    } catch (error) {
        console.error('Error showing view:', error);
        vscode.window.showErrorMessage('Failed to open Devek.dev view');
    }
}

export function deactivate() {
    if (ws) {
        clearInterval(pingInterval);
        ws.close();
        console.log('WebSocket connection closed');
    }
}