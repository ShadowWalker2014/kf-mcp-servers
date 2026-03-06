export interface TokenSet {
    access_token: string;
    refresh_token: string;
    expires_at: number;
}
export declare function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string>;
export declare function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
}>;
