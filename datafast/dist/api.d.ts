export declare function buildParams(params: Record<string, string | number | boolean | undefined>): string;
export declare function getOverview(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    fields?: string;
}): Promise<object[]>;
export declare function getTimeseries(apiKey: string, params: {
    fields?: string;
    interval?: string;
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    filter_country?: string;
    filter_device?: string;
    filter_referrer?: string;
    filter_page?: string;
    filter_utm_source?: string;
    filter_utm_medium?: string;
    filter_utm_campaign?: string;
    filter_utm_content?: string;
    filter_utm_term?: string;
    filter_browser?: string;
    filter_os?: string;
    filter_hostname?: string;
}): Promise<object>;
export declare function getRealtime(apiKey: string): Promise<object[]>;
export declare function getRealtimeMap(apiKey: string): Promise<object>;
export declare function getMetadata(apiKey: string): Promise<object[]>;
export declare function getPages(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    filter_country?: string;
    filter_device?: string;
    filter_referrer?: string;
}): Promise<object>;
export declare function getReferrers(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    filter_country?: string;
    filter_device?: string;
    filter_page?: string;
}): Promise<object>;
export declare function getCampaigns(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    fields?: string;
}): Promise<object>;
export declare function getGoals(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    fields?: string;
}): Promise<object>;
export declare function getCountries(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    filter_device?: string;
    filter_referrer?: string;
    filter_page?: string;
}): Promise<object>;
export declare function getRegions(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
}): Promise<object>;
export declare function getCities(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
}): Promise<object>;
export declare function getDevices(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
    filter_country?: string;
    filter_referrer?: string;
    filter_page?: string;
}): Promise<object>;
export declare function getBrowsers(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
}): Promise<object>;
export declare function getOperatingSystems(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
}): Promise<object>;
export declare function getHostnames(apiKey: string, params: {
    startAt?: string;
    endAt?: string;
    timezone?: string;
    limit?: number;
    offset?: number;
}): Promise<object>;
export declare function getVisitor(apiKey: string, visitorId: string): Promise<object>;
export declare function trackGoal(apiKey: string, payload: {
    datafast_visitor_id: string;
    name: string;
    metadata?: Record<string, string>;
}): Promise<object>;
export declare function deleteGoals(apiKey: string, params: {
    datafast_visitor_id?: string;
    name?: string;
    startAt?: string;
    endAt?: string;
}): Promise<object>;
export declare function trackPayment(apiKey: string, payload: {
    amount: number;
    currency: string;
    transaction_id: string;
    datafast_visitor_id?: string;
    email?: string;
    name?: string;
    customer_id?: string;
    renewal?: boolean;
    refunded?: boolean;
    timestamp?: string;
}): Promise<object>;
export declare function deletePayments(apiKey: string, params: {
    transaction_id?: string;
    datafast_visitor_id?: string;
    startAt?: string;
    endAt?: string;
}): Promise<object>;
