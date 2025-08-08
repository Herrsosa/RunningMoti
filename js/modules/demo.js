// js/modules/demo.js
// Minimal, dependency-free demo player for the homepage demo strip.
// It swaps a short preview when you toggle "Final Sprint" and can be extended
// later to switch by BPM/Mood if you add those controls.

export class DemoPlayer {
    constructor(containerEl) {
        this.container = containerEl;
        this.audio = null;
        this.isFinalSprint = false;

        // You can change these paths to wherever you host previews
        // e.g. /public/demo-tracks/...
        this.sources = {
            base: '/demo-tracks/base-demo.mp3',
            sprint: '/demo-tracks/final-sprint-demo.mp3'
        };
    }

    init() {
        // Create audio element once
        this.audio = document.createElement('audio');
        this.audio.controls = true;
        this.audio.preload = 'auto';
        this.audio.classList.add('w-100', 'custom-audio-player');

        // Default source
        this.audio.src = this.sources.base;

        // Inject into container
        this.container.innerHTML = '';
        this.container.appendChild(this.audio);

        // If you later add BPM/Mood controls, wire them here
        // Example:
        // document.getElementById('demoBpmSlider')?.addEventListener('input', e => this.onBpmChange(e.target.value));
        // document.querySelectorAll('[data-demo-mood]').forEach(btn => btn.addEventListener('click', () => this.onMoodChange(btn.dataset.demoMood)));
    }

    toggleFinalSprint() {
        this.isFinalSprint = !this.isFinalSprint;
        const btn = document.getElementById('finalSprintToggle');
        if (btn) {
            btn.classList.toggle('active', this.isFinalSprint);
            btn.textContent = `Final Sprint Mode: ${this.isFinalSprint ? 'ON' : 'OFF'}`;
        }

        // Swap preview track
        this.audio.src = this.isFinalSprint ? this.sources.sprint : this.sources.base;
        // Auto-play after swap for a snappy demo
        this.audio.play().catch(() => {
            // Autoplay might be blocked; user will press play.
        });
    }

    // Placeholder if you later add BPM/Mood demo controls
    // onBpmChange(val) {}
    // onMoodChange(mood) {}
}
