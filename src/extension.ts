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
let viewProvider: DevekViewProvider | null = null;

interface WebSocketMessage {
    type: string;
    data?: any;
    token?: string;
    status?: string;
    message?: string;
}

type StatusType = 'connected' | 'connecting' | 'disconnected' | 'error' | 'initializing';

// Create and register view container
class DevekViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = WEBVIEW_SETTINGS.IDENTIFIERS.VIEW_CONTAINER;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

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
                    const success = await handleLoginAttempt(this.context);
                    if (success) {
                        webviewView.webview.html = getAppHtml();
                    } else {
                        webviewView.webview.postMessage({ 
                            type: 'error', 
                            message: 'Login attempt timed out' 
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

export function activate(context: vscode.ExtensionContext) {
    console.log('Devek is now active!');

    // Initialize status bar first to provide immediate feedback
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 
        STATUS_BAR_CONFIG.ALIGNMENT_PRIORITY
    );
    context.subscriptions.push(statusBarItem);
    updateStatusBar('initializing');

    // Defensive registration with enhanced error handling for Windsurf compatibility
    try {
        if (!viewProvider) {
            viewProvider = new DevekViewProvider(context);
        }
        
        // Check if view provider is already registered
        const existingProvider = (vscode.window as any)._webviewViewProviders?.get?.(DevekViewProvider.viewType);
        if (!existingProvider) {
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(DevekViewProvider.viewType, viewProvider)
            );
            console.log('View provider registered successfully');
        } else {
            console.log('View provider already exists, skipping registration');
        }
    } catch (error) {
        console.warn('View provider registration failed:', error);
        // Continue with extension activation even if view registration fails
    }

    // Register commands with error handling
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand(COMMANDS.LOGIN, showView),
            vscode.commands.registerCommand(COMMANDS.LOGOUT, () => handleLogout(context)),
            vscode.commands.registerCommand(COMMANDS.RECONNECT, () => connectToWebSocket(context)),
            vscode.commands.registerCommand(COMMANDS.SHOW_MENU, showMenu),
            vscode.commands.registerCommand(COMMANDS.SHOW_APP, showView)
        );
        console.log('Commands registered successfully');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }

    // Load saved token from storage with error handling
    try {
        authToken = context.globalState.get(STORAGE_KEYS.AUTH_TOKEN) || null;
        console.log('Auth token loaded:', authToken ? 'present' : 'not found');
    } catch (error) {
        console.error('Failed to load auth token:', error);
        authToken = null;
    }
    
    // Delay connection initialization to avoid race conditions
    setTimeout(() => {
        try {
            if (authToken) {
                console.log('Attempting WebSocket connection with existing token');
                connectToWebSocket(context);
            } else {
                console.log('No auth token found, showing login prompt');
                updateStatusBar('disconnected');
                showLoginPrompt();
            }
        } catch (error) {
            console.error('Failed to initialize connection:', error);
            if (authToken) {
                context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, null);
            }
            updateStatusBar('error');
        }
    }, 1000); // 1 second delay to ensure full activation
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
                <h2>Login to Devek</h2>
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
                                message: 'Login attempt timed out'
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
            <iframe src="${URLS.APP}?token=${authToken}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
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
        'View App': 'Open Devek application',
        'View Status': authToken ? 'Connected' : 'Disconnected',
        'Logout': 'Sign out from Devek',
        'Reconnect': 'Try reconnecting to server',
        'Learn More': 'Visit Devek documentation'
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
        vscode.window.showInformationMessage('Not connected to Devek', 'Login').then(selection => {
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
        'Please login to use Devek',
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
    // Clean up existing connection
    if (ws) {
        console.log('Cleaning up existing WebSocket connection');
        clearInterval(pingInterval);
        ws.removeAllListeners(); // Remove all event listeners to prevent memory leaks
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
        ws = null;
    }

    // Log environment details for debugging
    console.log('WebSocket connection attempt details:', {
        environment: vscode.env.appName,
        version: vscode.version,
        target: URLS.WEBSOCKET,
        userAgent: (global as any).navigator?.userAgent || 'N/A',
        platform: process.platform,
        nodeVersion: process.version,
        hasAuthToken: !!authToken,
        hasLoginData: !!loginData
    });

    let connectionTimeout: NodeJS.Timeout;
    let isConnectionClosed = false;

    try {
        console.log(`Attempting WebSocket connection from ${vscode.env.appName} to ${URLS.WEBSOCKET}`);
        updateStatusBar('connecting');
        
        // Create WebSocket with enhanced error handling
        ws = new WebSocket(URLS.WEBSOCKET, {
            handshakeTimeout: 15000, // 15 second handshake timeout
            perMessageDeflate: false, // Disable compression for compatibility
        });
        
        // Set a connection timeout for Windsurf compatibility
        connectionTimeout = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.CONNECTING && !isConnectionClosed) {
                console.warn('WebSocket connection timeout - closing connection');
                isConnectionClosed = true;
                ws.close();
                updateStatusBar('error');
                if (loginCallback) {
                    loginCallback(false);
                }
                // Show user-friendly error message
                vscode.window.showWarningMessage(
                    'Devek: Connection timeout. Please check your internet connection and try again.',
                    'Retry'
                ).then(selection => {
                    if (selection === 'Retry') {
                        setTimeout(() => connectToWebSocket(context, loginData, loginCallback), 2000);
                    }
                });
            }
        }, 15000); // 15 second timeout
        
    } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        updateStatusBar('error');
        if (loginCallback) {
            loginCallback(false);
        }
        
        // Show user-friendly error message
        vscode.window.showErrorMessage(
            `Devek: Failed to establish connection. ${error instanceof Error ? error.message : 'Unknown error'}`,
            'Retry'
        ).then(selection => {
            if (selection === 'Retry') {
                setTimeout(() => connectToWebSocket(context, loginData, loginCallback), 3000);
            }
        });
        return;
    }

    ws.on('open', () => {
        console.log('Connected to WebSocket server');
        clearTimeout(connectionTimeout); // Clear the connection timeout
        isConnectionClosed = false;
        reconnectAttempts = 0;
        // Don't set status to 'connected' yet - wait for successful authentication
        updateStatusBar('connecting'); // Keep showing connecting until auth succeeds
        
        try {
            if (authToken) {
                console.log('Sending auth token to server');
                ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
            } else if (loginData) {
                console.log('Sending login data to server');
                ws?.send(JSON.stringify(loginData));
            }

            // Start ping interval with error handling
            pingInterval = setInterval(() => {
                if (ws?.readyState === WebSocket.OPEN && !isConnectionClosed) {
                    try {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    } catch (error) {
                        console.error('Failed to send ping:', error);
                        clearInterval(pingInterval);
                    }
                } else {
                    clearInterval(pingInterval);
                }
            }, WEBSOCKET_CONFIG.PING_INTERVAL);
        } catch (error) {
            console.error('Error in WebSocket open handler:', error);
            updateStatusBar('error');
            if (loginCallback) {
                loginCallback(false);
            }
        }
    });

    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data.toString());
            switch (response.type) {
                case 'init':
                    console.log('Received init message from server');
                    // Only set connected if we have a valid auth token
                    if (authToken) {
                        updateStatusBar('connected');
                        console.log('Authenticated and connected successfully');
                    } else {
                        updateStatusBar('disconnected');
                        console.log('Connected but not authenticated');
                    }
                    if (loginCallback) {
                        loginCallback(!!authToken);
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
                    view!.html = getAppHtml();
                    ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
                    break;
                default:
                    if (response.status === 'success') {
                        console.log('Authentication successful');
                        updateStatusBar('connected'); // Only set connected after successful auth
                        if (response.token) {
                            authToken = response.token;
                            context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, authToken);
                            ws?.send(JSON.stringify({ type: 'auth', token: authToken }));
                        }
                        if (loginCallback) {
                            loginCallback(true);
                        }
                    } else if (response.status === 'error') {
                        console.error('Server error:', response.message);
                        updateStatusBar('error');
                        
                        // Handle different types of authentication errors
                        if (response.message?.includes('Invalid token') || response.message?.includes('Authentication failed')) {
                            console.log('Token is invalid, clearing stored token');
                            authToken = null;
                            context.globalState.update(STORAGE_KEYS.AUTH_TOKEN, null);
                            updateStatusBar('disconnected');
                            
                            if (loginCallback) {
                                loginCallback(false);
                            }
                            
                            // Use existing login prompt function
                            showLoginPrompt();
                        } else {
                            // Other server errors
                            if (loginCallback) {
                                loginCallback(false);
                            }
                            vscode.window.showErrorMessage(`Devek: Server error - ${response.message}`);
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
        console.error('Error details:', {
            message: error.message,
            code: (error as any).code,
            type: (error as any).type,
            target: (error as any).target?.url,
            readyState: ws?.readyState,
            environment: vscode.env.appName,
            isConnectionClosed
        });
        
        clearTimeout(connectionTimeout);
        clearInterval(pingInterval);
        isConnectionClosed = true;
        updateStatusBar('error');
        
        // Handle specific error types
        const errorMessage = error.message || 'Unknown error';
        
        if (errorMessage.includes('closed before the connection was established')) {
            console.warn('WebSocket closed prematurely - this may be a Windsurf-specific network restriction');
            // Don't show popup immediately, wait to see if it's a transient issue
            setTimeout(() => {
                if (isConnectionClosed && ws?.readyState !== WebSocket.OPEN) {
                    vscode.window.showWarningMessage(
                        'Devek: Connection failed. This may be due to network restrictions.',
                        'Retry',
                        'Learn More'
                    ).then(selection => {
                        if (selection === 'Retry') {
                            setTimeout(() => connectToWebSocket(context, loginData, loginCallback), 2000);
                        } else if (selection === 'Learn More') {
                            vscode.env.openExternal(vscode.Uri.parse('https://devek.ai/docs/troubleshooting'));
                        }
                    });
                }
            }, 3000);
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
            console.warn('Connection refused or DNS resolution failed');
            vscode.window.showErrorMessage(
                'Devek: Unable to connect to server. Please check your internet connection.',
                'Retry'
            ).then(selection => {
                if (selection === 'Retry') {
                    setTimeout(() => connectToWebSocket(context, loginData, loginCallback), 5000);
                }
            });
        } else {
            console.warn('Generic WebSocket error occurred');
        }
        
        if (loginCallback) {
            loginCallback(false);
        }
        
        // Only attempt automatic reconnection for certain error types
        if (!errorMessage.includes('closed before the connection was established') && 
            !errorMessage.includes('ECONNREFUSED') && 
            reconnectAttempts < 3) {
            console.log('Attempting automatic reconnection...');
            handleReconnection(context);
        }
    });

    ws.on('close', (code, reason) => {
        console.log('Disconnected from WebSocket server', { code, reason: reason?.toString() });
        clearTimeout(connectionTimeout);
        clearInterval(pingInterval);
        isConnectionClosed = true;
        
        // Handle different close codes
        if (code === 1000) {
            // Normal closure
            console.log('WebSocket closed normally');
            updateStatusBar('disconnected');
        } else if (code === 1006) {
            // Abnormal closure (connection lost)
            console.log('WebSocket connection lost abnormally');
            if (authToken && reconnectAttempts < 3) {
                updateStatusBar('error');
                handleReconnection(context);
            } else {
                updateStatusBar('disconnected');
            }
        } else {
            // Other closure codes
            console.log(`WebSocket closed with code: ${code}`);
            if (authToken) {
                updateStatusBar('error');
                if (reconnectAttempts < 3) {
                    handleReconnection(context);
                }
            } else {
                updateStatusBar('disconnected');
            }
        }
        
        if (loginCallback) {
            loginCallback(false);
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
            'Failed to connect to Devek. Would you like to try again?',
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
        vscode.window.showErrorMessage('Failed to open Devek view');
    }
}

export function deactivate() {
    console.log('Deactivating Devek extension...');
    
    try {
        // Clean up WebSocket connection with comprehensive cleanup
        if (ws) {
            console.log('Cleaning up WebSocket connection...');
            clearInterval(pingInterval);
            
            // Remove all event listeners to prevent memory leaks
            ws.removeAllListeners();
            
            // Close connection if still open
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(1000, 'Extension deactivating');
            }
            
            ws = null;
            console.log('WebSocket connection cleaned up');
        }
        
        // Clean up status bar
        if (statusBarItem) {
            statusBarItem.dispose();
            console.log('Status bar item disposed');
        }
        
        // Clean up view provider reference
        if (viewProvider) {
            viewProvider = null;
            console.log('View provider reference cleared');
        }
        
        // Clean up view reference
        if (view) {
            view = null;
            console.log('View reference cleared');
        }
        
        // Reset all state variables
        authToken = null;
        reconnectAttempts = 0;
        pingInterval = null;
        
        console.log('All extension state reset');
        
    } catch (error) {
        console.error('Error during extension deactivation:', error);
    }
    
    console.log('Devek extension deactivated successfully');
}