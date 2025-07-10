import api from '../utils/api.js';
import { Config, Utils } from '../utils/config.js';
import { Validator } from '../utils/validation.js';

export class AuthManager {
    constructor() {
        this.currentUser = {
            token: localStorage.getItem(Config.STORAGE_KEYS.AUTH_TOKEN),
            id: null,
            username: null,
            credits: 0
        };
        
        this.loginModal = null;
        this.signupModal = null;
        this.modalsInitialized = false;
        
        this.init();
    }

    init() {
        // Wait for Bootstrap to be available before initializing modals
        this.waitForBootstrap().then(() => {
            this.setupModals();
            this.setupEventListeners();
            this.updateUIBasedOnLoginState();
        }).catch(error => {
            console.error('Failed to initialize Bootstrap modals:', error);
            // Fallback: setup event listeners without modals
            this.setupEventListenersWithoutModals();
            this.updateUIBasedOnLoginState();
        });
        
        // Listen for auth logout events
        window.addEventListener('auth:logout', () => {
            this.handleLogout();
        });
    }

    async waitForBootstrap(maxAttempts = 50, interval = 100) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            
            const checkBootstrap = () => {
                attempts++;
                
                if (window.bootstrap && window.bootstrap.Modal) {
                    console.log('✅ Bootstrap is available');
                    resolve();
                    return;
                }
                
                if (attempts >= maxAttempts) {
                    console.warn('⚠️ Bootstrap not available after waiting');
                    reject(new Error('Bootstrap not available'));
                    return;
                }
                
                setTimeout(checkBootstrap, interval);
            };
            
