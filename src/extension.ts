import * as vscode from 'vscode';
import * as os from 'os';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let authToken: string | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectAttempts = 0;
let pingInterval: any;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000;

interface WebSocketMessage {
    type: string;
    data?: any;
    token?: string;
    status?: string;
    message?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Devek.dev is now active!');

    // Create and register view container
    class DevekViewProvider implements vscode.WebviewViewProvider {
        public static readonly viewType = 'devekViewContainer';

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

            // Handle messages from the webview
            webviewView.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'login':
                        const success = await handleLoginAttempt(context, message.email, message.password);
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
                        vscode.env.openExternal(vscode.Uri.parse('https://app.devek.dev/'));
                        break;
                }
            });
        }
    }

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DevekViewProvider.viewType, new DevekViewProvider())
    );

    // Rest of your existing activate function...
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('devek.login', () => showLoginWebview(context)),
        vscode.commands.registerCommand('devek.logout', () => handleLogout(context)),
        vscode.commands.registerCommand('devek.reconnect', () => connectToWebSocket(context)),
        vscode.commands.registerCommand('devek.showMenu', showMenu),
        vscode.commands.registerCommand('devek.showApp', () => showAppWebview(context))
    );

    // Load saved token from storage
    authToken = context.globalState.get('devekAuthToken') || null;
    
    // Initialize connection
    if (authToken) {
        connectToWebSocket(context);
    } else {
        updateStatusBar('disconnected');
        showLoginPrompt();
    }
}


function getAppHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100%;
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
            <iframe src="https://app.devek.dev" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </body>
        </html>
    `;
}

function showLoginWebview(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'devekLogin',
        'Devek.dev Login',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

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
                        const success = await handleLoginAttempt(context, message.email, message.password);
                        if (success) {
                            panel.dispose();
                            showAppWebview(context); // Show app after successful login
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
                    vscode.env.openExternal(vscode.Uri.parse('https://app.devek.dev/'));
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
}

function getLoginHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    padding: 20px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .container {
                    max-width: 400px;
                    margin: 0 auto;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                input {
                    width: 100%;
                    padding: 8px;
                    margin-top: 5px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    width: 100%;
                }
                button:hover {
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
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" required>
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <div class="error" id="error-message"></div>
                <button id="loginButton" onclick="login()">Login</button>
                <div class="register-link">
                    Not yet registered? <a href="#" onclick="register()">Register here</a>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const button = document.getElementById('loginButton');
                const errorElement = document.getElementById('error-message');
                
                function login() {
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    
                    if (!email || !password) {
                        showError('Please fill in all fields');
                        return;
                    }
                    
                    button.disabled = true;
                    errorElement.style.display = 'none';
                    
                    vscode.postMessage({
                        command: 'login',
                        email: email,
                        password: password
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


function showAppWebview(_context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'devekApp',
        'Devek.dev',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100%;
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
            <iframe src="https://app.devek.dev" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </body>
        </html>
    `;
}

function handleLoginAttempt(context: vscode.ExtensionContext, email: string, password: string): Promise<boolean> {
    return new Promise((resolve) => {
        updateStatusBar('connecting');
        
        let loginTimeout = setTimeout(() => {
            resolve(false);
            vscode.window.showErrorMessage('Login attempt timed out');
            updateStatusBar('disconnected');
        }, 10000);

        connectToWebSocket(context, { type: 'login', data: { email, password } }, (success) => {
            clearTimeout(loginTimeout);
            resolve(success);
        });
    });
}

function handleLogout(context: vscode.ExtensionContext) {
    authToken = null;
    context.globalState.update('devekAuthToken', null);
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
    ).then(selection => {
        if (!selection) { 
            return; 
        };

        switch (selection.label) {
            case 'View App':
                vscode.commands.executeCommand('devek.showApp');
                break;
            case 'Logout':
                vscode.commands.executeCommand('devek.logout');
                break;
            case 'Reconnect':
                vscode.commands.executeCommand('devek.reconnect');
                break;
            case 'Learn More':
                vscode.env.openExternal(vscode.Uri.parse('https://devek.dev'));
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
                vscode.commands.executeCommand('devek.login');
            }
        });
        return;
    }

    const status = ws?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected';
    const hostname = os.hostname();
    const message = `Status: ${status}\nDevice: ${hostname}\nEnvironment: ${vscode.env.appName}`;
    
    vscode.window.showInformationMessage(message, 'Reconnect', 'Logout').then(selection => {
        if (selection === 'Reconnect') {
            vscode.commands.executeCommand('devek.reconnect');
        } else if (selection === 'Logout') {
            vscode.commands.executeCommand('devek.logout');
        }
    });
}

function updateStatusBar(status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'initializing') {
    const statusMap = {
        connected: {
            text: '$(check) Devek.dev',
            tooltip: 'Connected to Devek.dev - Click to view options',
            command: 'devek.showMenu'
        },
        connecting: {
            text: '$(loading~spin) Devek.dev',
            tooltip: 'Connecting to Devek.dev...',
            command: undefined
        },
        disconnected: {
            text: '$(plug) Devek.dev',
            tooltip: 'Click to login to Devek.dev',
            command: 'devek.login'
        },
        error: {
            text: '$(error) Devek.dev',
            tooltip: 'Connection error - Click to retry',
            command: 'devek.reconnect'
        },
        initializing: {
            text: '$(loading~spin) Devek.dev',
            tooltip: 'Initializing Devek.dev...',
            command: undefined
        }
    };

    const currentStatus = statusMap[status];
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
    ).then(selection => {
        if (selection === 'Login') {
            vscode.commands.executeCommand('devek.login');
        } else if (selection === 'Learn More') {
            vscode.env.openExternal(vscode.Uri.parse('https://devek.dev'));
        }
    });
}

function connectToWebSocket(context: vscode.ExtensionContext, loginData?: WebSocketMessage, loginCallback?: (success: boolean) => void) {
    const wsUrl = process.env.DEVEK_WS_URL || 'wss://ws.devek.dev';
    
    if (ws) {
        clearInterval(pingInterval);
        ws.close();
    }

    ws = new WebSocket(wsUrl);
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
        }, 30000);
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

                default:
                    if (response.status === 'success') {
                        if (response.token) {
                            authToken = response.token;
                            context.globalState.update('devekAuthToken', authToken);
                            ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
                        }
                    } else if (response.status === 'error') {
                        console.error('Server error:', response.message);
                        if (response.message?.includes('Authentication failed')) {
                            authToken = null;
                            context.globalState.update('devekAuthToken', null);
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
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        updateStatusBar('connecting');
        
        const delay = RECONNECT_INTERVAL * Math.min(reconnectAttempts, 3); // Progressive backoff
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

export function deactivate() {
    if (ws) {
        clearInterval(pingInterval);
        ws.close();
        console.log('WebSocket connection closed');
    }
}