import api from '../utils/api.js';
import { Config, Utils } from '../utils/config.js';

export class LibraryManager {
    constructor(authManager) {
        this.authManager = authManager;
        this.songs = [];
        this.autoRefreshInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        
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
        if (!this.authManager.isLoggedIn()) {
            this.clearLibrary();
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

        libraryContent.innerHTML = '';

        if (this.songs.length === 0) {
            libraryEmpty.style.display = 'block';
            return;
        }

        libraryEmpty.style.display = 'none';
        
        this.songs.forEach(song => {
            this.renderLibraryItem(song, libraryContent);
        });
    }

    renderLibraryItem(song, container) {
        const item = document.createElement('div');
        item.className = 'list-group-item library-list-item';
        item.dataset.songId = song.id;

        const formattedDate = song.created_at 
            ? new Date(song.created_at).toLocaleDateString() 
            : 'N/A';

        // Create item info section
        const itemInfo = document.createElement('div');
        itemInfo.className = 'library-item-info';
        itemInfo.innerHTML = `
            <h5>${this.escapeHtml(song.title || 'Untitled Song')}</h5>
            <p>Workout: ${this.escapeHtml(song.workout_input || 'N/A')}<br>
            Style: ${this.escapeHtml(song.style_input || 'N/A')} | Date: ${formattedDate}</p>
        `;

        // Create controls section
        const itemControls = document.createElement('div');
        itemControls.className = 'library-item-controls';

        // Add status/player based on song status
        this.addStatusOrPlayer(song, itemControls);
        
        // Add delete button if song is not processing
        if (!this.isProcessing(song.status)) {
            this.addDeleteButton(song, itemControls);
        }

        item.appendChild(itemInfo);
        item.appendChild(itemControls);
        container.appendChild(item);
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
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-sm btn-outline-danger btn-delete-song';
        deleteButton.dataset.songId = song.id;
        deleteButton.title = 'Delete Song';
        deleteButton.textContent = '×';
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

    clearLibrary() {
        const libraryContent = document.getElementById('libraryContent');
        const libraryLoading = document.getElementById('libraryLoading');
        const libraryEmpty = document.getElementById('libraryEmpty');
        
        if (libraryContent) libraryContent.innerHTML = '';
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