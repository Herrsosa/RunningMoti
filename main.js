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

  // Generator Form Elements
  const songForm = document.getElementById('songForm');
  const nameInput = document.getElementById('nameInput');
  const workoutInput = document.getElementById('workoutInput');
  const toneButtonsContainer = document.getElementById('toneButtons');
  const musicStyleInput = document.getElementById('musicStyleInput');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const loadingMessage = document.getElementById('loadingMessage'); // Get loading message p tag
  const lyricsOutput = document.getElementById('lyricsOutput');
  const audioPlayer = document.getElementById('audioPlayer');
  const audioResultContainer = document.getElementById('audioResultContainer');
  const motivateButton = document.getElementById('motivateButton');
  const generalErrorDiv = document.getElementById('generalError');
  const workoutErrorDiv = document.getElementById('workout-error');
  const toneErrorDiv = document.getElementById('tone-error');

  // Bootstrap Modals Instances
  const loginModal = new bootstrap.Modal(loginModalEl);
  const signupModal = new bootstrap.Modal(signupModalEl);

  // --- API Endpoints ---
  const BASE_API_URL = 'http://localhost:5000/api'; // Use your backend URL

  // --- Utility Functions ---
  const updateUIBasedOnLoginState = () => {
      if (currentUser.token) {
          userInfoDiv.style.display = 'block';
          authButtonsDiv.style.display = 'none';
          appContainer.style.display = 'block'; // Show main app content
          usernameDisplay.textContent = currentUser.username || 'User';
          creditsDisplay.textContent = currentUser.credits;
          fetchUserProfile(); // Fetch latest credits/info
          loadLibrary(); // Load library when logged in
      } else {
          userInfoDiv.style.display = 'none';
          authButtonsDiv.style.display = 'block';
          appContainer.style.display = 'none'; // Hide main app content
           // Optionally force login modal if no token
           // loginModal.show();
      }
      // Reset forms and errors on state change
      loginErrorDiv.style.display = 'none';
      signupErrorDiv.style.display = 'none';
      loginForm.reset();
      signupForm.reset();
      generalErrorDiv.style.display = 'none';
      loadingIndicator.style.display = 'none';
      audioResultContainer.style.display = 'none';
  };

  const showApiError = (errorDiv, error, defaultMessage = "An error occurred.") => {
      console.error("API Error:", error);
      let message = defaultMessage;
      if (error && error.error) {
          message = error.error;
      } else if (typeof error === 'string') {
           message = error;
      } else if (error instanceof Error) {
          message = error.message;
      }
      errorDiv.textContent = message;
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
      }
      if (body) {
          options.body = JSON.stringify(body);
      }

      try {
          const response = await fetch(`${BASE_API_URL}${endpoint}`, options);
          if (!response.ok) {
              let errorData;
              try {
                   errorData = await response.json();
              } catch(e) {
                  errorData = { error: `HTTP error! status: ${response.status}` };
              }
               // Handle token expiry / unauthorized specifically
               if (response.status === 401 || response.status === 403) {
                   console.log("Auth token expired or invalid. Logging out.");
                   handleLogout();
                   throw new Error("Your session has expired. Please login again."); // Throw specific error
               }
              throw errorData; // Throw the error object from response body
          }
           // Handle potential empty responses (e.g., 204 No Content)
          if (response.status === 204) {
              return null;
          }
          return await response.json(); // Parse JSON for successful responses
      } catch (error) {
          console.error(`API Request Failed (${method} ${endpoint}):`, error);
          throw error; // Re-throw the error to be caught by the caller
      }
  };

  // --- Authentication Functions ---
  const handleLogin = async (email, password) => {
      loginErrorDiv.style.display = 'none';
      try {
          const data = await apiRequest('/auth/login', 'POST', { email, password }, false);
          currentUser.token = data.token;
          currentUser.id = data.userId;
          currentUser.username = data.username;
          currentUser.credits = data.credits;
          localStorage.setItem('authToken', data.token);
          updateUIBasedOnLoginState();
          loginModal.hide();
      } catch (error) {
          showApiError(loginErrorDiv, error, "Login failed. Please check email/password.");
      }
  };

  const handleSignup = async (username, email, password, confirmPassword) => {
      signupErrorDiv.style.display = 'none';
      if (password !== confirmPassword) {
          showApiError(signupErrorDiv, "Passwords do not match.");
          return;
      }
      try {
           const data = await apiRequest('/auth/register', 'POST', { username, email, password }, false);
           // Automatically log in after successful signup
           currentUser.token = data.token;
           currentUser.id = data.userId;
           currentUser.username = data.username;
           currentUser.credits = data.credits;
           localStorage.setItem('authToken', data.token);
           updateUIBasedOnLoginState();
           signupModal.hide();
      } catch (error) {
           showApiError(signupErrorDiv, error, "Signup failed.");
      }
  };

  const handleLogout = () => {
      currentUser.token = null;
      currentUser.id = null;
      currentUser.username = null;
      currentUser.credits = 0;
      localStorage.removeItem('authToken');
      updateUIBasedOnLoginState();
       // Clear library on logout
      libraryContent.innerHTML = '';
      libraryLoading.style.display = 'block';
      libraryEmpty.style.display = 'none';
  };

  const fetchUserProfile = async () => {
      if (!currentUser.token) return;
      try {
          const data = await apiRequest('/library/profile', 'GET');
          currentUser.username = data.username;
          currentUser.credits = data.credits;
          // Update display immediately
          usernameDisplay.textContent = currentUser.username;
          creditsDisplay.textContent = currentUser.credits;
      } catch (error) {
          console.error("Failed to fetch user profile:", error);
          // Potentially logout if profile fetch fails due to auth error
           if (error.message.includes("session has expired")) {
               // Error already handled by apiRequest logout logic
           } else {
                // showApiError(generalErrorDiv, error, "Could not load profile.");
           }
      }
  };


  // --- Library Functions ---
  const loadLibrary = async () => {
      if (!currentUser.token) return;

      libraryLoading.style.display = 'block';
      libraryEmpty.style.display = 'none';
      libraryContent.innerHTML = ''; // Clear previous items

      try {
          const songs = await apiRequest('/library/songs', 'GET');
          libraryLoading.style.display = 'none';

          if (songs && songs.length > 0) {
              songs.forEach(renderLibraryItem);
          } else {
              libraryEmpty.style.display = 'block';
          }
      } catch (error) {
          libraryLoading.style.display = 'none';
          showApiError(generalErrorDiv, error, "Failed to load library."); // Show error in general area
      }
  };

  const renderLibraryItem = (song) => {
       const item = document.createElement('div');
       item.className = 'list-group-item library-list-item';
       item.dataset.songId = song.id;

       const formattedDate = new Date(song.created_at).toLocaleDateString();

       let playerHtml = '';
       if (song.status === 'complete' && song.audio_url) {
           playerHtml = `<audio controls src="${song.audio_url}" class="library-audio-player"></audio>`;
       } else if (song.status === 'processing') {
            playerHtml = `<span class="badge bg-info text-dark">Processing...</span>`;
       } else if (song.status === 'pending') {
           playerHtml = `<span class="badge bg-secondary">Pending...</span>`;
       } else {
            playerHtml = `<span class="badge bg-danger">Error</span>`;
       }

       item.innerHTML = `
          <div class="library-item-info">
              <h5>${song.title || 'Untitled Song'}</h5>
              <p>Workout: ${song.workout_input || 'N/A'}<br>Style: ${song.style_input || 'N/A'} | Date: ${formattedDate}</p>
          </div>
          <div class="library-item-controls">
              ${playerHtml}
              <button class="btn btn-sm btn-outline-danger btn-delete-song" data-song-id="${song.id}">Delete</button>
          </div>
      `;
      libraryContent.appendChild(item);
  };

   const handleDeleteSong = async (songId) => {
      if (!confirm("Are you sure you want to delete this song?")) return;

      try {
          await apiRequest(`/library/songs/${songId}`, 'DELETE');
          // Remove item from UI
          const itemToRemove = libraryContent.querySelector(`.library-list-item[data-song-id="${songId}"]`);
          if(itemToRemove) itemToRemove.remove();
           // Check if library is now empty
           if (libraryContent.children.length === 0) {
               libraryEmpty.style.display = 'block';
           }
           // No need to reload entire library, just remove the element
      } catch (error) {
           showApiError(generalErrorDiv, error, "Failed to delete song.");
      }
  };


  // --- Generator Functions ---
  // (Button group handler - Keep as is)
  function handleButtonGroupClick(container, hiddenInput, errorDiv, groupElement) {
    container.addEventListener('click', function (e) {
      if (e.target.classList.contains('option-button')) {
        groupElement.classList.remove('is-invalid');
        if(errorDiv) errorDiv.style.display = 'none'; // Hide error on selection
        container.querySelectorAll('.option-button').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        hiddenInput.value = e.target.getAttribute('data-value');
      }
    });
  }
  handleButtonGroupClick(toneButtonsContainer, musicStyleInput, toneErrorDiv, toneButtonsContainer);

   workoutInput.addEventListener('input', () => {
     workoutInput.classList.remove('is-invalid');
     if(workoutErrorDiv) workoutErrorDiv.style.display = 'none';
   });


  // (Form Submission Handler - Modified for Auth & Credits)
  songForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!currentUser.token) {
          showApiError(generalErrorDiv, "Please login to generate songs.");
          loginModal.show();
          return;
      }

      // --- Client-side Credit Check (Basic) ---
      if (currentUser.credits < 1) { // Assuming cost is 1 credit
           showApiError(generalErrorDiv, "Insufficient credits. Please purchase more.");
           // Optional: Redirect to a purchase page/modal
           return;
      }

      // --- Validation ---
      let isValid = true;
      generalErrorDiv.style.display = 'none';
      workoutErrorDiv.style.display = 'none';
      toneErrorDiv.style.display = 'none';
      workoutInput.classList.remove('is-invalid');
      toneButtonsContainer.classList.remove('is-invalid');

      if (!workoutInput.value.trim()) {
          workoutInput.classList.add('is-invalid');
          workoutErrorDiv.style.display = 'block';
          isValid = false;
      }
      if (!musicStyleInput.value) {
          toneButtonsContainer.classList.add('is-invalid');
          toneErrorDiv.style.display = 'block';
          isValid = false;
      }
      if (!isValid) return;

      // --- If valid, proceed ---
      audioResultContainer.style.display = 'none'; // Hide previous result
      loadingIndicator.style.display = 'block';
      loadingMessage.textContent = "Checking credits..."; // Update loading message
      motivateButton.disabled = true;

      const workout = workoutInput.value.trim();
      const musicStyle = musicStyleInput.value;
      const name = nameInput.value.trim() || ''; // Send empty if not provided

      try {
          // NOTE: Backend re-checks and deducts credits before lyric generation.
          // This is more secure than relying only on the frontend check.

          // Step 1: Generate Lyrics (Backend handles credit check)
           loadingMessage.textContent = "Generating lyrics...";
          const lyricsData = await apiRequest('/generate/generate-lyrics', 'POST', { workout, musicStyle, name });
          const lyrics = lyricsData.lyrics;
          lyricsOutput.textContent = lyrics;
          console.log("Lyrics generated by backend.");

          // Step 2: Generate Audio (Backend handles credit check/deduction)
           loadingMessage.textContent = "Submitting audio generation task...";
           // Pass original inputs along with lyrics for saving to DB
          const audioSubmitData = await apiRequest('/generate/generate-audio', 'POST', { lyrics, musicStyle, workout, name });
          const songId = audioSubmitData.songId; // Get the DB song ID
          const sunoTaskId = audioSubmitData.sunoTaskId; // Get the Suno Task ID
           currentUser.credits = audioSubmitData.remainingCredits; // Update local credit count
           creditsDisplay.textContent = currentUser.credits; // Update UI

          console.log(`Audio task submitted. Song ID: ${songId}, Suno Task ID: ${sunoTaskId}`);

          // Step 3: Poll for status using Suno Task ID
          loadingMessage.textContent = "Generating audio (this may take a minute)...";
          let pollCount = 0;
          const maxPolls = 40; // Increased polling time (2 minutes)
          let audioFound = false;

          const pollInterval = setInterval(async () => {
              pollCount++;
              if (pollCount > maxPolls) {
                  clearInterval(pollInterval);
                  if (!audioFound) {
                       throw new Error("Audio generation timed out.");
                  }
                  return;
              }

               // console.log(`Polling status for Task ${sunoTaskId} (Attempt ${pollCount})...`);
              try {
                  const statusData = await apiRequest(`/generate/song-status/${sunoTaskId}`, 'GET');
                  // console.log("Poll status response:", statusData);

                  if (statusData.status === 'complete' && statusData.audioUrl) {
                      audioFound = true;
                      clearInterval(pollInterval);
                      console.log("Audio processing complete. URL:", statusData.audioUrl);

                      audioPlayer.src = statusData.audioUrl;
                      audioResultContainer.style.display = 'block';
                      loadingIndicator.style.display = 'none';
                      motivateButton.disabled = false;
                      audioResultContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                       // Reload library to show the new completed song
                       if (document.getElementById('libraryTab').classList.contains('active')) {
                           loadLibrary();
                       }

                  } else if (statusData.status === 'error') {
                       audioFound = true; // Consider it 'found' to stop timeout error
                       clearInterval(pollInterval);
                       throw new Error(statusData.error || "Audio generation failed during processing.");
                  } else if (statusData.status === 'processing' || statusData.status === 'pending') {
                      // Still processing, continue polling
                       loadingMessage.textContent = `Generating audio... (Attempt ${pollCount}/${maxPolls})`;
                  } else {
                      // Unknown status, stop polling to prevent infinite loops
                       console.warn("Unknown song status received:", statusData);
                       // clearInterval(pollInterval);
                       // throw new Error("Received unknown status during polling.");
                       // Let it continue polling for now, maybe it will resolve
                  }
              } catch (pollErr) {
                  // If polling fails (e.g., 404 before callback), keep polling unless it's auth error
                   if (pollErr.message.includes("session has expired")) {
                       clearInterval(pollInterval); // Stop polling if logged out
                       throw pollErr; // Re-throw auth error
                   }
                   console.warn("Polling attempt failed:", pollErr.message);
                   // Don't stop polling on transient errors
              }
          }, 3000); // Poll every 3 seconds

      } catch (err) {
          console.error("Error during generation process:", err);
          showApiError(generalErrorDiv, err, "Song generation failed.");
          loadingIndicator.style.display = 'none';
          motivateButton.disabled = false;
           // Attempt to fetch updated profile in case credits changed on backend before error
           fetchUserProfile();
      }
  });


  // --- Event Listeners ---
  showLoginBtn.addEventListener('click', () => loginModal.show());
  showSignupBtn.addEventListener('click', () => signupModal.show());
  logoutButton.addEventListener('click', handleLogout);

  loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      handleLogin(email, password);
  });

  signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('signupUsername').value;
      const email = document.getElementById('signupEmail').value;
      const password = document.getElementById('signupPassword').value;
      const confirmPassword = document.getElementById('signupConfirmPassword').value;
      handleSignup(username, email, password, confirmPassword);
  });

   // Listener for tab changes to reload library if needed
   appTabs.addEventListener('shown.bs.tab', function (event) {
       if (event.target.getAttribute('href') === '#libraryTab') {
           loadLibrary(); // Reload library when tab becomes active
       }
   });

   // Event delegation for delete buttons in the library
   libraryContent.addEventListener('click', function(event) {
      if (event.target.classList.contains('btn-delete-song')) {
          const songId = event.target.dataset.songId;
          handleDeleteSong(songId);
      }
  });


  // --- Initial Load ---
  updateUIBasedOnLoginState();

}); // End DOMContentLoaded