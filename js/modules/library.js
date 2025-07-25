import api from '../utils/api.js';
import { Config, Utils } from '../utils/config.js';

export class LibraryManager {
    constructor(authManager) {
        this.authManager = authManager;
        this.songs = [];
        this.exampleSongs = [
            {
                id: 'example_1',
                title: 'Running With the Pack',
                workout_input: 'Interval Training',
                style_input: 'High-Energy Electronic',
                audio_url: 'public/audio/example_song_1.mp3',
                status: 'complete',
                is_example: true
            },
            {
                id: 'example_2',
                title: 'The Final Rep',
                workout_input: 'Weightlifting',
                style_input: 'Aggressive Rock',
                audio_url: 'public/audio/example_song_2.mp3',
                status: 'complete',
                is_example: true
            },
            {
                id: 'example_3',
                title: 'Sunrise Yoga Flow',
                workout_input: 'Yoga Session',
                style_input: 'Calm Ambient',
                audio_url: 'public/audio/example_song_3.mp3',
                status: 'complete',
                is_example: true
            }
        ];
        this.autoRefreshInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderExampleSongs(); // Always render example songs on init
        
        // Listen for tab changes and generation completion
        this.setupTabListener();
        
        // Listen for auth events
        window.addEventListener('auth:login', () => {
            this.loadLibrary();
        });
        
        window.addEventListener('auth:logout', () => {
            this.clearLibrary();
        });
        
        window.addEventListener('generator:complete', () => {
            this.loadLibrary();
        });
    }

    setupEventListeners() {
        const libraryContent = document.getElementById('libraryContent');
        
        if (libraryContent) {
            // Event delegation for delete buttons
            libraryContent.addEventListener('click', (e) => {
                const deleteButton = e.target.closest('.btn-delete-song');
                if (deleteButton) {
                    const songId = deleteButton.dataset.songId;
                    if (songId) {
                        this.handleDeleteSong(songId);
                    }
                }
            });
        }
    }

    setupTabListener() {
        const appTabs = document.getElementById('appTabs');
        
        if (appTabs) {
            appTabs.addEventListener('shown.bs.tab', (event) => {
                if (event.target.getAttribute('href') === '#libraryTab') {
                    this.loadLibrary();
                    this.startAutoRefresh();
                } else {
                    this.stopAutoRefresh();
                }
            });
        }
    }

