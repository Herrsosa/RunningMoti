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
            console.log('Starting generation process...');
            this.setGenerationState('preparing');
            
            // Step 1: Generate lyrics
            console.log('Calling generateLyrics API...');
            const lyricsResponse = await api.generateLyrics(formData);
            this.currentGenerationId = lyricsResponse.songId;
            console.log('Lyrics generation initiated, songId:', this.currentGenerationId);
            
            // Ensure we transition to lyrics state
            this.setGenerationState('lyrics');
            
            // Step 2: Poll for lyrics completion
            console.log('Starting lyrics polling...');
            const lyrics = await this.pollLyricsStatus(this.currentGenerationId);
            
            this.displayLyrics(lyrics);
            
            // Step 3: Generate audio
            console.log('Initiating audio generation...');
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
            
            console.log('Starting lyrics polling for songId:', songId);
            
            // Show initial progress
            this.updateProgress(10); // Start at 10%
            
            this.lyricsPollingInterval = setInterval(async () => {
                pollCount++;
                console.log(`Lyrics poll attempt ${pollCount}/${Config.MAX_POLLS}`);
                
                if (pollCount > Config.MAX_POLLS) {
                    clearInterval(this.lyricsPollingInterval);
                    reject(new Error('Lyrics generation timed out. Please check your library later.'));
                    return;
                }
                
                try {
                    const statusData = await api.getLyricsStatus(songId);
                    console.log('Lyrics status response:', statusData);
                    
                    // Calculate progress based on poll count and status
                    let progressPercent = 10; // Base progress
                    
                    if (statusData.status === 'lyrics_processing') {
                        // Gradually increase during processing
                        progressPercent = Math.min(10 + (pollCount * 5), 50);
                    } else if (statusData.status === 'lyrics_complete') {
                        progressPercent = 60;
                    } else {
                        // For pending status, slowly increment
                        progressPercent = Math.min(10 + (pollCount * 2), 30);
                    }
                    
                    console.log(`Setting progress to ${progressPercent}% for status ${statusData.status}`);
                    this.updateProgress(progressPercent);
                    this.updateStatusMessage(statusData.status);
                    
                    if (statusData.status === 'lyrics_complete' && statusData.lyrics) {
                        clearInterval(this.lyricsPollingInterval);
                        console.log('Lyrics generation complete!');
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
            }, 3000);
        });
    }

    setGenerationState(state) {
        console.log('Setting generation state to:', state);
        
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
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                    const progressBar = document.getElementById('generationProgress');
                    if (progressBar) progressBar.value = 5; // Show 5% immediately
                }
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'block';
                }
                if (motivateButton) {
                    motivateButton.disabled = true;
                    motivateButton.textContent = 'STARTING...';
                }
                this.updateStatusMessage('Preparing your track...');
                break;
                
            case 'lyrics':
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                    const progressBar = document.getElementById('generationProgress');
                    if (progressBar) progressBar.value = 15; // Jump to 15%
                }
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'block';
                }
                if (motivateButton) {
                    motivateButton.textContent = 'WRITING LYRICS...';
                }
                this.updateStatusMessage('Creating your personalized lyrics...');
                break;
                
            case 'complete':
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                if (progressContainer) {
                    const progressBar = document.getElementById('generationProgress');
                    if (progressBar) progressBar.value = 100;
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 1000); // Hide after 1 second
                }
                if (motivateButton) {
                    motivateButton.disabled = false;
                    motivateButton.textContent = `Generate My Track (${Config.CREDITS_PER_SONG} credit)`;
                }
                break;
                
            case 'error':
                if (loadingIndicator) loadingIndicator.style.display = 'none';
                if (progressContainer) progressContainer.style.display = 'none';
                if (motivateButton) {
                    motivateButton.disabled = false;
                    motivateButton.textContent = `Generate My Track (${Config.CREDITS_PER_SONG} credit)`;
                }
                break;
        }
    }

    updateProgress(percent) {
        const progressBar = document.getElementById('generationProgress');
        const progressContainer = document.getElementById('progressContainer');
        const progressPercent = document.getElementById('progressPercent');
        
        if (progressBar && progressContainer) {
            // Make sure container is visible
            progressContainer.style.display = 'block';
            
            // Update progress bar value directly
            progressBar.value = percent;
            
            // Update percentage text
            if (progressPercent) {
                progressPercent.textContent = `${Math.round(percent)}%`;
            }
            
            console.log(`Progress updated to ${percent}%`);
        } else {
            console.error('Progress bar elements not found');
        }
    }
    
    updateStatusMessage(status) {
        const loadingMessage = document.getElementById('loadingMessage');
        if (!loadingMessage) {
            console.error('Loading message element not found');
            return;
        }
        
        const messages = {
            'lyrics_pending': 'Generating lyrics... (This can take a few minutes)',
            'lyrics_processing': 'Generating lyrics... (Processing)',
            'lyrics_complete': 'Lyrics generated!',
            'lyrics_error': 'Lyrics generation failed.',
            'audio_pending': 'Audio generation queued...',
            'audio_processing': 'Generating audio...',
            'complete': 'Generation complete!'
        };
        
        const message = messages[status] || `Status: ${status}`;
        loadingMessage.textContent = message;
        console.log('Status message updated:', message);
    }

    displayLyrics(lyrics) {
        const lyricsOutput = document.getElementById('lyricsOutput');
        const audioResultContainer = document.getElementById('audioResultContainer');
        
        if (lyricsOutput && audioResultContainer) {
            lyricsOutput.textContent = lyrics;
            
            // Add animation when showing results
            audioResultContainer.classList.add('animate__animated', 'animate__fadeIn');
            audioResultContainer.style.display = 'block';
        }
    }

    showCompletionModal() {
        console.log('Attempting to show completion modal...');
        const modal = document.getElementById('audioGenerationModal');
        
        if (!modal) {
            console.error('audioGenerationModal element not found');
            // Fallback: switch to library tab without modal
            this.switchToLibraryTab();
            return;
        }
        
        if (window.bootstrap && window.bootstrap.Modal) {
            try {
                const modalInstance = new bootstrap.Modal(modal);
                modalInstance.show();
                console.log('Modal shown successfully');
            } catch (error) {
                console.error('Error showing modal:', error);
                // Fallback: switch to library tab without modal
                this.switchToLibraryTab();
            }
        } else {
            console.warn('Bootstrap Modal not available, switching to library directly');
            // Fallback: switch to library tab without modal
            this.switchToLibraryTab();
        }
        
        // Trigger library refresh
        window.dispatchEvent(new CustomEvent('generator:complete', {
            detail: { songId: this.currentGenerationId }
        }));
    }
    
    switchToLibraryTab() {
        const libraryTabLink = document.querySelector('a[href="#libraryTab"]');
        if (libraryTabLink && window.bootstrap && window.bootstrap.Tab) {
            try {
                const tab = new bootstrap.Tab(libraryTabLink);
                tab.show();
                console.log('Switched to library tab');
            } catch (error) {
                console.error('Error switching tabs:', error);
                // Fallback: manual tab switching
                libraryTabLink.click();
            }
        } else if (libraryTabLink) {
            // Fallback: manual click
            libraryTabLink.click();
        }
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