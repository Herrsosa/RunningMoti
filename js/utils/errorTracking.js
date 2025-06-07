// Error tracking and reporting utilities
export class ErrorTracker {
    constructor() {
        this.errors = [];
        this.maxErrors = 100;
        this.reportingEndpoint = null; // Could be set to send errors to external service
        this.sessionId = this.generateSessionId();
        
        this.init();
    }

    init() {
        this.setupGlobalErrorHandlers();
        this.setupNetworkErrorTracking();
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    setupGlobalErrorHandlers() {
        // JavaScript runtime errors
        window.addEventListener('error', (event) => {
            this.logError({
                type: 'javascript',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                timestamp: Date.now()
            });
        });

        // Unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.logError({
                type: 'promise_rejection',
                message: event.reason?.message || String(event.reason),
                stack: event.reason?.stack,
                timestamp: Date.now()
            });
        });

        // Resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                this.logError({
                    type: 'resource',
                    message: `Failed to load resource: ${event.target.src || event.target.href}`,
                    element: event.target.tagName,
                    source: event.target.src || event.target.href,
                    timestamp: Date.now()
                });
            }
        }, true);
    }

    setupNetworkErrorTracking() {
        // Track fetch failures
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            try {
                const response = await originalFetch(...args);
                
                // Log HTTP errors
                if (!response.ok) {
                    this.logError({
                        type: 'network',
                        message: `HTTP ${response.status}: ${response.statusText}`,
                        url: args[0],
                        status: response.status,
                        timestamp: Date.now()
                    });
                }
                
                return response;
            } catch (error) {
                this.logError({
                    type: 'network',
                    message: `Network error: ${error.message}`,
                    url: args[0],
                    error: error.name,
                    timestamp: Date.now()
                });
                throw error;
            }
        };
    }

    logError(errorInfo) {
        const enrichedError = {
            ...errorInfo,
            id: this.generateErrorId(),
            sessionId: this.sessionId,
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: errorInfo.timestamp || Date.now(),
            context: this.getErrorContext()
        };

        this.errors.push(enrichedError);

        // Keep only the most recent errors
        if (this.errors.length > this.maxErrors) {
            this.errors.splice(0, this.errors.length - this.maxErrors);
        }

        // Log to console for development
        console.error('🚨 Error tracked:', enrichedError);

        // Report to external service if configured
        if (this.reportingEndpoint) {
            this.reportError(enrichedError);
        }

        // Trigger error event for application
        window.dispatchEvent(new CustomEvent('app:error', {
            detail: enrichedError
        }));
    }

    generateErrorId() {
        return 'error_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getErrorContext() {
        return {
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth
            },
            connection: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink
            } : null,
            memory: performance.memory ? {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize
            } : null,
            online: navigator.onLine,
            cookieEnabled: navigator.cookieEnabled,
            localStorage: this.testLocalStorage(),
            currentTab: document.querySelector('.nav-link.active')?.getAttribute('href')
        };
    }

    testLocalStorage() {
        try {
            const test = 'test';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    async reportError(errorInfo) {
        if (!this.reportingEndpoint) return;

        try {
            await fetch(this.reportingEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(errorInfo)
            });
        } catch (error) {
            console.warn('Failed to report error to external service:', error);
        }
    }

    getErrors(type = null) {
        if (type) {
            return this.errors.filter(error => error.type === type);
        }
        return [...this.errors];
    }

    getErrorStats() {
        const stats = {
            total: this.errors.length,
            byType: {},
            recent: this.errors.filter(error => 
                Date.now() - error.timestamp < 60000 // Last minute
            ).length
        };

        this.errors.forEach(error => {
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
        });

        return stats;
    }

    clearErrors() {
        this.errors = [];
    }

    // Manual error logging for application use
    trackError(message, context = {}) {
        this.logError({
            type: 'manual',
            message,
            context,
            timestamp: Date.now()
        });
    }

    // Track user actions for debugging context
    trackUserAction(action, data = {}) {
        // Store recent user actions for error context
        if (!this.userActions) {
            this.userActions = [];
        }

        this.userActions.push({
            action,
            data,
            timestamp: Date.now()
        });

        // Keep only last 10 actions
        if (this.userActions.length > 10) {
            this.userActions.splice(0, this.userActions.length - 10);
        }
    }

    getUserActions() {
        return this.userActions || [];
    }

    // Generate error report for debugging
    generateReport() {
        return {
            sessionId: this.sessionId,
            timestamp: new Date().toISOString(),
            errors: this.getErrors(),
            stats: this.getErrorStats(),
            userActions: this.getUserActions(),
            context: this.getErrorContext()
        };
    }
}

// Performance issue detector
export class PerformanceIssueDetector {
    constructor() {
        this.slowOperations = [];
        this.memoryLeaks = [];
        this.thresholds = {
            slowOperation: 1000, // 1 second
            memoryLeak: 50 * 1024 * 1024, // 50MB
            longTask: 50 // 50ms
        };
        
        this.init();
    }

    init() {
        this.setupLongTaskDetection();
        this.setupMemoryLeakDetection();
    }

    setupLongTaskDetection() {
        if ('PerformanceObserver' in window) {
            try {
                const observer = new PerformanceObserver((list) => {
                    list.getEntries().forEach(entry => {
                        if (entry.duration > this.thresholds.longTask) {
                            this.logPerformanceIssue({
                                type: 'long_task',
                                duration: entry.duration,
                                startTime: entry.startTime,
                                timestamp: Date.now()
                            });
                        }
                    });
                });
                
                observer.observe({ entryTypes: ['longtask'] });
            } catch (error) {
                console.warn('Long task detection setup failed:', error);
            }
        }
    }

    setupMemoryLeakDetection() {
        if (performance.memory) {
            let lastMemoryCheck = performance.memory.usedJSHeapSize;
            
            setInterval(() => {
                const currentMemory = performance.memory.usedJSHeapSize;
                const memoryIncrease = currentMemory - lastMemoryCheck;
                
                if (memoryIncrease > this.thresholds.memoryLeak) {
                    this.logPerformanceIssue({
                        type: 'memory_increase',
                        increase: memoryIncrease,
                        current: currentMemory,
                        total: performance.memory.totalJSHeapSize,
                        timestamp: Date.now()
                    });
                }
                
                lastMemoryCheck = currentMemory;
            }, 30000); // Check every 30 seconds
        }
    }

    logPerformanceIssue(issue) {
        console.warn('⚡ Performance issue detected:', issue);
        
        if (issue.type === 'long_task') {
            this.slowOperations.push(issue);
        } else if (issue.type === 'memory_increase') {
            this.memoryLeaks.push(issue);
        }

        // Keep only recent issues
        const maxIssues = 20;
        if (this.slowOperations.length > maxIssues) {
            this.slowOperations.splice(0, this.slowOperations.length - maxIssues);
        }
        if (this.memoryLeaks.length > maxIssues) {
            this.memoryLeaks.splice(0, this.memoryLeaks.length - maxIssues);
        }

        // Dispatch event for application handling
        window.dispatchEvent(new CustomEvent('app:performance_issue', {
            detail: issue
        }));
    }

    getIssues() {
        return {
            slowOperations: [...this.slowOperations],
            memoryLeaks: [...this.memoryLeaks]
        };
    }
}

// Create singleton instances
export const errorTracker = new ErrorTracker();
export const performanceIssueDetector = new PerformanceIssueDetector();

// Export main error tracking function for easy use
export function trackError(message, context = {}) {
    errorTracker.trackError(message, context);
}

export function trackUserAction(action, data = {}) {
    errorTracker.trackUserAction(action, data);
}