    async loadLibrary() {
        this.renderExampleSongs(); // Always render examples

        if (!this.authManager.isLoggedIn()) {
            this.clearUserLibrary(); // Clear only user-generated songs
            return;
        }

        const libraryContent = document.getElementById('libraryContent');
        const libraryLoading = document.getElementById('libraryLoading');
        const libraryEmpty = document.getElementById('libraryEmpty');
        
        if (!libraryContent || !libraryLoading || !libraryEmpty) return;

        try {
            this.showLoading(true);
            
            const songs = await api.getSongs();
            this.songs = songs || [];
            
            this.renderLibrary();
            
        } catch (error) {
            console.error('Failed to load library:', error);
            this.showError('Failed to load library. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    renderLibrary() {
        const libraryContent = document.getElementById('libraryContent');
        const libraryEmpty = document.getElementById('libraryEmpty');

        if (!libraryContent || !libraryEmpty) return;

        if (this.songs.length === 0) {
            libraryContent.innerHTML = ''; // Clear if now empty
            libraryEmpty.style.display = 'block';
            return;
        }

        libraryEmpty.style.display = 'none';

        const existingSongIds = new Set(
            [...libraryContent.querySelectorAll('.library-list-item:not(.example-song)')]
            .map(el => el.dataset.songId)
        );
        const songsToRender = new Map(this.songs.map(song => [String(song.id), song]));

        // Remove songs that are no longer in the list
        existingSongIds.forEach(id => {
            if (!songsToRender.has(id)) {
                const el = libraryContent.querySelector(`[data-song-id="${id}"]`);
                if (el) el.remove();
            }
        });

        // Add or update songs
        this.songs.forEach(song => {
            const songId = String(song.id);
            const existingEl = libraryContent.querySelector(`[data-song-id="${songId}"]`);
            if (existingEl) {
                // Song already exists, update it in place
                this.updateLibraryItem(song, existingEl);
            } else {
                // Song is new, create and append it
                const newEl = this.createLibraryItem(song);
                libraryContent.appendChild(newEl);
            }
        });
    }

    createLibraryItem(song) {
        const item = document.createElement('div');
        item.className = 'list-group-item library-list-item';
        if (song.is_example) {
            item.classList.add('example-song');
        }
        item.dataset.songId = song.id;
        this.updateLibraryItem(song, item); // Reuse updater to populate content
        return item;
    }

    updateLibraryItem(song, item) {
        const formattedDate = song.created_at
            ? new Date(song.created_at).toLocaleDateString()
            : 'N/A';

        // Check for existing elements to avoid full re-render
        let itemInfo = item.querySelector('.library-item-info');
        if (!itemInfo) {
            itemInfo = document.createElement('div');
            itemInfo.className = 'library-item-info';
            item.appendChild(itemInfo);
        }

        let itemControls = item.querySelector('.library-item-controls');
        if (!itemControls) {
            itemControls = document.createElement('div');
            itemControls.className = 'library-item-controls';
            item.appendChild(itemControls);
        }

        itemInfo.innerHTML = `
            <h5>${this.escapeHtml(song.title || 'Untitled Song')}</h5>
            <p>Workout: ${this.escapeHtml(song.workout_input || 'N/A')}<br>
            Style: ${this.escapeHtml(song.style_input || 'N/A')} | Date: ${formattedDate}</p>
        `;

        itemControls.innerHTML = ''; // Clear previous controls
        this.addStatusOrPlayer(song, itemControls);
        if (!this.isProcessing(song.status)) {
            this.addDeleteButton(song, itemControls);
        }
    }

    addStatusOrPlayer(song, container) {
        if (song.status === 'complete' && song.audio_url) {
            // Add audio player
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            audioEl.className = 'library-audio-player';
            audioEl.src = this.getAudioUrl(song.audio_url);
            container.appendChild(audioEl);
        } else {
            // Add status badge
            const statusSpan = document.createElement('span');
            statusSpan.className = `badge ${this.getStatusBadgeClass(song.status)}`;
            statusSpan.textContent = this.getStatusText(song.status);
            container.appendChild(statusSpan);
        }
    }

    addDeleteButton(song, container) {
        if (song.is_example) return; // Don't add delete button for example songs

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-sm btn-outline-danger btn-delete-song';
        deleteButton.dataset.songId = song.id;
        deleteButton.title = 'Delete Song';
        deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6Z"/>
                <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1ZM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118ZM2.5 3h11V2h-11v1Z"/>
            </svg>
        `;
        container.appendChild(deleteButton);
    }

    async handleDeleteSong(songId) {
        if (!confirm('Are you sure you want to delete this song? This cannot be undone.')) {
            return;
        }

        try {
            await api.deleteSong(songId);
            
            // Remove from local array
            this.songs = this.songs.filter(song => song.id !== songId);
            
            // Remove from UI
            const itemToRemove = document.querySelector(
                `.library-list-item[data-song-id="${songId}"]`
            );
            if (itemToRemove) {
                itemToRemove.remove();
            }

            // Check if library is now empty
            const libraryContent = document.getElementById('libraryContent');
            const libraryEmpty = document.getElementById('libraryEmpty');
            if (libraryContent && libraryEmpty && libraryContent.children.length === 0) {
                libraryEmpty.style.display = 'block';
            }

            console.log(`Song ${songId} deleted successfully`);
            
        } catch (error) {
            console.error('Failed to delete song:', error);
            this.showError('Failed to delete song. Please try again.');
        }
    }

    startAutoRefresh() {
        // Refresh library every 30 seconds if there are processing songs
        this.autoRefreshInterval = setInterval(() => {
            if (this.hasProcessingSongs()) {
                this.loadLibrary();
            }
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    hasProcessingSongs() {
        return this.songs.some(song => this.isProcessing(song.status));
    }

    isProcessing(status) {
        const processingStatuses = [
            'lyrics_pending', 
            'lyrics_processing', 
            'audio_pending', 
            'audio_processing', 
            'processing'
        ];
        return processingStatuses.includes(status);
    }

    getStatusBadgeClass(status) {
        const classMap = {
            'complete': 'bg-success',
            'processing': 'bg-secondary',
            'audio_processing': 'bg-secondary',
            'audio_pending': 'bg-secondary',
            'lyrics_complete': 'bg-primary',
            'lyrics_processing': 'bg-light text-dark',
            'lyrics_pending': 'bg-light text-dark',
            'lyrics_error': 'bg-warning text-dark',
            'error': 'bg-danger'
        };
        return classMap[status] || 'bg-secondary';
    }

    getStatusText(status) {
        const textMap = {
            'complete': 'Complete',
            'processing': 'Generating Audio...',
            'audio_processing': 'Submitting Audio Job...',
            'audio_pending': 'Audio Generation Queued...',
            'lyrics_complete': 'Lyrics Ready',
            'lyrics_processing': 'Generating Lyrics...',
            'lyrics_pending': 'Lyrics Queued...',
            'lyrics_error': 'Lyrics Error',
            'error': 'Error'
        };
        return textMap[status] || 'Unknown Status';
    }

    getAudioUrl(audioUrl) {
        // Handle different URL formats
        if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
            return audioUrl;
        }
        return audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl;
    }

    showLoading(show) {
        const libraryLoading = document.getElementById('libraryLoading');
        const libraryEmpty = document.getElementById('libraryEmpty');
        
        if (libraryLoading) {
            if (show) {
                libraryLoading.innerHTML = `
                    <div class="text-center">
                        <div class="spinner-border text-primary mb-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p>Loading your tracks...</p>
                    </div>
                `;
                libraryLoading.style.display = 'block';
            } else {
                libraryLoading.style.display = 'none';
            }
        }
        
        if (libraryEmpty && show) {
            libraryEmpty.style.display = 'none';
        }
    }

    renderExampleSongs() {
        const exampleContainer = document.getElementById('exampleSongsContainer');
        if (!exampleContainer) return;

        exampleContainer.innerHTML = ''; // Clear previous examples
        this.exampleSongs.forEach(song => {
            const item = this.createLibraryItem(song);
            exampleContainer.appendChild(item);
        });
    }

    clearUserLibrary() {
        const libraryContent = document.getElementById('libraryContent');
        if (libraryContent) {
            // Remove only non-example songs
            libraryContent.querySelectorAll('.library-list-item:not(.example-song)').forEach(el => el.remove());
        }
        this.songs = [];
    }

    clearLibrary() {
        const libraryContent = document.getElementById('libraryContent');
        const libraryLoading = document.getElementById('libraryLoading');
        const libraryEmpty = document.getElementById('libraryEmpty');
        const exampleContainer = document.getElementById('exampleSongsContainer');
        
        if (libraryContent) libraryContent.innerHTML = '';
        if (exampleContainer) exampleContainer.innerHTML = '';
        if (libraryLoading) libraryLoading.style.display = 'none';
        if (libraryEmpty) libraryEmpty.style.display = 'none';
        
        this.songs = [];
        this.stopAutoRefresh();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Public methods for external use
    refresh() {
        this.loadLibrary();
    }

    getSongs() {
        return [...this.songs]; // Return a copy
    }
}
