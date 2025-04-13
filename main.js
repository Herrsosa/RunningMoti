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
        if (!userInfoDiv || !authButtonsDiv || !appContainer || !usernameDisplay || !creditsDisplay) {
            console.error("Core UI elements not found. Check HTML IDs.");
            return; // Prevent errors if elements are missing
        }

        if (currentUser.token) {
            userInfoDiv.style.display = 'block';
            authButtonsDiv.style.display = 'none';
            appContainer.style.display = 'block';
            if(loggedOutCTA) loggedOutCTA.style.display = 'none'; // Hide CTA when logged in

            usernameDisplay.textContent = currentUser.username || 'User';
            creditsDisplay.textContent = currentUser.credits;
            fetchUserProfile(); // Fetch latest credits/info
            // Only load library if library elements exist
            if(libraryContent) {
                loadLibrary();
            }
        } else {
            userInfoDiv.style.display = 'none';
            authButtonsDiv.style.display = 'block';
            appContainer.style.display = 'none';
            if(loggedOutCTA) loggedOutCTA.style.display = 'block'; // Show CTA when logged out

            // Clear library if elements exist
             if(libraryContent && libraryLoading && libraryEmpty) {
                libraryContent.innerHTML = '';
                libraryLoading.style.display = 'block';
                libraryEmpty.style.display = 'none';
             }
        }
        // Reset forms and errors
        if(loginErrorDiv) loginErrorDiv.style.display = 'none';
        if(signupErrorDiv) signupErrorDiv.style.display = 'none';
        if(loginForm) loginForm.reset();
        if(signupForm) signupForm.reset();
        if(generalErrorDiv) generalErrorDiv.style.display = 'none';
        if(loadingIndicator) loadingIndicator.style.display = 'none';
        if(audioResultContainer) audioResultContainer.style.display = 'none';
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
                    ? `<audio controls src="${song.audio_url}" class="library-audio-player"></audio>`
                    : `<span class="badge bg-success">Complete (Processing Audio URL...)</span>`; // Or show warning if URL missing unexpectedly
                 break;
             case 'processing':
                 statusOrPlayerHtml = `<span class="badge bg-info text-dark">Generating Audio...</span>`;
                 break;
             case 'pending': // Now means audio generation pending (after lyrics complete)
                 statusOrPlayerHtml = `<span class="badge bg-secondary">Audio Pending...</span>`;
                 break;
             case 'lyrics_complete': // New status: Lyrics done, ready for audio
                 statusOrPlayerHtml = `<span class="badge bg-primary">Lyrics Ready</span>`;
                 break;
             case 'lyrics_pending': // New status: Waiting for lyrics
                 statusOrPlayerHtml = `<span class="badge bg-light text-dark">Generating Lyrics...</span>`;
                 break;
             case 'lyrics_error': // New status: Error during lyrics
                 statusOrPlayerHtml = `<span class="badge bg-warning text-dark">Lyrics Error</span>`;
                 break;
             case 'error': // General audio error
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
                ${song.status !== 'processing' && song.status !== 'pending' && song.status !== 'lyrics_pending' ? // Only show delete for final/error states
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

    // Text input validation clear
    if(workoutInput && workoutErrorDiv) {
        workoutInput.addEventListener('input', () => {
           workoutInput.classList.remove('is-invalid');
           workoutErrorDiv.style.display = 'none';
        });
    }


    // Generator Form Submission Handler - REFACTORED for Async Lyrics
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
            if (!musicStyleInput.value) {
                if(toneButtonsContainer) toneButtonsContainer.classList.add('is-invalid');
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
            const musicStyle = musicStyleInput.value;
            const name = nameInput ? nameInput.value.trim() : ''; // Handle optional name input

            let pollInterval; // Declare interval variable in wider scope
            let lyrics; // Declare lyrics variable in wider scope
            let songId; // Store the song ID

            try {
                // --- Step 1: Initiate Lyric Generation (Async Backend) ---
                loadingMessage.textContent = "Initiating lyric generation...";
                // This endpoint now just creates the DB record and returns the ID
                const initiateLyricsResponse = await apiRequest('/generate/generate-lyrics', 'POST', { workout, musicStyle, name });
                songId = initiateLyricsResponse.songId; // Get the song ID
                console.log(`Lyric generation initiated for song ID: ${songId}`);

                // --- Step 2: Process Lyrics (Call the new endpoint) ---
                loadingMessage.textContent = "Generating lyrics (this may take a moment)...";
                // This endpoint actually calls OpenAI and waits, then returns lyrics
                const processLyricsResponse = await apiRequest(`/generate/process-lyrics/${songId}`, 'POST'); // Send POST to trigger processing
                lyrics = processLyricsResponse.lyrics; // Get the actual lyrics
                lyricsOutput.textContent = lyrics; // Display lyrics
                console.log(`Lyrics received for song ID: ${songId}`);

                // --- Step 3: Generate Audio (using received lyrics and songId) ---
                // NOTE: Backend /generate-audio needs adjustment to UPDATE the existing song record (identified by songId)
                // instead of creating a new one. It should also handle credit deduction there.
                // Assuming backend is adjusted to accept songId and update.
                loadingMessage.textContent = "Submitting audio generation task...";
                const audioSubmitPayload = {
                    songId: songId, // Pass the existing song ID
                    lyrics: lyrics,
                    musicStyle: musicStyle,
                    workout: workout,
                    name: name
                };
                const audioSubmitData = await apiRequest('/generate/generate-audio', 'POST', audioSubmitPayload);

                // Update credits based on response from /generate-audio
                currentUser.credits = audioSubmitData.remainingCredits;
                if(creditsDisplay) creditsDisplay.textContent = currentUser.credits;

                const sunoTaskId = audioSubmitData.sunoTaskId; // Get task ID from response

                if (!sunoTaskId) {
                     // Handle cases where Suno submission timed out on backend but we got a 2xx response
                     console.warn(`Audio generation submitted for song ${songId}, but Suno Task ID not immediately available. Relying on callback.`);
                     loadingMessage.textContent = "Audio generation pending confirmation...";
                     // Stop loading indicator, show info message
                     motivateButton.disabled = false;
                     motivateButton.textContent = `MOTIVATE (${CREDITS_PER_SONG} Credit)`;
                     loadingIndicator.style.display = 'none';
                     showApiError(generalErrorDiv, "Audio generation started. Please check your library shortly for the result.", "Info");
                     generalErrorDiv.classList.remove('alert-danger'); // Style as info
                     generalErrorDiv.classList.add('alert-info');
                     return; // Exit the function, polling won't work without task ID
                }

                console.log(`Audio task submitted. Song ID: ${songId}, Suno Task ID: ${sunoTaskId}`);

                // --- Step 4: Poll for audio status using Suno Task ID ---
                loadingMessage.textContent = "Generating audio (this may take a minute)...";
                let pollCount = 0;
                const maxPolls = 45; // Poll for ~2.25 minutes
                let audioFound = false;

                pollInterval = setInterval(async () => {
                    pollCount++;
                    if (pollCount > maxPolls) {
                        clearInterval(pollInterval);
                        if (!audioFound) {
                             throw new Error("Audio generation timed out. Please check your library later.");
                        }
                        return; // Exit polling
                    }

                    try {
                        // Poll specific endpoint
                        const statusData = await apiRequest(`/generate/song-status/${sunoTaskId}`, 'GET'); // Requires auth

                        if (statusData.status === 'complete' && statusData.audioUrl) {
                            audioFound = true;
                            clearInterval(pollInterval);
                            console.log("Audio processing complete. URL:", statusData.audioUrl);

                            audioPlayer.src = statusData.audioUrl;
                            audioResultContainer.style.display = 'block';
                            loadingIndicator.style.display = 'none';
                            motivateButton.disabled = false;
                            motivateButton.textContent = `MOTIVATE (${CREDITS_PER_SONG} Credit)`; // Reset button text
                            audioResultContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

                             // Reload library IF the library tab is currently active
                            const libraryTabLink = document.querySelector('a[href="#libraryTab"]');
                            if (libraryTabLink && libraryTabLink.classList.contains('active')) {
                                loadLibrary();
                            }

                        } else if (statusData.status === 'error') {
                             audioFound = true; // Consider error as 'found' to stop timeout message
                             clearInterval(pollInterval);
                             // Use error message from backend if available
                             throw new Error(statusData.error || "Audio generation failed during processing.");

                        } else if (statusData.status === 'processing' || statusData.status === 'pending') {
                            // Still processing, update message and continue polling
                            loadingMessage.textContent = `Generating audio... (${Math.round((pollCount/maxPolls)*100)}%)`;
                        } else if (statusData.status === 'not_found') {
                             console.warn(`Polling: Song status not found for task ${sunoTaskId}. Might be too early or an issue.`);
                             loadingMessage.textContent = `Generation initiated... waiting for status update...`;
                        } else {
                            // Unknown status - log but keep polling for a bit
                             console.warn("Unknown song status received:", statusData);
                             loadingMessage.textContent = `Waiting for status... (${pollCount}/${maxPolls})`;
                        }
                    } catch (pollErr) {
                        // Handle errors during the polling request itself
                        if (pollErr.message?.includes("session has expired")) { // Check error message safely
                             // If token expires during polling, stop polling and let error bubble up
                             clearInterval(pollInterval);
                             throw pollErr; // Re-throw auth error
                        }
                        // Log other polling errors but continue polling unless max attempts reached
                        console.warn(`Polling attempt ${pollCount} failed: ${pollErr.message || pollErr}. Continuing poll...`);
                    }
                }, 3000); // Poll every 3 seconds

            } catch (err) {
                // Catch errors from any step: initiate lyrics, process lyrics, submit audio, or polling timeout/failure
                console.error("Error during generation process:", err);
                showApiError(generalErrorDiv, err, "Song generation failed."); // Show user-friendly error
                if(pollInterval) clearInterval(pollInterval); // Ensure polling stops on error
                loadingIndicator.style.display = 'none';
                motivateButton.disabled = false;
                motivateButton.textContent = `MOTIVATE (${CREDITS_PER_SONG} Credit)`; // Reset button text
                // Attempt to fetch updated profile in case credits changed on backend before error
                fetchUserProfile();
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
