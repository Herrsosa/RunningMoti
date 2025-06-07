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
        
        this.init();
    }

    init() {
        this.setupModals();
        this.setupEventListeners();
        this.updateUIBasedOnLoginState();
        
        // Listen for auth logout events
        window.addEventListener('auth:logout', () => {
            this.handleLogout();
        });
    }

    setupModals() {
        const loginModalEl = document.getElementById('loginModal');
        const signupModalEl = document.getElementById('signupModal');
        
        if (loginModalEl && window.bootstrap) {
            this.loginModal = new bootstrap.Modal(loginModalEl);
        }
        
        if (signupModalEl && window.bootstrap) {
            this.signupModal = new bootstrap.Modal(signupModalEl);
        }
    }

    setupEventListeners() {
        // Show login/signup buttons
        const showLoginBtn = document.getElementById('showLoginBtn');
        const showSignupBtn = document.getElementById('showSignupBtn');
        const logoutButton = document.getElementById('logoutButton');
        
        if (showLoginBtn && this.loginModal) {
            showLoginBtn.addEventListener('click', () => this.loginModal.show());
        }
        
        if (showSignupBtn && this.signupModal) {
            showSignupBtn.addEventListener('click', () => this.signupModal.show());
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
            
            if (this.loginModal) {
                this.loginModal.hide();
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
            
            if (this.signupModal) {
                this.signupModal.hide();
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