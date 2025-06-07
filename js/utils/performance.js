// Performance monitoring and optimization utilities
export class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.observers = [];
        this.isSupported = this.checkSupport();
        
        if (this.isSupported) {
            this.init();
        }
    }

    checkSupport() {
        return 'performance' in window && 
               'PerformanceObserver' in window && 
               'IntersectionObserver' in window;
    }

    init() {
        this.setupPerformanceObservers();
        this.setupMemoryMonitoring();
        this.setupNetworkMonitoring();
    }

    setupPerformanceObservers() {
        try {
            // Monitor navigation timing
            if (performance.getEntriesByType('navigation').length > 0) {
                const navigation = performance.getEntriesByType('navigation')[0];
                this.logMetric('page_load_time', navigation.loadEventEnd - navigation.fetchStart);
                this.logMetric('dom_content_loaded', navigation.domContentLoadedEventEnd - navigation.fetchStart);
                this.logMetric('first_byte', navigation.responseStart - navigation.fetchStart);
            }

            // Monitor resource loading
            const resourceObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    if (entry.name.includes('.js') || entry.name.includes('.css')) {
                        this.logMetric('resource_load_time', entry.duration, {
                            resource: entry.name.split('/').pop(),
                            type: entry.name.includes('.js') ? 'script' : 'style'
                        });
                    }
                });
            });
            resourceObserver.observe({ entryTypes: ['resource'] });
            this.observers.push(resourceObserver);

            // Monitor long tasks
            const longTaskObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    console.warn('Long task detected:', entry.duration + 'ms');
                    this.logMetric('long_task', entry.duration);
                });
            });
            longTaskObserver.observe({ entryTypes: ['longtask'] });
            this.observers.push(longTaskObserver);

        } catch (error) {
            console.warn('Performance monitoring setup failed:', error);
        }
    }

    setupMemoryMonitoring() {
        if ('memory' in performance) {
            const logMemory = () => {
                const memory = performance.memory;
                this.logMetric('memory_used', memory.usedJSHeapSize);
                this.logMetric('memory_total', memory.totalJSHeapSize);
                this.logMetric('memory_limit', memory.jsHeapSizeLimit);
            };

            // Log memory usage every 30 seconds
            setInterval(logMemory, 30000);
            
            // Log initial memory
            logMemory();
        }
    }

    setupNetworkMonitoring() {
        if ('connection' in navigator) {
            const connection = navigator.connection;
            this.logMetric('network_type', connection.effectiveType);
            this.logMetric('network_downlink', connection.downlink);
            
            connection.addEventListener('change', () => {
                this.logMetric('network_change', connection.effectiveType);
            });
        }
    }

    logMetric(name, value, metadata = {}) {
        const timestamp = Date.now();
        const metric = {
            name,
            value,
            timestamp,
            metadata
        };

        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }
        
        this.metrics.get(name).push(metric);
        
        // Keep only last 100 entries per metric
        const entries = this.metrics.get(name);
        if (entries.length > 100) {
            entries.splice(0, entries.length - 100);
        }

        console.debug(`📊 Metric: ${name} = ${value}`, metadata);
    }

    getMetrics(name = null) {
        if (name) {
            return this.metrics.get(name) || [];
        }
        return Object.fromEntries(this.metrics);
    }

    getAverageMetric(name) {
        const entries = this.metrics.get(name);
        if (!entries || entries.length === 0) return null;
        
        const sum = entries.reduce((acc, entry) => acc + entry.value, 0);
        return sum / entries.length;
    }

    measureFunction(name, fn) {
        return async (...args) => {
            const start = performance.now();
            try {
                const result = await fn(...args);
                const duration = performance.now() - start;
                this.logMetric(`function_${name}`, duration);
                return result;
            } catch (error) {
                const duration = performance.now() - start;
                this.logMetric(`function_${name}_error`, duration);
                throw error;
            }
        };
    }

    startTiming(name) {
        const startTime = performance.now();
        return {
            end: () => {
                const duration = performance.now() - startTime;
                this.logMetric(name, duration);
                return duration;
            }
        };
    }

    reportPerformance() {
        const report = {
            timestamp: new Date().toISOString(),
            metrics: this.getMetrics(),
            averages: {}
        };

        // Calculate averages for numeric metrics
        for (const [name, entries] of this.metrics) {
            if (entries.length > 0 && typeof entries[0].value === 'number') {
                report.averages[name] = this.getAverageMetric(name);
            }
        }

        console.log('📈 Performance Report:', report);
        return report;
    }

    cleanup() {
        this.observers.forEach(observer => observer.disconnect());
        this.observers = [];
        this.metrics.clear();
    }
}

// Image lazy loading utility
export class LazyLoader {
    constructor() {
        this.imageObserver = null;
        this.init();
    }

    init() {
        if ('IntersectionObserver' in window) {
            this.imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.loadImage(entry.target);
                        this.imageObserver.unobserve(entry.target);
                    }
                });
            }, {
                rootMargin: '50px'
            });
        }

        this.setupLazyImages();
    }

    setupLazyImages() {
        const lazyImages = document.querySelectorAll('img[data-src]');
        
        if (this.imageObserver) {
            lazyImages.forEach(img => this.imageObserver.observe(img));
        } else {
            // Fallback for browsers without IntersectionObserver
            lazyImages.forEach(img => this.loadImage(img));
        }
    }

    loadImage(img) {
        if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            img.classList.add('loaded');
        }
    }
}

// Cache management for API responses
export class CacheManager {
    constructor() {
        this.cache = new Map();
        this.maxSize = 50; // Maximum number of cached items
        this.defaultTTL = 5 * 60 * 1000; // 5 minutes
    }

    set(key, data, ttl = this.defaultTTL) {
        // Remove oldest items if cache is full
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        // Check if item has expired
        if (Date.now() - item.timestamp > item.ttl) {
            this.cache.delete(key);
            return null;
        }

        return item.data;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }

    // Clean up expired items
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache) {
            if (now - item.timestamp > item.ttl) {
                this.cache.delete(key);
            }
        }
    }
}

// Request deduplication
export class RequestDeduplicator {
    constructor() {
        this.pendingRequests = new Map();
    }

    async request(key, requestFn) {
        // If request is already pending, return the existing promise
        if (this.pendingRequests.has(key)) {
            return this.pendingRequests.get(key);
        }

        // Create new request
        const promise = requestFn().finally(() => {
            // Clean up when request completes
            this.pendingRequests.delete(key);
        });

        this.pendingRequests.set(key, promise);
        return promise;
    }

    cancel(key) {
        this.pendingRequests.delete(key);
    }

    clear() {
        this.pendingRequests.clear();
    }
}

// Create singleton instances
export const performanceMonitor = new PerformanceMonitor();
export const lazyLoader = new LazyLoader();
export const cacheManager = new CacheManager();
export const requestDeduplicator = new RequestDeduplicator();

// Cleanup expired cache items every 5 minutes
setInterval(() => {
    cacheManager.cleanup();
}, 5 * 60 * 1000);