            checkBootstrap();
        });
    }

    setupModals() {
        try {
            const loginModalEl = document.getElementById('loginModal');
            const signupModalEl = document.getElementById('signupModal');
            
            if (loginModalEl && window.bootstrap) {
                this.loginModal = new window.bootstrap.Modal(loginModalEl);
                console.log('✅ Login modal initialized');
            } else {
                console.error('❌ Could not initialize login modal');
            }
            
            if (signupModalEl && window.bootstrap) {
                this.signupModal = new window.bootstrap.Modal(signupModalEl);
                console.log('✅ Signup modal initialized');
            } else {
                console.error('❌ Could not initialize signup modal');
            }
            
            this.modalsInitialized = true;
        } catch (error) {
            console.error('Error setting up modals:', error);
            this.modalsInitialized = false;
        }
    }

    setupEventListeners() {
        // Show login/signup buttons
        const showLoginBtn = document.getElementById('showLoginBtn');
        const showSignupBtn = document.getElementById('showSignupBtn');
        const logoutButton = document.getElementById('logoutButton');
        
        if (showLoginBtn) {
            showLoginBtn.addEventListener('click', () => {
                console.log('Login button clicked');
                if (this.loginModal) {
                    this.loginModal.show();
                } else {
                    console.error('Login modal not available, trying fallback');
                    this.showLoginFallback();
                }
            });
            console.log('✅ Login button event listener attached');
        } else {
            console.error('❌ Login button not found');
        }
        
        if (showSignupBtn) {
            showSignupBtn.addEventListener('click', () => {
                console.log('Signup button clicked');
                if (this.signupModal) {
                    this.signupModal.show();
                } else {
                    console.error('Signup modal not available, trying fallback');
                    this.showSignupFallback();
                }
            });
            console.log('✅ Signup button event listener attached');
        } else {
            console.error('❌ Signup button not found');
        }
        
        if (logoutButton) {
            logoutButton.addEventListener('click', () => this.handleLogout());
            console.log('✅ Logout button event listener attached');
        }

        // Form submissions
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
            console.log('✅ Login form event listener attached');
        }
        
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => this.handleSignup(e));
            console.log('✅ Signup form event listener attached');
            // Password requirements pop-up logic
            const signupPasswordInput = document.getElementById('signupPassword');
            const passwordPopup = document.getElementById('passwordRequirementsPopup');
            if (signupPasswordInput && passwordPopup) {
                signupPasswordInput.addEventListener('focus', function() {
                    // Position the popup below the input
                    const rect = signupPasswordInput.getBoundingClientRect();
                    passwordPopup.style.display = 'block';
                    passwordPopup.style.position = 'absolute';
                    passwordPopup.style.left = rect.left + window.scrollX + 'px';
                    passwordPopup.style.top = rect.bottom + window.scrollY + 4 + 'px';
                });
                signupPasswordInput.addEventListener('blur', function() {
                    passwordPopup.style.display = 'none';
                });
            }
        }
    }

    setupEventListenersWithoutModals() {
        // Fallback setup without modals
        const showLoginBtn = document.getElementById('showLoginBtn');
        const showSignupBtn = document.getElementById('showSignupBtn');
        const logoutButton = document.getElementById('logoutButton');
        
        if (showLoginBtn) {
            showLoginBtn.addEventListener('click', () => {
                this.showLoginFallback();
            });
        }
        
        if (showSignupBtn) {
            showSignupBtn.addEventListener('click', () => {
                this.showSignupFallback();
            });
        }
        
        if (logoutButton) {
            logoutButton.addEventListener('click', () => this.handleLogout());
        }

        // Form submissions
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
        
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => this.handleSignup(e));
        }
    }

    showLoginFallback() {
        // Fallback method to show login modal using vanilla JS
        const loginModalEl = document.getElementById('loginModal');
        if (loginModalEl) {
            loginModalEl.style.display = 'block';
            loginModalEl.classList.add('show');
            document.body.classList.add('modal-open');
            
            // Add backdrop
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade show';
            backdrop.id = 'login-backdrop';
            document.body.appendChild(backdrop);
            
            // Close on backdrop click
            backdrop.addEventListener('click', () => this.hideLoginFallback());
            
            // Close on X button click
            const closeBtn = loginModalEl.querySelector('.btn-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideLoginFallback());
            }
        }
    }

    hideLoginFallback() {
        const loginModalEl = document.getElementById('loginModal');
        const backdrop = document.getElementById('login-backdrop');
        
        if (loginModalEl) {
            loginModalEl.style.display = 'none';
            loginModalEl.classList.remove('show');
        }
        
        if (backdrop) {
            backdrop.remove();
        }
        
        document.body.classList.remove('modal-open');
    }

    showSignupFallback() {
        // Similar fallback for signup modal
        const signupModalEl = document.getElementById('signupModal');
        if (signupModalEl) {
            signupModalEl.style.display = 'block';
            signupModalEl.classList.add('show');
            document.body.classList.add('modal-open');
            
            // Add backdrop
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade show';
            backdrop.id = 'signup-backdrop';
            document.body.appendChild(backdrop);
            
            // Close on backdrop click
            backdrop.addEventListener('click', () => this.hideSignupFallback());
            
            // Close on X button click
            const closeBtn = signupModalEl.querySelector('.btn-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideSignupFallback());
            }
        }
    }

    hideSignupFallback() {
        const signupModalEl = document.getElementById('signupModal');
        const backdrop = document.getElementById('signup-backdrop');
        
        if (signupModalEl) {
            signupModalEl.style.display = 'none';
            signupModalEl.classList.remove('show');
        }
        
        if (backdrop) {
            backdrop.remove();
        }
        
        document.body.classList.remove('modal-open');
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const form = e.target;
        const emailInput = form.querySelector('#loginEmail');
        const passwordInput = form.querySelector('#loginPassword');
        const errorDiv = form.querySelector('#loginError');
        
        if (!emailInput || !passwordInput) return;
        
        // Clear previous errors
        this.hideError(errorDiv);
        
        // Validate inputs
        let isValid = true;
        if (!Validator.validateEmail(emailInput.value, emailInput)) {
            isValid = false;
        }
        if (!Validator.validateRequired(passwordInput.value, passwordInput, 'Password')) {
            isValid = false;
        }
        
        if (!isValid) return;

        try {
            this.setLoadingState(form, true);
            
            const data = await api.login(emailInput.value, passwordInput.value);
            
            // Store auth data
            this.currentUser.token = data.token;
            this.currentUser.id = data.userId;
            this.currentUser.username = data.username;
            this.currentUser.credits = data.credits;
            
            localStorage.setItem(Config.STORAGE_KEYS.AUTH_TOKEN, data.token);
            Utils.setCache(Config.STORAGE_KEYS.USER_CACHE, {
                id: data.userId,
                username: data.username,
                credits: data.credits
            }, 60); // Cache for 1 hour
            
            this.updateUIBasedOnLoginState();
            
            // Hide modal using appropriate method
            if (this.loginModal) {
                this.loginModal.hide();
            } else {
                this.hideLoginFallback();
            }
            
            // Dispatch login event
            window.dispatchEvent(new CustomEvent('auth:login', { 
                detail: { user: this.currentUser } 
            }));
            
        } catch (error) {
            this.showError(errorDiv, Utils.formatError(error));
        } finally {
            this.setLoadingState(form, false);
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        
        const form = e.target;
        const usernameInput = form.querySelector('#signupUsername');
        const emailInput = form.querySelector('#signupEmail');
        const passwordInput = form.querySelector('#signupPassword');
        const confirmPasswordInput = form.querySelector('#signupConfirmPassword');
        const errorDiv = form.querySelector('#signupError');
        
        if (!usernameInput || !emailInput || !passwordInput || !confirmPasswordInput) return;
        
        // Clear previous errors
        this.hideError(errorDiv);
        
        // Validate inputs
        let isValid = true;
        if (!Validator.validateRequired(usernameInput.value, usernameInput, 'Username')) {
            isValid = false;
        }
        if (!Validator.validateEmail(emailInput.value, emailInput)) {
            isValid = false;
        }
        if (!Validator.validatePassword(passwordInput.value, passwordInput)) {
            isValid = false;
        }
        
        // Check password confirmation
        if (passwordInput.value !== confirmPasswordInput.value) {
            Validator.showError(confirmPasswordInput, 'Passwords do not match');
            isValid = false;
        }
        
        if (!isValid) return;

        try {
            this.setLoadingState(form, true);
            
            await api.register(
                usernameInput.value, 
                emailInput.value, 
                passwordInput.value
            );
            
            // Hide modal using appropriate method
            if (this.signupModal) {
                this.signupModal.hide();
            } else {
                this.hideSignupFallback();
            }
            
            // Show success message
            this.showSuccessMessage(
                'Registration successful! Please check your email for a verification link.'
            );
            
            form.reset();
            
        } catch (error) {
            this.showError(errorDiv, Utils.formatError(error));
        } finally {
            this.setLoadingState(form, false);
        }
    }

    handleLogout() {
        // Clear auth data
        this.currentUser.token = null;
        this.currentUser.id = null;
        this.currentUser.username = null;
        this.currentUser.credits = 0;
        
        localStorage.removeItem(Config.STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(Config.STORAGE_KEYS.USER_CACHE);
        
        this.updateUIBasedOnLoginState();
        
        // Dispatch logout event
        window.dispatchEvent(new CustomEvent('auth:logout'));
        
        console.log('User logged out');
    }

    async fetchUserProfile() {
        if (!this.currentUser.token) return;
        
        try {
            const data = await api.getUserProfile();
            this.currentUser.username = data.username;
            this.currentUser.credits = data.credits;
            
            // Update cache
            Utils.setCache(Config.STORAGE_KEYS.USER_CACHE, {
                id: this.currentUser.id,
                username: data.username,
                credits: data.credits
            }, 60);
            
            this.updateUserDisplay();
            
        } catch (error) {
            console.error('Failed to fetch user profile:', error.message);
        }
    }

    updateUIBasedOnLoginState() {
        const userInfoDiv = document.getElementById('userInfo');
        const authButtonsDiv = document.getElementById('authButtons');
        const appContainer = document.getElementById('appContainer');
        const loggedOutCTA = document.getElementById('loggedOutCTA');
        const exampleSongsSection = document.getElementById('exampleSongsSection');
        
        if (this.currentUser.token) {
            // User is logged in
            if (userInfoDiv) userInfoDiv.style.display = 'block';
            if (authButtonsDiv) authButtonsDiv.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';
            if (loggedOutCTA) loggedOutCTA.style.display = 'none';
            if (exampleSongsSection) exampleSongsSection.style.display = 'none';
            
            // Load cached user data if available
            const cachedUser = Utils.getCache(Config.STORAGE_KEYS.USER_CACHE);
            if (cachedUser) {
                this.currentUser.username = cachedUser.username;
                this.currentUser.credits = cachedUser.credits;
            }
            
            this.updateUserDisplay();
            this.fetchUserProfile(); // Refresh data from server
            
        } else {
            // User is logged out
            if (userInfoDiv) userInfoDiv.style.display = 'none';
            if (authButtonsDiv) authButtonsDiv.style.display = 'block';
            if (appContainer) appContainer.style.display = 'none';
            if (loggedOutCTA) loggedOutCTA.style.display = 'block';
            if (exampleSongsSection) exampleSongsSection.style.display = 'block';
        }
        
        this.resetForms();
    }

    updateUserDisplay() {
        const usernameDisplay = document.getElementById('usernameDisplay');
        const creditsDisplay = document.getElementById('creditsDisplay');
        
        if (usernameDisplay) {
            usernameDisplay.textContent = this.currentUser.username || 'User';
        }
        if (creditsDisplay) {
            creditsDisplay.textContent = this.currentUser.credits;
        }
    }

    resetForms() {
        // Reset login and signup forms
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        const loginError = document.getElementById('loginError');
        const signupError = document.getElementById('signupError');
        
        if (loginForm) loginForm.reset();
        if (signupForm) signupForm.reset();
        if (loginError) this.hideError(loginError);
        if (signupError) this.hideError(signupError);
        
        // Clear validation states
        document.querySelectorAll('.is-invalid, .is-valid').forEach(el => {
            el.classList.remove('is-invalid', 'is-valid');
        });
    }

    setLoadingState(form, isLoading) {
        const submitButton = form.querySelector('button[type="submit"]');
        if (!submitButton) return;
        
        if (isLoading) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Processing...';
        } else {
            submitButton.disabled = false;
            submitButton.innerHTML = submitButton.dataset.originalText || 
                (form.id === 'loginForm' ? 'Login' : 'Sign Up');
        }
        
        // Store original text if not already stored
        if (!submitButton.dataset.originalText) {
            submitButton.dataset.originalText = submitButton.textContent;
        }
    }

    showError(errorDiv, message) {
        if (!errorDiv) return;
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    hideError(errorDiv) {
        if (!errorDiv) return;
        errorDiv.style.display = 'none';
    }

    showSuccessMessage(message) {
        // You can implement a toast notification system here
        // For now, using a simple alert
        alert(message);
    }

    isLoggedIn() {
        return !!this.currentUser.token;
    }

    getCurrentUser() {
        return this.currentUser;
    }
}