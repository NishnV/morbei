import React, { createContext, useContext, useState, useCallback } from 'react';

const LoadingContext = createContext({ loading: false, startLoading: () => {}, stopLoading: () => {} });

export const LoadingProvider = ({ children }) => {
    const [loading, setLoading] = useState(false);

    const startLoading = useCallback(() => setLoading(true), []);
    const stopLoading = useCallback(() => setLoading(false), []);

    return (
        <LoadingContext.Provider value={{ loading, startLoading, stopLoading }}>
            {children}
        </LoadingContext.Provider>
    );
};

export const useGlobalLoading = () => useContext(LoadingContext);
