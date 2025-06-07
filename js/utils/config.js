// Configuration and constants
const Config = {
    API_BASE_URL: '/api',
    CREDITS_PER_SONG: 1,
    POLLING_INTERVAL: 10000, // 10 seconds
    MAX_POLLS: 60, // Maximum polls for lyrics generation
    
    // UI Constants
    DEBOUNCE_DELAY: 300,
    TOAST_DURATION: 5000,
    
    // Validation
    MAX_WORKOUT_LENGTH: 500,
    MAX_STYLE_LENGTH: 200,
    MAX_NAME_LENGTH: 100,
    
    // Local storage keys
    STORAGE_KEYS: {
        AUTH_TOKEN: 'authToken',
        USER_CACHE: 'userCache',
        FORM_CACHE: 'formCache'
    }
};

// Utility functions
const Utils = {
    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Simple validation
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    validatePassword(password) {
        return password.length >= 8 && 
               /[A-Z]/.test(password) && 
               /[a-z]/.test(password) && 
               /\d/.test(password) && 
               /[!@#$%^&*(),.?":{}|<>]/.test(password);
    },

    // Sanitize input
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        return input.trim().replace(/[<>]/g, '');
    },

    // Format error messages
    formatError(error) {
        if (typeof error === 'string') return error;
        if (error.error) return error.error;
        if (error.message) return error.message;
        return 'An unexpected error occurred';
    },

    // Status to percentage mapping
    statusToPercent(status) {
        const statusMap = {
            'lyrics_pending': 0,
            'lyrics_processing': 30,
            'lyrics_complete': 60,
            'audio_pending': 70,
            'audio_processing': 90,
            'complete': 100,
            'error': 0
        };
        return statusMap[status] || 0;
    },

    // Cache management
    setCache(key, data, expiryMinutes = 60) {
        const item = {
            data: data,
            timestamp: Date.now(),
            expiry: Date.now() + (expiryMinutes * 60 * 1000)
        };
        localStorage.setItem(key, JSON.stringify(item));
    },

    getCache(key) {
        try {
            const item = JSON.parse(localStorage.getItem(key));
            if (!item) return null;
            
            if (Date.now() > item.expiry) {
                localStorage.removeItem(key);
                return null;
            }
            
            return item.data;
        } catch {
            return null;
        }
    },

    clearCache(key) {
        localStorage.removeItem(key);
    },

    // Form data helpers
    serializeForm(form) {
        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
            data[key] = this.sanitizeInput(value);
        }
        return data;
    }
};

export { Config, Utils };