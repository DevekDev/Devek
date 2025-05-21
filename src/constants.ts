import { SocketAddress } from 'net';
import { StatusBarStatesConfig } from './types';

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
        LOGIN: 'Devek Login',
        APP: 'Devek'
    }
};

/**
 * WebSocket Configuration
 */
export const WEBSOCKET_CONFIG = {
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_INTERVAL: 5000, // in milliseconds
    PING_INTERVAL: 30000, // in milliseconds
    TIMEOUT: 300000, // timeout for connection attempts in milliseconds
};

/**
 * Application URLs
 */
export const URLS = {
    APP: 'https://app.devek.ai',
    WEBSOCKET: process.env.DEVEK_WS_URL || 'wss://ws.devek.ai',
    DOCS: 'https://devek.ai'
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
            text: '$(check) Devek',
            tooltip: 'Connected to Devek - Click to view options',
            command: 'devek.showMenu'
        },
        CONNECTING: {
            text: '$(loading~spin) Devek',
            tooltip: 'Connecting to Devek...',
            command: undefined
        },
        DISCONNECTED: {
            text: '$(plug) Devek',
            tooltip: 'Click to login to Devek',
            command: 'devek.login'
        },
        ERROR: {
            text: '$(error) Devek',
            tooltip: 'Connection error - Click to retry',
            command: 'devek.reconnect'
        },
        INITIALIZING: {
            text: '$(loading~spin) Devek',
            tooltip: 'Initializing Devek...',
            command: undefined
        }
    } as StatusBarStatesConfig
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