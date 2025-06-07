import { Config, Utils } from './config.js';

// Frontend validation utilities
export class Validator {
    static showError(element, message) {
        const errorElement = element.parentNode.querySelector('.error-message') || 
                           element.parentNode.querySelector('.invalid-feedback');
        
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
        
        element.classList.add('is-invalid');
        element.classList.remove('is-valid');
    }

    static showSuccess(element) {
        const errorElement = element.parentNode.querySelector('.error-message') || 
                           element.parentNode.querySelector('.invalid-feedback');
        
        if (errorElement) {
            errorElement.style.display = 'none';
        }
        
        element.classList.remove('is-invalid');
        element.classList.add('is-valid');
    }

    static clearValidation(element) {
        const errorElement = element.parentNode.querySelector('.error-message') || 
                           element.parentNode.querySelector('.invalid-feedback');
        
        if (errorElement) {
            errorElement.style.display = 'none';
        }
        
        element.classList.remove('is-invalid', 'is-valid');
    }

    static validateEmail(email, element = null) {
        const isValid = Utils.validateEmail(email);
        
        if (element) {
            if (isValid) {
                this.showSuccess(element);
            } else {
                this.showError(element, 'Please enter a valid email address');
            }
        }
        
        return isValid;
    }

    static validatePassword(password, element = null) {
        const errors = [];
        
        if (password.length < 8) {
            errors.push('at least 8 characters');
        }
        if (!/[A-Z]/.test(password)) {
            errors.push('one uppercase letter');
        }
        if (!/[a-z]/.test(password)) {
            errors.push('one lowercase letter');
        }
        if (!/\d/.test(password)) {
            errors.push('one number');
        }
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            errors.push('one special character');
        }

        const isValid = errors.length === 0;
        
        if (element) {
            if (isValid) {
                this.showSuccess(element);
            } else {
                this.showError(element, `Password must contain ${errors.join(', ')}`);
            }
        }
        
        return isValid;
    }

    static validateRequired(value, element = null, fieldName = 'This field') {
        const isValid = value && value.trim().length > 0;
        
        if (element) {
            if (isValid) {
                this.showSuccess(element);
            } else {
                this.showError(element, `${fieldName} is required`);
            }
        }
        
        return isValid;
    }

    static validateLength(value, maxLength, element = null, fieldName = 'Input') {
        const isValid = !value || value.length <= maxLength;
        
        if (element) {
            if (isValid) {
                this.showSuccess(element);
            } else {
                this.showError(element, `${fieldName} must be ${maxLength} characters or less`);
            }
        }
        
        return isValid;
    }

    static validateWorkout(workout, element = null) {
        const required = this.validateRequired(workout, null, 'Workout target');
        const length = this.validateLength(workout, Config.MAX_WORKOUT_LENGTH, null, 'Workout target');
        
        const isValid = required && length;
        
        if (element) {
            if (isValid) {
                this.showSuccess(element);
            } else if (!required) {
                this.showError(element, 'Workout target is required');
            } else {
                this.showError(element, `Workout target must be ${Config.MAX_WORKOUT_LENGTH} characters or less`);
            }
        }
        
        return isValid;
    }

    static validateMusicStyle(musicStyle, customStyle, buttonContainer = null, customInput = null) {
        const hasStyle = (musicStyle && musicStyle.trim()) || (customStyle && customStyle.trim());
        
        if (buttonContainer && customInput) {
            if (hasStyle) {
                buttonContainer.classList.remove('is-invalid');
                customInput.classList.remove('is-invalid');
                
                const errorElement = buttonContainer.parentNode.querySelector('.invalid-feedback');
                if (errorElement) {
                    errorElement.style.display = 'none';
                }
            } else {
                buttonContainer.classList.add('is-invalid');
                customInput.classList.add('is-invalid');
                
                const errorElement = buttonContainer.parentNode.querySelector('.invalid-feedback');
                if (errorElement) {
                    errorElement.textContent = 'Please select a style or enter a custom one';
                    errorElement.style.display = 'block';
                }
            }
        }
        
        return hasStyle;
    }

    static validateForm(form) {
        const inputs = form.querySelectorAll('input[required], textarea[required], select[required]');
        let isValid = true;
        
        inputs.forEach(input => {
            const value = input.value.trim();
            
            if (!value) {
                this.showError(input, `${input.placeholder || 'This field'} is required`);
                isValid = false;
            } else {
                // Specific validation based on input type or name
                if (input.type === 'email') {
                    if (!this.validateEmail(value, input)) {
                        isValid = false;
                    }
                } else if (input.type === 'password') {
                    if (!this.validatePassword(value, input)) {
                        isValid = false;
                    }
                } else {
                    this.showSuccess(input);
                }
            }
        });
        
        return isValid;
    }
}

// Real-time validation setup
export function setupRealTimeValidation() {
    // Email validation
    document.querySelectorAll('input[type="email"]').forEach(input => {
        const debouncedValidation = Utils.debounce((e) => {
            if (e.target.value.trim()) {
                Validator.validateEmail(e.target.value, e.target);
            } else {
                Validator.clearValidation(e.target);
            }
        }, Config.DEBOUNCE_DELAY);
        
        input.addEventListener('input', debouncedValidation);
        input.addEventListener('blur', (e) => {
            if (e.target.value.trim()) {
                Validator.validateEmail(e.target.value, e.target);
            }
        });
    });

    // Password validation
    document.querySelectorAll('input[type="password"]').forEach(input => {
        const debouncedValidation = Utils.debounce((e) => {
            if (e.target.value) {
                Validator.validatePassword(e.target.value, e.target);
            } else {
                Validator.clearValidation(e.target);
            }
        }, Config.DEBOUNCE_DELAY);
        
        input.addEventListener('input', debouncedValidation);
    });

    // Required field validation
    document.querySelectorAll('input[required], textarea[required]').forEach(input => {
        input.addEventListener('blur', (e) => {
            if (!e.target.value.trim()) {
                Validator.showError(e.target, `${e.target.placeholder || 'This field'} is required`);
            } else {
                Validator.clearValidation(e.target);
            }
        });

        input.addEventListener('input', (e) => {
            if (e.target.classList.contains('is-invalid') && e.target.value.trim()) {
                Validator.clearValidation(e.target);
            }
        });
    });
}