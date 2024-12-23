export type StatusBarState = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR' | 'INITIALIZING';

export type StatusBarStateConfig = {
    text: string;
    tooltip: string;
    command: string | undefined;
};

export type StatusBarStatesConfig = {
    [key in StatusBarState]: StatusBarStateConfig;
};