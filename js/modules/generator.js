import api from '../utils/api.js';
import { Config, Utils } from '../utils/config.js';
import { Validator } from '../utils/validation.js';

export class SongGenerator {
    constructor(authManager) {
        this.authManager = authManager;
        this.currentGenerationId = null;
        this.lyricsPollingInterval = null;
        this.audioPollingInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupFormValidation();
    }

    setupEventListeners() {
        const songForm = document.getElementById('songForm');
        const languageInput = document.getElementById('languageInput');
        const customLanguageInput = document.getElementById('customLanguageInput');
        const toneButtonsContainer = document.getElementById('toneButtons');
        const customStyleInput = document.getElementById('customStyleInput');
        const workoutInput = document.getElementById('workoutInput');
        
        if (songForm) {
            songForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }
        
        if (languageInput && customLanguageInput) {
            languageInput.addEventListener('change', () => {
                customLanguageInput.style.display = 
                    languageInput.value === 'Custom…' ? 'block' : 'none';
            });
        }
        
        if (toneButtonsContainer) {
            this.setupButtonGroup(toneButtonsContainer);
        }
        
        // Clear validation on input
        if (customStyleInput) {
            customStyleInput.addEventListener('input', () => {
                this.clearStyleValidation();
            });
        }
        
        if (workoutInput) {
            const debouncedValidation = Utils.debounce(() => {
                if (workoutInput.value.trim()) {
                    Validator.validateWorkout(workoutInput.value, workoutInput);
                }
            }, Config.DEBOUNCE_DELAY);
            
            workoutInput.addEventListener('input', debouncedValidation);
        }
    }

    setupFormValidation() {
        // Real-time validation for workout input
        const workoutInput = document.getElementById('workoutInput');
        if (workoutInput) {
            workoutInput.addEventListener('blur', () => {
                if (workoutInput.value.trim()) {
                    Validator.validateWorkout(workoutInput.value, workoutInput);
                }
            });
        }
    }

