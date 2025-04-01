document.addEventListener('DOMContentLoaded', function () {
    // --- Get references to elements ---
    const form = document.getElementById('songForm');
    const nameInput = document.getElementById('nameInput');
    const workoutInput = document.getElementById('workoutInput'); // Now the text input
    const toneButtonsContainer = document.getElementById('toneButtons');
    const musicStyleInput = document.getElementById('musicStyleInput'); // Hidden input for style
    const loadingIndicator = document.getElementById('loadingIndicator');
    const lyricsOutput = document.getElementById('lyricsOutput');
    const audioPlayer = document.getElementById('audioPlayer');
    const audioResultContainer = document.getElementById('audioResultContainer');
    const motivateButton = document.getElementById('motivateButton');
    const generalErrorDiv = document.getElementById('generalError');
    const workoutErrorDiv = document.getElementById('workout-error');
    const toneErrorDiv = document.getElementById('tone-error');
  
    // --- Function to handle button group clicks ---
    function handleButtonGroupClick(container, hiddenInput, errorDiv, groupElement) {
      container.addEventListener('click', function (e) {
        if (e.target.classList.contains('option-button')) {
          // Clear validation state on click
          groupElement.classList.remove('is-invalid');
          errorDiv.style.display = 'none';
  
          container.querySelectorAll('.option-button').forEach(btn => {
            btn.classList.remove('active');
          });
          e.target.classList.add('active');
          hiddenInput.value = e.target.getAttribute('data-value');
          console.log(`${hiddenInput.name} selected: ${hiddenInput.value}`);
        }
      });
    }
  
    // --- Setup button group listener for TONE only ---
    handleButtonGroupClick(toneButtonsContainer, musicStyleInput, toneErrorDiv, toneButtonsContainer);
  
    // --- Clear validation on text input change ---
     workoutInput.addEventListener('input', () => {
         workoutInput.classList.remove('is-invalid');
         workoutErrorDiv.style.display = 'none';
     });
  
  
    // --- Form Submission Logic ---
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
  
      // --- Custom Validation ---
      let isValid = true;
      generalErrorDiv.style.display = 'none'; // Hide general error first
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
          // Add error indication to the button group visually
          toneButtonsContainer.classList.add('is-invalid');
          toneErrorDiv.style.display = 'block';
          isValid = false;
      }
  
      if (!isValid) {
          return; // Stop submission if validation fails
      }
  
      // --- If valid, proceed ---
      // Clear previous output & hide results
      lyricsOutput.textContent = '';
      lyricsOutput.closest('details')?.removeAttribute('open'); // Close details if open
      audioPlayer.src = '';
      audioResultContainer.style.display = 'none';
      loadingIndicator.style.display = 'block'; // Show loading
      motivateButton.disabled = true; // Disable button
  
      // Get input values
      const workout = workoutInput.value.trim(); // Get from text input
      const musicStyle = musicStyleInput.value; // Get from hidden input populated by buttons
      const name = nameInput.value.trim() || 'Athlete'; // Use 'Athlete' or similar default
  
      // Use BACKEND_API_ENDPOINT from config.js
      const lyricsEndpoint = `${BACKEND_API_ENDPOINT}/generate-lyrics`;
      const audioEndpoint = `${BACKEND_API_ENDPOINT}/generate-audio`;
      const pollEndpoint = `${BACKEND_API_ENDPOINT}/latest-audio`;
  
  
      try {
        // Step 1: Generate lyrics via backend
        console.log("Requesting lyrics for:", { workout, musicStyle, name });
        const lyricsResponse = await fetch(lyricsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workout, musicStyle, name })
        });
        if (!lyricsResponse.ok) {
            const errorData = await lyricsResponse.json();
            throw new Error(`Lyrics generation failed: ${errorData.error || lyricsResponse.statusText}`);
        }
        const { lyrics } = await lyricsResponse.json();
        lyricsOutput.textContent = lyrics; // Populate lyrics area (it's inside hidden <details>)
        console.log("Lyrics generated.");
  
  
        // Step 2: Request audio generation via backend
        console.log("Requesting audio generation...");
        const audioResponse = await fetch(audioEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lyrics, musicStyle }) // Pass generated lyrics and selected style
        });
         if (!audioResponse.ok) {
            const errorData = await audioResponse.json();
            throw new Error(`Audio task submission failed: ${errorData.error || audioResponse.statusText}`);
        }
        const audioData = await audioResponse.json();
        console.log("Audio generation task submitted:", audioData);
  
        // Step 3: Start polling for the audio URL
        let pollCount = 0;
        const maxPolls = 30; // Poll for max 90 seconds (30 * 3s) - Suno can take time
        let audioFound = false; // Flag to check if audio was ever found
  
        const pollInterval = setInterval(async () => {
          pollCount++;
          if (pollCount > maxPolls) {
              clearInterval(pollInterval);
              if (!audioFound) { // Only throw timeout if audio never arrived
                 throw new Error("Audio generation timed out. Please try again.");
              }
              return; // Exit polling if max attempts reached but audio was found earlier
          }
  
          console.log(`Polling for audio URL (Attempt ${pollCount})...`);
          try {
              const pollResponse = await fetch(pollEndpoint);
               if (!pollResponse.ok) {
                   // Log non-critical polling errors but continue
                   console.warn(`Polling request failed: ${pollResponse.status}. Continuing poll.`);
                   return;
               }
              const pollData = await pollResponse.json();
              // console.log("Poll response:", pollData); // Can be verbose
  
              if (pollData.audioUrl) {
                audioFound = true; // Set flag
                clearInterval(pollInterval);
                console.log("Audio URL received:", pollData.audioUrl);
  
                audioPlayer.src = pollData.audioUrl;
                audioResultContainer.style.display = 'block'; // Show results section
  
                loadingIndicator.style.display = 'none'; // Hide loading
                motivateButton.disabled = false; // Re-enable button
  
                // Optional: Scroll to the results
                audioResultContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
              } else {
                  // Optional: Update loading text? e.g., "Still generating..."
              }
           } catch (pollErr) {
               console.error("Error during polling fetch:", pollErr.message);
               // Don't stop polling on intermittent fetch errors, but log them
           }
        }, 3000); // poll every 3 seconds
  
      } catch (err) {
        console.error("Error in generation process:", err);
        generalErrorDiv.textContent = `Error: ${err.message}`; // Show specific error
        generalErrorDiv.style.display = 'block';
        loadingIndicator.style.display = 'none'; // Hide loading on error
        motivateButton.disabled = false; // Re-enable button on error
      }
    });
  });