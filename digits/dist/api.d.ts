export declare const getCompany: (token: string) => Promise<object>;
export declare const getCategories: (token: string) => Promise<object>;
export declare const getParties: (token: string) => Promise<object>;
export declare const getSources: (token: string) => Promise<object>;
export declare const getProfitAndLoss: (token: string, params: {
    startDate?: string;
    endDate?: string;
    interval?: "Month" | "Quarter" | "Year";
    fiscalYearStartMonth?: string;
}) => Promise<object>;
export declare const getBalanceSheet: (token: string, params: {
    startDate?: string;
    endDate?: string;
    interval?: "Month" | "Quarter" | "Year";
    fiscalYearStartMonth?: string;
}) => Promise<object>;
export declare const getCashFlow: (token: string, params: {
    startDate?: string;
    endDate?: string;
    interval?: "Month" | "Quarter" | "Year";
    fiscalYearStartMonth?: string;
}) => Promise<object>;
export declare const listEntries: (token: string, params?: {
    limit?: string;
    cursor?: string;
}) => Promise<object>;
export declare const queryEntries: (token: string, filters: {
    occurredAfter?: string;
    occurredBefore?: string;
    minimumAmount?: number;
    maximumAmount?: number;
    filterTerm?: string;
    fieldSearchTerm?: {
        field: string;
        term: string;
    };
    partyIds?: string[];
    categoryIds?: string[];
    categoryTypes?: string[];
    departmentIds?: string[];
    locationIds?: string[];
    type?: "Credit" | "Debit";
    linkedObjectType?: "Bill" | "Invoice";
    limit?: number;
    cursor?: string;
}) => Promise<object>;
export declare const getTransaction: (token: string, transactionId: string) => Promise<object>;
