import { AuthManager } from './modules/auth.js';
import { SongGenerator } from './modules/generator.js';
import { LibraryManager } from './modules/library.js';
import { setupRealTimeValidation } from './utils/validation.js';
import { Config, Utils } from './utils/config.js';
import { performanceMonitor, lazyLoader } from './utils/performance.js';
import { errorTracker, performanceIssueDetector, trackUserAction } from './utils/errorTracking.js';

// Main Application Class
class App {
    constructor() {
        this.authManager = null;
        this.songGenerator = null;
        this.libraryManager = null;
        
        this.init();
    }

    async init() {
        try {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }

            console.log('🚀 Initializing Athletes Motivation App...');

            // Initialize modules
            this.authManager = new AuthManager();
            this.songGenerator = new SongGenerator(this.authManager);
            this.libraryManager = new LibraryManager(this.authManager);

            // Manually render example songs on startup
            this.libraryManager.renderExampleSongs();

            // Setup global event listeners
            this.setupGlobalEventListeners();

            // Setup form validation
            setupRealTimeValidation();

            // Setup error handling
            this.setupErrorHandling();

            // Setup performance monitoring
            this.setupPerformanceMonitoring();

            // Setup user action tracking
            this.setupUserActionTracking();

            // Check app health
            await this.performHealthCheck();

            console.log('✅ App initialized successfully');

        } catch (error) {
            console.error('❌ Failed to initialize app:', error);
            this.showCriticalError('Failed to initialize application. Please refresh the page.');
        }
    }

    setupGlobalEventListeners() {
        // Handle auth state changes
        window.addEventListener('auth:login', (e) => {
            console.log('User logged in:', e.detail?.user?.username);
            this.onUserLogin();
        });

        window.addEventListener('auth:logout', () => {
            console.log('User logged out');
            this.onUserLogout();
        });

        // Handle generation completion
        window.addEventListener('generator:complete', (e) => {
            console.log('Song generation completed:', e.detail?.songId);
            trackUserAction('song_generation_completed', { songId: e.detail?.songId });
            this.onGenerationComplete();
        });

        // Handle visibility change for auto-refresh
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.authManager?.isLoggedIn()) {
                // Refresh user data when page becomes visible
                this.authManager.fetchUserProfile();
            }
        });

        // Handle online/offline status
        window.addEventListener('online', () => {
            this.showToast('Connection restored', 'success');
        });

        window.addEventListener('offline', () => {
            this.showToast('You are offline. Some features may not work.', 'warning');
        });

        // Handle form caching
        this.setupFormCaching();
    }

    setupFormCaching() {
        const songForm = document.getElementById('songForm');
        if (!songForm) return;

        // Save form data on input
        const debouncedSave = Utils.debounce(() => {
            const formData = Utils.serializeForm(songForm);
            Utils.setCache(Config.STORAGE_KEYS.FORM_CACHE, formData, 60); // 1 hour
        }, 1000);

        songForm.addEventListener('input', debouncedSave);

        // Restore form data on load
        const cachedData = Utils.getCache(Config.STORAGE_KEYS.FORM_CACHE);
        if (cachedData) {
            this.restoreFormData(songForm, cachedData);
        }
    }

    restoreFormData(form, data) {
        Object.entries(data).forEach(([key, value]) => {
            const input = form.querySelector(`[name="${key}"]`);
            if (input && value) {
                if (input.type === 'radio' || input.type === 'checkbox') {
                    if (input.value === value) {
                        input.checked = true;
                    }
                } else {
                    input.value = value;
                }
            }
        });
    }

    setupErrorHandling() {
        // Listen for application errors
        window.addEventListener('app:error', (e) => {
            const error = e.detail;
            console.error('Application error:', error);
            
            // Show user-friendly error for critical issues
            if (error.type === 'network' && error.status >= 500) {
                this.showToast('Server error. Please try again later.', 'error');
            } else if (error.type === 'javascript' && !error.message.includes('Script error')) {
                this.showToast('An unexpected error occurred.', 'error');
            }
        });

        // Listen for performance issues
        window.addEventListener('app:performance_issue', (e) => {
            const issue = e.detail;
            console.warn('Performance issue:', issue);
            
            if (issue.type === 'long_task' && issue.duration > 3000) {
                this.showToast('The app is running slowly. Please wait...', 'warning');
            }
        });
    }

    setupPerformanceMonitoring() {
        // Log major user interactions
        document.addEventListener('click', (e) => {
            if (e.target.matches('button, .btn, a[href]')) {
                const element = e.target;
                performanceMonitor.logMetric('user_interaction', 1, {
                    element: element.tagName,
                    class: element.className,
                    id: element.id,
                    text: element.textContent?.slice(0, 50)
                });
            }
        });

        // Monitor form submissions
        document.addEventListener('submit', (e) => {
            const form = e.target;
            performanceMonitor.logMetric('form_submission', 1, {
                formId: form.id,
                action: form.action || 'none'
            });
        });

        // Report performance every 5 minutes
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                const report = performanceMonitor.reportPerformance();
                console.log('📊 Performance report generated');
            }
        }, 5 * 60 * 1000);
    }

    setupUserActionTracking() {
        // Track navigation
        document.addEventListener('click', (e) => {
            if (e.target.matches('.nav-link, .tab-link')) {
                trackUserAction('navigation', {
                    tab: e.target.getAttribute('href') || e.target.textContent,
                    timestamp: Date.now()
                });
            }
        });

        // Track form interactions
        document.addEventListener('submit', (e) => {
            trackUserAction('form_submit', {
                formId: e.target.id,
                formAction: e.target.action || 'none'
            });
        });

        // Track auth actions
        window.addEventListener('auth:login', () => {
            trackUserAction('login_success');
        });

        window.addEventListener('auth:logout', () => {
            trackUserAction('logout');
        });
    }

    async performHealthCheck() {
        try {
            // This is a simple client-side health check
            // You could expand this to check API connectivity
            const isOnline = navigator.onLine;
            const hasLocalStorage = this.testLocalStorage();
            
            if (!isOnline) {
                this.showToast('You appear to be offline', 'warning');
            }
            
            if (!hasLocalStorage) {
                this.showToast('Local storage not available. Some features may not work properly.', 'warning');
            }

            console.log('🏥 Health check completed', { isOnline, hasLocalStorage });
            
        } catch (error) {
            console.warn('Health check failed:', error);
        }
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

    onUserLogin() {
        // Clear form cache on login (user might want fresh start)
        Utils.clearCache(Config.STORAGE_KEYS.FORM_CACHE);
        
        // Show welcome message
        const user = this.authManager.getCurrentUser();
        this.showToast(`Welcome back, ${user.username}!`, 'success');
    }

    onUserLogout() {
        // Clear all caches
        Utils.clearCache(Config.STORAGE_KEYS.FORM_CACHE);
        Utils.clearCache(Config.STORAGE_KEYS.USER_CACHE);
        
        // Reset generator
        if (this.songGenerator) {
            this.songGenerator.reset();
        }
        
        this.showToast('You have been logged out', 'info');
    }

    onGenerationComplete() {
        // Switch to library tab to show the new song
        const libraryTabLink = document.querySelector('a[href="#libraryTab"]');
        if (libraryTabLink && window.bootstrap) {
            const tab = new bootstrap.Tab(libraryTabLink);
            tab.show();
        }
        
        // Clear form cache since generation was successful
        Utils.clearCache(Config.STORAGE_KEYS.FORM_CACHE);
    }

    showToast(message, type = 'info') {
        // Simple toast implementation
        // You could use a more sophisticated toast library
        console.log(`Toast [${type}]:`, message);
        
        // For now, just log it. You could implement a real toast system here
        if (type === 'error') {
            console.error(message);
        } else if (type === 'warning') {
            console.warn(message);
        } else {
            console.info(message);
        }
    }

    showCriticalError(message) {
        // Show critical error to user
        const errorContainer = document.createElement('div');
        errorContainer.className = 'alert alert-danger position-fixed top-0 start-50 translate-middle-x mt-3';
        errorContainer.style.zIndex = '9999';
        errorContainer.innerHTML = `
            <strong>Critical Error:</strong> ${message}
            <button type="button" class="btn-close" aria-label="Close"></button>
        `;
        
        document.body.appendChild(errorContainer);
        
        errorContainer.querySelector('.btn-close').addEventListener('click', () => {
            errorContainer.remove();
        });
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (errorContainer.parentNode) {
                errorContainer.remove();
            }
        }, 10000);
    }

    logError(type, error) {
        // Log error details for debugging
        const errorInfo = {
            type,
            message: error?.message || String(error),
            stack: error?.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        console.error('Error logged:', errorInfo);
        
        // You could send this to an error tracking service here
    }

    // Public methods for external access
    getAuthManager() {
        return this.authManager;
    }

    getSongGenerator() {
        return this.songGenerator;
    }

    getLibraryManager() {
        return this.libraryManager;
    }
}

// Initialize app when script loads
const app = new App();

// Make app available globally for debugging
window.athletesMotivationApp = app;

// Export for module systems
export default app;