    setupButtonGroup(container) {
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('option-button')) {
                // Clear any existing selection
                container.querySelectorAll('.option-button').forEach(btn => 
                    btn.classList.remove('active'));
                
                // Select clicked button
                e.target.classList.add('active');
                
                // Update hidden input
                const hiddenInput = document.getElementById('musicStyleInput');
                if (hiddenInput) {
                    hiddenInput.value = e.target.getAttribute('data-value');
                }
                
                // Clear validation errors
                this.clearStyleValidation();
            }
        });
    }

    clearStyleValidation() {
        const toneButtonsContainer = document.getElementById('toneButtons');
        const customStyleInput = document.getElementById('customStyleInput');
        const toneErrorDiv = document.getElementById('tone-error');
        
        if (toneButtonsContainer) toneButtonsContainer.classList.remove('is-invalid');
        if (customStyleInput) customStyleInput.classList.remove('is-invalid');
        if (toneErrorDiv) toneErrorDiv.style.display = 'none';
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        if (!this.authManager.isLoggedIn()) {
            this.showError('Please login to generate songs.');
            return;
        }
        
        const currentUser = this.authManager.getCurrentUser();
        if (currentUser.credits < Config.CREDITS_PER_SONG) {
            this.showError(`Insufficient credits. Generating a song costs ${Config.CREDITS_PER_SONG} credit.`);
            return;
        }
        
        if (!this.validateForm()) {
            return;
        }
        
        const formData = this.getFormData();
        
        try {
            this.setGenerationState('preparing');
            
            // Step 1: Generate lyrics
            const lyricsResponse = await api.generateLyrics(formData);
            this.currentGenerationId = lyricsResponse.songId;
            
            this.setGenerationState('lyrics');
            
            // Step 2: Poll for lyrics completion
            const lyrics = await this.pollLyricsStatus(this.currentGenerationId);
            
            this.displayLyrics(lyrics);
            
            // Step 3: Generate audio
            await api.generateAudio(this.currentGenerationId);
            
            this.setGenerationState('complete');
            
            // Show completion modal and switch to library
            this.showCompletionModal();
            
        } catch (error) {
            console.error('Generation error:', error);
            this.showError(Utils.formatError(error));
            this.setGenerationState('error');
            
            // Refresh user credits in case they were deducted
            this.authManager.fetchUserProfile();
        }
    }

    validateForm() {
        const workoutInput = document.getElementById('workoutInput');
        const musicStyleInput = document.getElementById('musicStyleInput');
        const customStyleInput = document.getElementById('customStyleInput');
        const toneButtonsContainer = document.getElementById('toneButtons');
        
        let isValid = true;
        
        // Clear previous errors
        this.hideError();
        
        // Validate workout
        if (!workoutInput || !Validator.validateWorkout(workoutInput.value, workoutInput)) {
            isValid = false;
        }
        
        // Validate music style (either preset or custom)
        const hasPresetStyle = musicStyleInput && musicStyleInput.value.trim();
        const hasCustomStyle = customStyleInput && customStyleInput.value.trim();
        
        if (!Validator.validateMusicStyle(
            hasPresetStyle ? musicStyleInput.value : '', 
            hasCustomStyle ? customStyleInput.value : '',
            toneButtonsContainer,
            customStyleInput
        )) {
            isValid = false;
        }
        
        return isValid;
    }

    getFormData() {
        const nameInput = document.getElementById('nameInput');
        const workoutInput = document.getElementById('workoutInput');
        const musicStyleInput = document.getElementById('musicStyleInput');
        const customStyleInput = document.getElementById('customStyleInput');
        const toneInput = document.getElementById('toneInput');
        const languageInput = document.getElementById('languageInput');
        const customLanguageInput = document.getElementById('customLanguageInput');
        
        // Determine final values
        const musicStyle = customStyleInput?.value.trim() || musicStyleInput?.value || '';
        const language = languageInput?.value !== 'Custom…' 
            ? languageInput?.value || 'English'
            : customLanguageInput?.value.trim() || 'English';
        
        return {
            name: nameInput?.value.trim() || '',
            workout: workoutInput?.value.trim() || '',
            musicStyle: musicStyle,
            customStyle: customStyleInput?.value.trim() || '',
            tone: toneInput?.value || 'Inspiring',
            language: language
        };
    }

    async pollLyricsStatus(songId) {
        return new Promise((resolve, reject) => {
            let pollCount = 0;
            
            this.lyricsPollingInterval = setInterval(async () => {
                pollCount++;
                
                if (pollCount > Config.MAX_POLLS) {
                    clearInterval(this.lyricsPollingInterval);
                    reject(new Error('Lyrics generation timed out. Please check your library later.'));
                    return;
                }
                
                try {
                    const statusData = await api.getLyricsStatus(songId);
                    
                    // Update progress
                    this.updateProgress(Utils.statusToPercent(statusData.status));
                    this.updateStatusMessage(statusData.status);
                    
                    if (statusData.status === 'lyrics_complete' && statusData.lyrics) {
                        clearInterval(this.lyricsPollingInterval);
                        resolve(statusData.lyrics);
                    } else if (statusData.status === 'lyrics_error') {
                        clearInterval(this.lyricsPollingInterval);
                        reject(new Error('Lyrics generation failed. Please try again.'));
                    }
                    
                } catch (error) {
                    console.warn(`Lyrics polling attempt ${pollCount} failed:`, error.message);
                    
                    if (error.message?.includes('session has expired')) {
                        clearInterval(this.lyricsPollingInterval);
                        reject(error);
                    }
                }
            }, Config.POLLING_INTERVAL);
        });
    }

    setGenerationState(state) {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const progressContainer = document.getElementById('progressContainer');
        const motivateButton = document.getElementById('motivateButton');
        const audioResultContainer = document.getElementById('audioResultContainer');
        
        // Reset all states
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (progressContainer) progressContainer.style.display = 'none';
        if (audioResultContainer) audioResultContainer.style.display = 'none';
        
        switch (state) {
            case 'preparing':
                if (loadingIndicator) loadingIndicator.style.display = 'block';
                if (motivateButton) {
                    motivateButton.disabled = true;
                    motivateButton.textContent = 'GENERATING...';
                }
                this.updateStatusMessage('Preparing generation...');
                break;
                
            case 'lyrics':
                if (progressContainer) progressContainer.style.display = 'block';
                this.updateStatusMessage('Generating lyrics...');
                break;
                
            case 'complete':
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                if (progressContainer) progressContainer.style.display = 'none';
                if (motivateButton) {
                    motivateButton.disabled = false;
                    motivateButton.textContent = `MOTIVATE (${Config.CREDITS_PER_SONG} Credit)`;
                }
                break;
                
            case 'error':
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                if (progressContainer) progressContainer.style.display = 'none';
                if (motivateButton) {
                    motivateButton.disabled = false;
                    motivateButton.textContent = `MOTIVATE (${Config.CREDITS_PER_SONG} Credit)`;
                }
                break;
        }
    }

    updateProgress(percent) {
        const progressBar = document.getElementById('generationProgress');
        if (progressBar) {
            progressBar.value = percent;
        }
    }

    updateStatusMessage(status) {
        const loadingMessage = document.getElementById('loadingMessage');
        if (!loadingMessage) return;
        
        const messages = {
            'lyrics_pending': 'Generating lyrics... (This can take a few minutes)',
            'lyrics_processing': 'Generating lyrics... (Processing)',
            'lyrics_complete': 'Lyrics generated!',
            'lyrics_error': 'Lyrics generation failed.',
            'audio_pending': 'Audio generation queued...',
            'audio_processing': 'Generating audio...',
            'complete': 'Generation complete!'
        };
        
        loadingMessage.textContent = messages[status] || `Status: ${status}`;
    }

    displayLyrics(lyrics) {
        const lyricsOutput = document.getElementById('lyricsOutput');
        if (lyricsOutput) {
            lyricsOutput.textContent = lyrics;
        }
    }

    showCompletionModal() {
        const modal = document.getElementById('audioGenerationModal');
        if (modal && window.bootstrap) {
            const modalInstance = new bootstrap.Modal(modal);
            modalInstance.show();
        }
        
        // Trigger library refresh
        window.dispatchEvent(new CustomEvent('generator:complete', {
            detail: { songId: this.currentGenerationId }
        }));
    }

    showError(message) {
        const errorDiv = document.getElementById('generalError');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    hideError() {
        const errorDiv = document.getElementById('generalError');
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    }

    reset() {
        // Clear intervals
        if (this.lyricsPollingInterval) {
            clearInterval(this.lyricsPollingInterval);
            this.lyricsPollingInterval = null;
        }
        
        if (this.audioPollingInterval) {
            clearInterval(this.audioPollingInterval);
            this.audioPollingInterval = null;
        }
        
        // Reset form
        const form = document.getElementById('songForm');
        if (form) form.reset();
        
        // Reset UI state
        this.setGenerationState('error'); // This will reset buttons and hide progress
        this.hideError();
        
        // Clear selected buttons
        document.querySelectorAll('#toneButtons .option-button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const musicStyleInput = document.getElementById('musicStyleInput');
        if (musicStyleInput) musicStyleInput.value = '';
        
        this.currentGenerationId = null;
    }
}