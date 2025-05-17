// main.js
document.addEventListener('DOMContentLoaded', function () {
    // --- STATE ---
    let currentUser = {
        token: localStorage.getItem('authToken'),
        id: null,
        username: null,
        credits: 0
    };

    // --- DOM Elements ---
    const appContainer = document.getElementById('appContainer');
    const userInfoDiv = document.getElementById('userInfo');
    const usernameDisplay = document.getElementById('usernameDisplay');
    const creditsDisplay = document.getElementById('creditsDisplay');
    const authButtonsDiv = document.getElementById('authButtons');
    const showLoginBtn = document.getElementById('showLoginBtn');
    const showSignupBtn = document.getElementById('showSignupBtn');
    const logoutButton = document.getElementById('logoutButton');
    const loginModalEl = document.getElementById('loginModal');
    const signupModalEl = document.getElementById('signupModal');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const loginErrorDiv = document.getElementById('loginError');
    const signupErrorDiv = document.getElementById('signupError');
    const libraryContent = document.getElementById('libraryContent');
    const libraryLoading = document.getElementById('libraryLoading');
    const libraryEmpty = document.getElementById('libraryEmpty');
    const appTabs = document.getElementById('appTabs');
    const loggedOutCTA = document.getElementById('loggedOutCTA'); // Get CTA div reference
    const progressContainer    = document.getElementById('progressContainer');
    const generationProgress   = document.getElementById('generationProgress');
    const exampleSongsSection = document.getElementById('exampleSongsSection');


    // Generator Form Elements
    const songForm = document.getElementById('songForm');
    const nameInput = document.getElementById('nameInput');
    const workoutInput = document.getElementById('workoutInput');
    const toneButtonsContainer = document.getElementById('toneButtons');
    const musicStyleInput = document.getElementById('musicStyleInput');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingMessage = document.getElementById('loadingMessage');
    const lyricsOutput = document.getElementById('lyricsOutput');
    const audioPlayer = document.getElementById('audioPlayer');
    const audioResultContainer = document.getElementById('audioResultContainer');
    const motivateButton = document.getElementById('motivateButton');
    const generalErrorDiv = document.getElementById('generalError');
    const workoutErrorDiv = document.getElementById('workout-error');
    const toneErrorDiv = document.getElementById('tone-error');
    const customStyleInput    = document.getElementById('customStyleInput');
    const toneInput           = document.getElementById('toneInput');
    const languageInput       = document.getElementById('languageInput');
    const customLanguageInput = document.getElementById('customLanguageInput');

    // ─── New: Show/Hide Custom Language Field ────────
    languageInput.addEventListener('change', () => {
    customLanguageInput.style.display =
        languageInput.value === 'Custom…' ? 'block' : 'none';
    });

    // ─── Existing Signup/Login Listeners ─────────────
    if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
        /* … */
    });
    }
    if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        /* … */
    });
    }


    // Bootstrap Modals Instances
    let loginModalInstance, signupModalInstance;
    if (loginModalEl) {
        loginModalInstance = new bootstrap.Modal(loginModalEl);
    }
    if (signupModalEl) {
        signupModalInstance = new bootstrap.Modal(signupModalEl);
    }


    // --- API Endpoints ---
    // Use a relative path for API requests. This works both locally (if backend is proxied)
    // and when deployed on Vercel, as Vercel routes /api to the backend function.
    const BASE_API_URL = '/api';


    // --- Utility Functions ---
    const updateUIBasedOnLoginState = () => {
        // Ensure core UI elements for auth state changes are present
        if (!userInfoDiv || !authButtonsDiv || !usernameDisplay || !creditsDisplay) {
            console.error("Core auth UI elements not found. Check HTML IDs for userInfo, authButtons, usernameDisplay, creditsDisplay.");
            // No return here, as other parts of the UI might still need updating
        }
    
        // Elements that are shown/hidden based on login state
        const elementsToToggle = [appContainer, loggedOutCTA, exampleSongsSection];
    
        if (currentUser.token) {
            // --- USER IS LOGGED IN ---
            if (userInfoDiv) userInfoDiv.style.display = 'block';
            if (authButtonsDiv) authButtonsDiv.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';
            if (loggedOutCTA) loggedOutCTA.style.display = 'none';
    
            // Hide example songs if user is logged in
            if (exampleSongsSection) {
                exampleSongsSection.style.display = 'none';
            }
    
            if (usernameDisplay) usernameDisplay.textContent = currentUser.username || 'User';
            if (creditsDisplay) creditsDisplay.textContent = currentUser.credits;
    
            fetchUserProfile(); // Fetch latest credits/info
    
            // Only load library if library elements exist and the library tab is currently active (or default)
            // This prevents unnecessary loads if the user is on the generator tab
            const libraryTabLink = appTabs ? appTabs.querySelector('a.nav-link[href="#libraryTab"]') : null;
            if (libraryContent && libraryTabLink && libraryTabLink.classList.contains('active')) {
                loadLibrary();
            }
        } else {
            // --- USER IS LOGGED OUT ---
            if (userInfoDiv) userInfoDiv.style.display = 'none';
            if (authButtonsDiv) authButtonsDiv.style.display = 'block';
            if (appContainer) appContainer.style.display = 'none';
            if (loggedOutCTA) loggedOutCTA.style.display = 'block';
    
            // Show example songs if user is logged out
            if (exampleSongsSection) {
                exampleSongsSection.style.display = 'block';
            }
    
            // Clear library if elements exist
            if (libraryContent && libraryLoading && libraryEmpty) {
                libraryContent.innerHTML = '';
                // For logged out state, perhaps don't show loading or empty messages for library
                libraryLoading.style.display = 'none';
                libraryEmpty.style.display = 'none';
            }
        }
    
        // Reset forms and errors (common to both states, or after state change)
        if (loginErrorDiv) loginErrorDiv.style.display = 'none';
        if (signupErrorDiv) signupErrorDiv.style.display = 'none';
        if (loginForm) loginForm.reset();
        if (signupForm) signupForm.reset();
    
        // Reset generator UI elements if they exist
        if (generalErrorDiv) generalErrorDiv.style.display = 'none';
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (audioResultContainer) audioResultContainer.style.display = 'none';
        if (progressContainer) progressContainer.style.display = 'none'; // Also hide progress bar
        if (generationProgress) generationProgress.value = 0; // Reset progress bar value
        if (lyricsOutput) lyricsOutput.textContent = '';
        if (motivateButton) { // Reset motivate button
            motivateButton.disabled = false;
            const CREDITS_PER_SONG = 1; // Make sure this is defined or fetched if dynamic
            motivateButton.textContent = `MOTIVATE (${CREDITS_PER_SONG} Credit)`;
        }
        if(songForm) songForm.reset(); // Reset the main song form
    };

    const showApiError = (errorDiv, error, defaultMessage = "An error occurred.") => {
        if (!errorDiv) return; // Don't proceed if error div doesn't exist
        console.error("API Error:", error);
        let message = defaultMessage;
        // Check if error is the structured object from apiRequest
        if (error && error.error) {
            message = error.error;
        // Check if error is a plain string
        } else if (typeof error === 'string') {
             message = error;
        // Check if error is a standard Error object
        } else if (error instanceof Error) {
            message = error.message;
        }
        // Ensure message is a string before setting textContent
        errorDiv.textContent = String(message);
        errorDiv.style.display = 'block';
    };

    function statusToPercent(status) {
        switch (status) {
            case 'lyrics_pending':     return 0;
            case 'lyrics_processing':  return 30;
            case 'lyrics_complete':    return 60;
            case 'audio_pending':      return 70;
            case 'audio_processing':   return 90;
            case 'complete':           return 100;
            case 'error':              return 0;
            default:                   return 0;
        }
    }

    // --- API Call Functions ---
    const apiRequest = async (endpoint, method = 'GET', body = null, requiresAuth = true) => {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        if (requiresAuth && currentUser.token) {
            options.headers['Authorization'] = `Bearer ${currentUser.token}`;
        } else if (requiresAuth && !currentUser.token) {
             // Immediately reject if auth is required but no token exists
             console.warn(`Auth required for ${endpoint}, but no token found.`);
             throw new Error("Please login first."); // Or specific error object
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(`${BASE_API_URL}${endpoint}`, options);

            if (!response.ok) {
                let errorData = { error: `Request failed with status: ${response.status}` }; // Default error
                try {
                     // Try to parse JSON error body from backend
                     errorData = await response.json();
                     // Ensure errorData has an 'error' property for consistency
                     if (!errorData.error) {
                         // Use status text if available and no error message found
                         errorData = { error: errorData.message || response.statusText || `Request failed with status: ${response.status}` };
                     }
                } catch(e) {
                    // If parsing fails, use the default HTTP status error
                    console.warn("Could not parse error response JSON body.");
                     errorData = { error: response.statusText || `Request failed with status: ${response.status}` };
                }

                 // Handle token expiry / unauthorized specifically
                 if ((response.status === 401 || response.status === 403) && requiresAuth) {
                     console.log("Authentication error (401/403). Logging out.");
                     handleLogout(); // Log the user out
                     // Throw a user-friendly error AFTER logging out
                     throw new Error("Your session has expired or is invalid. Please login again.");
                 }
                throw errorData; // Throw the structured error object
            }

             // Handle potential empty responses (e.g., 204 No Content)
            if (response.status === 204) {
                return null; // Return null for empty successful responses
            }
            // Attempt to parse JSON for other successful responses
             try {
                 // Handle 202 Accepted separately if needed (like from /generate-lyrics)
                 if (response.status === 202) {
                     console.log(`Request to ${endpoint} accepted (202).`);
                     // Fall through to parse JSON, assuming body contains useful info like songId
                 }
                 return await response.json();
             } catch (e) {
                 console.error(`Failed to parse JSON response for ${endpoint}:`, e);
                 throw new Error("Received an invalid response from the server.");
             }
        } catch (error) {
            console.error(`API Request Failed (${method} ${endpoint}):`, error);
            // Re-throw the error (could be network error, JSON parse error, or the structured error from above)
            throw error;
        }
    };

    // --- Authentication Functions ---
    const handleLogin = async (email, password) => {
        if (!loginErrorDiv || !loginModalInstance) return;
        loginErrorDiv.style.display = 'none';
        try {
            // Login endpoint doesn't require auth initially
            const data = await apiRequest('/auth/login', 'POST', { email, password }, false);
            currentUser.token = data.token;
            currentUser.id = data.userId;
            currentUser.username = data.username;
            currentUser.credits = data.credits;
            localStorage.setItem('authToken', data.token); // Store token
            updateUIBasedOnLoginState(); // Update UI to logged-in state
            loginModalInstance.hide(); // Hide modal on success
        } catch (error) {
            showApiError(loginErrorDiv, error, "Login failed. Please check email/password or verify your email.");
        }
    };

    const handleSignup = async (username, email, password, confirmPassword) => {
         if (!signupErrorDiv || !signupModalInstance || !generalErrorDiv || !signupForm) return;
        signupErrorDiv.style.display = 'none';
        generalErrorDiv.style.display = 'none'; // Hide general errors too

        if (password !== confirmPassword) {
            showApiError(signupErrorDiv, "Passwords do not match.");
            return;
        }
        try {
             // Register endpoint doesn't require auth
             const data = await apiRequest('/auth/register', 'POST', { username, email, password }, false);

             // --- Handle successful registration (verification needed) ---
             signupModalInstance.hide();
             signupForm.reset();

             // Show success message (using general error div styled as success)
             generalErrorDiv.classList.remove('alert-danger');
             generalErrorDiv.classList.add('alert-success');
             generalErrorDiv.textContent = data.message || "Registration successful! Please check your email (and spam folder) for a verification link.";
             generalErrorDiv.style.display = 'block';

             // Hide the success message after a delay
             setTimeout(() => {
                 if (generalErrorDiv) { // Check if element still exists
                     generalErrorDiv.style.display = 'none';
                     generalErrorDiv.classList.remove('alert-success');
                     generalErrorDiv.classList.add('alert-danger'); // Reset class for future errors
                     generalErrorDiv.textContent = '';
                 }
             }, 10000);
            // --- User is NOT logged in yet ---

        } catch (error) {
             // Show specific signup error within the modal
             showApiError(signupErrorDiv, error, "Signup failed. Please try again.");
        }
    };

    const handleLogout = () => {
        currentUser.token = null;
        currentUser.id = null;
        currentUser.username = null;
        currentUser.credits = 0;
        localStorage.removeItem('authToken'); // Remove token from storage
        updateUIBasedOnLoginState(); // Update UI to logged-out state
        console.log("User logged out.");
    };

    const fetchUserProfile = async () => {
        // This function now runs *after* login state is confirmed by token presence
        // apiRequest handles token presence and auth errors automatically
        if (!currentUser.token) return; // Should not happen if called correctly, but good check

        try {
            const data = await apiRequest('/library/profile', 'GET'); // Requires auth
            currentUser.username = data.username;
            currentUser.credits = data.credits;
            // Update display immediately
             if (usernameDisplay) usernameDisplay.textContent = currentUser.username;
             if (creditsDisplay) creditsDisplay.textContent = currentUser.credits;
        } catch (error) {
            // Error (like session expired) is handled by apiRequest, which calls handleLogout
            // No need to call handleLogout again here, just log if needed
            console.error("Failed to fetch user profile (likely session ended):", error.message);
            // Optionally show a less intrusive error message
            // showApiError(generalErrorDiv, "Could not refresh profile.", "Error");
        }
    };


    // --- Library Functions ---
    const loadLibrary = async () => {
         if (!currentUser.token || !libraryContent || !libraryLoading || !libraryEmpty) return;

        libraryLoading.style.display = 'block';
        libraryEmpty.style.display = 'none';
        libraryContent.innerHTML = ''; // Clear previous items

        try {
            const songs = await apiRequest('/library/songs', 'GET'); // Requires auth
            libraryLoading.style.display = 'none';

            if (songs && songs.length > 0) {
                songs.forEach(renderLibraryItem);
            } else {
                libraryEmpty.style.display = 'block';
            }
        } catch (error) {
            libraryLoading.style.display = 'none';
            // Error handled by apiRequest logout or show general error
            if (currentUser.token) { // Only show error if user is still supposedly logged in
                 showApiError(generalErrorDiv, error, "Failed to load library.");
            }
        }
    };

    const renderLibraryItem = (song) => {
         if (!libraryContent) return;
         const item = document.createElement('div');
         item.className = 'list-group-item library-list-item'; // Added base class
         item.dataset.songId = song.id;

         const formattedDate = song.created_at ? new Date(song.created_at).toLocaleDateString() : 'N/A';

         let statusOrPlayerHtml = '';
         // Add new statuses for lyrics generation
         switch(song.status) {
             case 'complete':
                 statusOrPlayerHtml = song.audio_url
                    ? `<audio controls src="${song.audio_url.startsWith('/') ? song.audio_url : '/' + song.audio_url}" class="library-audio-player"></audio>`
                    : `<span class="badge bg-success">Complete (Processing Audio URL...)</span>`; // Or show warning if URL missing unexpectedly
                 break;
             case 'processing': // Suno job submitted, waiting for callback/completion
                 statusOrPlayerHtml = `<span class="badge bg-info text-dark">Generating Audio...</span>`;
                 break;
             case 'audio_processing': // Cron job calling Suno API
                 statusOrPlayerHtml = `<span class="badge bg-secondary">Submitting Audio Job...</span>`;
                 break;
             case 'audio_pending': // Waiting for audio cron job
                 statusOrPlayerHtml = `<span class="badge bg-secondary">Audio Generation Queued...</span>`;
                 break;
             case 'lyrics_complete': // Lyrics done, ready for audio generation step
                 statusOrPlayerHtml = `<span class="badge bg-primary">Lyrics Ready</span>`;
                 break;
             case 'lyrics_processing': // Cron job calling OpenAI
                 statusOrPlayerHtml = `<span class="badge bg-light text-dark">Generating Lyrics...</span>`;
                 break;
             case 'lyrics_pending': // Waiting for lyrics cron job
                 statusOrPlayerHtml = `<span class="badge bg-light text-dark">Lyrics Queued...</span>`;
                 break;
             case 'lyrics_error': // Error during lyrics
                 statusOrPlayerHtml = `<span class="badge bg-warning text-dark">Lyrics Error</span>`;
                 break;
             case 'error': // General audio error (e.g., Suno callback failed)
             default:
                 statusOrPlayerHtml = `<span class="badge bg-danger">Error</span>`;
                 break;
         }

         item.innerHTML = `
            <div class="library-item-info">
                <h5>${song.title || 'Untitled Song'}</h5>
                <p>Workout: ${song.workout_input || 'N/A'}<br>Style: ${song.style_input || 'N/A'} | Date: ${formattedDate}</p>
            </div>
            <div class="library-item-controls">
                ${statusOrPlayerHtml}
                ${!['lyrics_pending', 'lyrics_processing', 'audio_pending', 'audio_processing', 'processing'].includes(song.status) ? // Only show delete for final/error states
                    `<button class="btn btn-sm btn-outline-danger btn-delete-song" data-song-id="${song.id}" title="Delete Song">X</button>` : ''
                }
            </div>
        `;
        libraryContent.appendChild(item);
    };

     const handleDeleteSong = async (songId) => {
         if (!libraryContent || !libraryEmpty) return;
        if (!confirm("Are you sure you want to delete this song? This cannot be undone.")) return;

        try {
            await apiRequest(`/library/songs/${songId}`, 'DELETE'); // Requires auth
            // Remove item from UI
            const itemToRemove = libraryContent.querySelector(`.library-list-item[data-song-id="${songId}"]`);
            if(itemToRemove) itemToRemove.remove();

            // Check if library is now empty
             if (libraryContent.children.length === 0) {
                 libraryEmpty.style.display = 'block';
             }
             console.log(`Song ${songId} deleted.`);
        } catch (error) {
            // Error handled by apiRequest logout or show general error
             if (currentUser.token) {
                 showApiError(generalErrorDiv, error, "Failed to delete song.");
             }
        }
    };


    // --- Generator Functions ---
    // Button group handler
    function handleButtonGroupClick(container, hiddenInput, errorDiv, groupElement) {
        if (!container || !hiddenInput) return;
        container.addEventListener('click', function (e) {
            if (e.target.classList.contains('option-button')) {
                if(groupElement) groupElement.classList.remove('is-invalid');
                if(errorDiv) errorDiv.style.display = 'none';
                container.querySelectorAll('.option-button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                hiddenInput.value = e.target.getAttribute('data-value');
            }
      });
    }
    handleButtonGroupClick(toneButtonsContainer, musicStyleInput, toneErrorDiv, toneButtonsContainer);

    // When they type their own style again, clear the error
    customStyleInput.addEventListener('input', () => {
        customStyleInput.classList.remove('is-invalid');
        toneButtonsContainer.classList.remove('is-invalid');
        toneErrorDiv.style.display = 'none';
    });

    // Text input validation clear
    if(workoutInput && workoutErrorDiv) {
        workoutInput.addEventListener('input', () => {
           workoutInput.classList.remove('is-invalid');
           workoutErrorDiv.style.display = 'none';
        });
    }


    // Generator Form Submission Handler - REFACTORED for Async Lyrics & Audio (Cron Job Approach)
    if (songForm) {
        songForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            // Ensure all required elements exist before proceeding
            if (!workoutInput || !musicStyleInput || !motivateButton || !loadingIndicator || !loadingMessage ||
                !generalErrorDiv || !workoutErrorDiv || !toneErrorDiv || !audioResultContainer || !lyricsOutput || !audioPlayer ) {
                console.error("Generator form elements missing. Aborting.");
                showApiError(generalErrorDiv || document.body, "UI Error: Form elements missing.", "Error");
                return;
            }


            // 1. Check Login State (via token presence)
            if (!currentUser.token) {
                showApiError(generalErrorDiv, "Please login to generate songs.");
                if (loginModalInstance) loginModalInstance.show();
                return;
            }

            // 2. Client-side Credit Check (Basic - Backend verifies authoritatively)
            const CREDITS_PER_SONG = 1; // Make this consistent with backend if logic changes
            if (currentUser.credits < CREDITS_PER_SONG) {
                 showApiError(generalErrorDiv, `Insufficient credits. Generating a song costs ${CREDITS_PER_SONG} credit.`);
                 return;
            }

            // 3. Form Validation
            let isValid = true;
            generalErrorDiv.style.display = 'none'; // Clear previous errors
            workoutErrorDiv.style.display = 'none';
            toneErrorDiv.style.display = 'none';
            workoutInput.classList.remove('is-invalid');
            if(toneButtonsContainer) toneButtonsContainer.classList.remove('is-invalid');

            if (!workoutInput.value.trim()) {
                workoutInput.classList.add('is-invalid');
                workoutErrorDiv.style.display = 'block';
                isValid = false;
            }
            if (!musicStyleInput.value.trim() && !customStyleInput.value.trim()) {
                // highlight both the preset buttons and the custom‑style input to indicate "pick one"
                toneButtonsContainer.classList.add('is-invalid');
                customStyleInput.classList.add('is-invalid');
                toneErrorDiv.textContent = "Please select a style or enter a custom one.";
                toneErrorDiv.style.display = 'block';
                isValid = false;
            }
            if (!isValid) return;

            // --- If valid, proceed ---
            audioResultContainer.style.display = 'none'; // Hide previous results
            lyricsOutput.textContent = ''; // Clear previous lyrics
            loadingIndicator.style.display = 'block';
            loadingMessage.textContent = "Preparing generation...";
            motivateButton.disabled = true;
            motivateButton.textContent = "GENERATING..."; // Update button text

            const workout = workoutInput.value.trim();
            const musicStyle = customStyleInput.value.trim()
                ? customStyleInput.value.trim()
                : musicStyleInput.value;
            
            const customStyle = customStyleInput.value.trim();   
                // Pick tone (default to "Inspiring" if none selected)
            const tone = toneInput.value || 'Inspiring';

                // Pick language: use dropdown or custom text, defaulting to English
            const language = languageInput.value !== 'Custom…'
                ? languageInput.value
                : (customLanguageInput.value.trim() || 'English');
            
            const name = nameInput ? nameInput.value.trim() : ''; // Handle optional name input

            let lyricsPollInterval; // Interval for lyrics status
            let audioPollInterval; // Interval for audio status
            let songId; // Store the song ID
            let lyrics; // Store lyrics
            let sunoTaskId; // Store Suno Task ID

            // Clear any previous intervals just in case
            if (lyricsPollInterval) clearInterval(lyricsPollInterval);
            if (audioPollInterval) clearInterval(audioPollInterval);

            try {
                // --- Step 1: Initiate Lyric Generation (Backend creates pending record) ---
                loadingMessage.textContent = "Initiating lyric generation...";
                const initiateLyricsResponse = await apiRequest('/generate/generate-lyrics', 'POST', { workout, musicStyle,customStyle, tone, language, name });
                songId = initiateLyricsResponse.songId; // Get the song ID
                console.log(`Lyric generation initiated for song ID: ${songId}. Starting status poll.`);

                // --- Step 2: Poll for Lyrics Status using /lyrics-status endpoint ---
                loadingMessage.textContent = "Generating lyrics (waiting for background job)...";
                let lyricsPollCount = 0;
                const maxLyricsPolls = 60; // Poll for ~5 minutes max for lyrics (Cron runs every minute)

                lyrics = await new Promise((resolve, reject) => {
                    lyricsPollInterval = setInterval(async () => {
                        lyricsPollCount++;
                        if (lyricsPollCount > maxLyricsPolls) {
                            clearInterval(lyricsPollInterval);
                            reject(new Error("Lyric generation timed out. The background job might be delayed or failed. Please check the library later."));
                            return;
                        }

                        try {
                            const statusData = await apiRequest(`/generate/lyrics-status/${songId}`, 'GET');
                            console.log(`Polling lyrics status for ${songId}:`, statusData);

                            // Update UI message based on status
                            switch(statusData.status) {
                                case 'lyrics_complete': loadingMessage.textContent = `Lyrics generated!`; break;
                                case 'lyrics_processing': loadingMessage.textContent = `Generating lyrics... (Processing)`; break;
                                case 'lyrics_pending': loadingMessage.textContent = `Generating lyrics... (Waiting for background job)`; break;
                                case 'lyrics_error': loadingMessage.textContent = `Lyrics generation failed.`; break;
                                default: loadingMessage.textContent = `Generating lyrics... (Status: ${statusData.status || 'unknown'})`;
                            }

                            if (progressContainer && generationProgress) {
                                progressContainer.style.display = 'block';
                                generationProgress.value = statusToPercent(statusData.status);
                            }

                            // Check for completion or error
                            if (statusData.status === 'lyrics_complete' && statusData.lyrics) {
                                clearInterval(lyricsPollInterval);
                                lyricsOutput.textContent = statusData.lyrics; // Display lyrics
                                resolve(statusData.lyrics); // Resolve the promise with lyrics
                            } else if (statusData.status === 'lyrics_error') {
                                clearInterval(lyricsPollInterval);
                                reject(new Error("Lyric generation failed. Please check logs or try again."));
                            }
                            // Otherwise, continue polling ('lyrics_pending' or 'lyrics_processing')

                        } catch (pollErr) {
                            console.warn(`Lyrics polling attempt ${lyricsPollCount} failed: ${pollErr.message || pollErr}.`);
                            if (pollErr.message?.includes("session has expired") || pollErr.status === 403 || pollErr.status === 404) {
                                clearInterval(lyricsPollInterval); reject(pollErr);
                            }
                        }
                    }, 10000); // Poll every 10 seconds for lyrics
                }); // End of Promise for lyrics polling

                // --- Step 3: Initiate Audio Generation (Backend sets status to audio_pending) ---
                loadingMessage.textContent = "Audio queued! It'll appear in your library shortly (1-2 minutes).";
                await apiRequest('/generate/generate-audio', 'POST', { songId });
                console.log(`Audio queued for song ${songId}.`);

                // Hide spinner & progress bar, re‑enable button
                loadingIndicator.style.display = 'none';
                if (progressContainer)    progressContainer.style.display = 'none';
                if (generationProgress)   generationProgress.value = 0;
                motivateButton.disabled = false;
                motivateButton.textContent = `MOTIVATE (1 Credit)`;

                // Switch to Library tab and refresh it
                const libTabLink = document.querySelector('a[href="#libraryTab"]');
                if (libTabLink) {
                libTabLink.click();
                loadLibrary();
                }

                // We're done here—return early so we don't hit any further code
                return;

            } catch (err) {
                // Catch errors from any step
                console.error("Error during generation process:", err);
                showApiError(generalErrorDiv, err, "Song generation failed.");
                // Clear intervals on error
                if(lyricsPollInterval) clearInterval(lyricsPollInterval);
                if(audioPollInterval) clearInterval(audioPollInterval);
                loadingIndicator.style.display = 'none';
                motivateButton.disabled = false;
                motivateButton.textContent = `MOTIVATE (${CREDITS_PER_SONG} Credit)`;
                // Attempt to fetch updated profile in case credits changed on backend before error
                fetchUserProfile();

                if (progressContainer) progressContainer.style.display = 'none';
                if (generationProgress) generationProgress.value = 0;
            }
        }); // End songForm submit listener
    } // End if(songForm)


    // --- Event Listeners Setup ---
    if(showLoginBtn && loginModalInstance) {
        showLoginBtn.addEventListener('click', () => loginModalInstance.show());
    }
    if(showSignupBtn && signupModalInstance) {
        showSignupBtn.addEventListener('click', () => signupModalInstance.show());
    }
    if(logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
    if(loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('loginEmail');
            const passwordInput = document.getElementById('loginPassword');
            if (emailInput && passwordInput) {
                 handleLogin(emailInput.value, passwordInput.value);
            }
        });
    }
    if(signupForm) {
        signupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const userInput = document.getElementById('signupUsername');
            const emailInput = document.getElementById('signupEmail');
            const passInput = document.getElementById('signupPassword');
            const confirmInput = document.getElementById('signupConfirmPassword');
            if(userInput && emailInput && passInput && confirmInput) {
                 handleSignup(userInput.value, emailInput.value, passInput.value, confirmInput.value);
            }
        });
    }

     // Listener for tab changes to reload library if needed and if library exists
     if (appTabs && libraryContent) {
         appTabs.addEventListener('shown.bs.tab', function (event) {
             if (event.target.getAttribute('href') === '#libraryTab') {
                 loadLibrary(); // Reload library when tab becomes active
             }
         });
     }

     // Event delegation for delete buttons in the library if library exists
     if (libraryContent) {
         libraryContent.addEventListener('click', function(event) {
            // Find the closest button with the delete class
            const deleteButton = event.target.closest('.btn-delete-song');
            if (deleteButton) {
                const songId = deleteButton.dataset.songId;
                 if (songId) {
                     handleDeleteSong(songId);
                 }
            }
        });
    }


    // --- Initial Load ---
    updateUIBasedOnLoginState();

}); // End DOMContentLoaded Wrapper
