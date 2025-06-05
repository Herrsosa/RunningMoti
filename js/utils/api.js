import { Config, Utils } from './config.js';
import { performanceMonitor, cacheManager, requestDeduplicator } from './performance.js';
import { trackError } from './errorTracking.js';

// Enhanced API client with error handling and retry logic
class ApiClient {
    constructor() {
        this.baseUrl = Config.API_BASE_URL;
        this.retryAttempts = 3;
        this.retryDelay = 1000;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const cacheKey = `${options.method || 'GET'}_${endpoint}`;
        
        // Check cache for GET requests
        if ((options.method || 'GET') === 'GET' && options.cache !== false) {
            const cached = cacheManager.get(cacheKey);
            if (cached) {
                performanceMonitor.logMetric('api_cache_hit', 1, { endpoint });
                return cached;
            }
        }

        // Use request deduplication for identical requests
        const requestKey = `${options.method || 'GET'}_${endpoint}_${JSON.stringify(options.body || {})}`;
        
        return requestDeduplicator.request(requestKey, async () => {
            const timer = performanceMonitor.startTiming(`api_request_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`);
            
            try {
                const defaultOptions = {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                };

                // Add auth header if token exists
                const token = localStorage.getItem(Config.STORAGE_KEYS.AUTH_TOKEN);
                if (token && options.requiresAuth !== false) {
                    defaultOptions.headers['Authorization'] = `Bearer ${token}`;
                }

                const finalOptions = {
                    ...defaultOptions,
                    ...options,
                    headers: {
                        ...defaultOptions.headers,
                        ...options.headers
                    }
                };

                if (finalOptions.body && typeof finalOptions.body === 'object') {
                    finalOptions.body = JSON.stringify(finalOptions.body);
                }

                let lastError;
                
                for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
                    try {
                        const response = await fetch(url, finalOptions);
                        
                        // Log response time
                        const duration = timer.end();
                        performanceMonitor.logMetric('api_response_time', duration, { 
                            endpoint, 
                            status: response.status,
                            attempt 
                        });
                        
                        if (!response.ok) {
                            let errorData = { error: `Request failed with status: ${response.status}` };
                            
                            try {
                                errorData = await response.json();
                            } catch (e) {
                                console.warn('Could not parse error response JSON');
                            }

                            // Track API errors
                            trackError(`API Error: ${response.status}`, {
                                endpoint,
                                status: response.status,
                                method: finalOptions.method,
                                attempt,
                                errorData
                            });

                            // Handle authentication errors
                            if (response.status === 401 || response.status === 403) {
                                this.handleAuthError();
                                throw new Error('Your session has expired. Please login again.');
                            }

                            // Handle rate limiting
                            if (response.status === 429) {
                                throw new Error('Too many requests. Please wait a moment before trying again.');
                            }

                            throw errorData;
                        }

                        // Handle empty responses
                        if (response.status === 204) {
                            return null;
                        }

                        const result = await response.json();
                        
                        // Cache successful GET requests
                        if (finalOptions.method === 'GET' && options.cache !== false) {
                            const cacheTTL = options.cacheTTL || (endpoint.includes('profile') ? 60000 : 300000); // 1 min for profile, 5 min for others
                            cacheManager.set(cacheKey, result, cacheTTL);
                        }

                        performanceMonitor.logMetric('api_success', 1, { endpoint });
                        return result;

                    } catch (error) {
                        lastError = error;
                        
                        performanceMonitor.logMetric('api_error', 1, { 
                            endpoint, 
                            attempt,
                            error: error.message 
                        });

                        console.error(`API Request Failed (attempt ${attempt}/${this.retryAttempts}):`, error);

                        // Track retry attempts
                        if (attempt > 1) {
                            trackError(`API Retry ${attempt}`, {
                                endpoint,
                                error: error.message,
                                attempt
                            });
                        }

                        // Don't retry on client errors (4xx)
                        if (error.status && error.status >= 400 && error.status < 500) {
                            throw error;
                        }

                        // Wait before retrying (exponential backoff)
                        if (attempt < this.retryAttempts) {
                            await this.delay(this.retryDelay * Math.pow(2, attempt - 1));
                        }
                    }
                }

                throw lastError;
                
            } catch (error) {
                timer.end();
                throw error;
            }
        });
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    handleAuthError() {
        // Clear auth data
        localStorage.removeItem(Config.STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(Config.STORAGE_KEYS.USER_CACHE);
        
        // Dispatch custom event for UI to handle
        window.dispatchEvent(new CustomEvent('auth:logout'));
    }

    // Auth endpoints
    async login(email, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: { email, password },
            requiresAuth: false
        });
    }

    async register(username, email, password) {
        return this.request('/auth/register', {
            method: 'POST',
            body: { username, email, password },
            requiresAuth: false
        });
    }

    async requestPasswordReset(email) {
        return this.request('/auth/request-password-reset', {
            method: 'POST',
            body: { email },
            requiresAuth: false
        });
    }

    async resetPassword(token, password, confirmPassword) {
        return this.request('/auth/reset-password', {
            method: 'POST',
            body: { token, password, confirmPassword },
            requiresAuth: false
        });
    }

    // Generation endpoints
    async generateLyrics(songData) {
        return this.request('/generate/generate-lyrics', {
            method: 'POST',
            body: songData
        });
    }

    async generateAudio(songId) {
        return this.request('/generate/generate-audio', {
            method: 'POST',
            body: { songId }
        });
    }

    async getLyricsStatus(songId) {
        return this.request(`/generate/lyrics-status/${songId}`);
    }

    async getAudioStatus(songId) {
        return this.request(`/generate/audio-status/${songId}`);
    }

    // Library endpoints
    async getUserProfile() {
        return this.request('/library/profile');
    }

    async getSongs() {
        return this.request('/library/songs');
    }

    async deleteSong(songId) {
        return this.request(`/library/songs/${songId}`, {
            method: 'DELETE'
        });
    }

    // Health check
    async healthCheck() {
        return this.request('/health', { requiresAuth: false });
    }
}

// Create singleton instance
const api = new ApiClient();

export default api;