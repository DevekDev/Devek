/**
 * VSCode WebView Settings
 */
export const WEBVIEW_SETTINGS = {
    COLUMN_WIDTH: 450, // Width in pixels
    IDENTIFIERS: {
        LOGIN: 'devekLogin',
        APP: 'devekApp',
        VIEW_CONTAINER: 'devekViewContainer'
    },
    TITLES: {
        LOGIN: 'Devek.dev Login',
        APP: 'Devek.dev'
    }
};

/**
 * WebSocket Configuration
 */
export const WEBSOCKET_CONFIG = {
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_INTERVAL: 5000, // in milliseconds
    PING_INTERVAL: 30000, // in milliseconds
    TIMEOUT: 10000, // timeout for connection attempts in milliseconds
};

/**
 * Application URLs
 */
export const URLS = {
    APP: 'https://app.devek.dev',
    WEBSOCKET: process.env.DEVEK_WS_URL || 'wss://ws.devek.dev',
    DOCS: 'https://devek.dev'
};

/**
 * Storage Keys
 */
export const STORAGE_KEYS = {
    AUTH_TOKEN: 'devekAuthToken'
};

/**
 * Status Bar Configuration
 */
export const STATUS_BAR_CONFIG = {
    ALIGNMENT_PRIORITY: 100,
    STATES: {
        CONNECTED: {
            text: '$(check) Devek.dev',
            tooltip: 'Connected to Devek.dev - Click to view options',
            command: 'devek.showMenu'
        },
        CONNECTING: {
            text: '$(loading~spin) Devek.dev',
            tooltip: 'Connecting to Devek.dev...',
            command: undefined
        },
        DISCONNECTED: {
            text: '$(plug) Devek.dev',
            tooltip: 'Click to login to Devek.dev',
            command: 'devek.login'
        },
        ERROR: {
            text: '$(error) Devek.dev',
            tooltip: 'Connection error - Click to retry',
            command: 'devek.reconnect'
        },
        INITIALIZING: {
            text: '$(loading~spin) Devek.dev',
            tooltip: 'Initializing Devek.dev...',
            command: undefined
        }
    }
};

/**
 * Command IDs
 */
export const COMMANDS = {
    LOGIN: 'devek.login',
    LOGOUT: 'devek.logout',
    RECONNECT: 'devek.reconnect',
    SHOW_MENU: 'devek.showMenu',
    SHOW_APP: 'devek.showApp'
};