const STORAGE_KEY = 'preferred-appearance';
const ATTRIBUTE_NAME = 'data-appearance';
const DAY_MODE = 'day';
const NIGHT_MODE = 'night';

class AppearanceController {
    constructor() {
        this.toggleButton = document.getElementById('appearance-switcher');
        this.currentMode = this.retrieveStoredMode();
        this.initialize();
    }

    initialize() {
        this.applyMode(this.currentMode);
        this.attachEventHandlers();
    }

    retrieveStoredMode() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === NIGHT_MODE || stored === DAY_MODE) {
            return stored;
        }
        return this.detectSystemPreference();
    }

    detectSystemPreference() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
        return prefersDark.matches ? NIGHT_MODE : DAY_MODE;
    }

    applyMode(mode) {
        document.documentElement.setAttribute(ATTRIBUTE_NAME, mode);
        this.currentMode = mode;
    }

    savePreference(mode) {
        localStorage.setItem(STORAGE_KEY, mode);
    }

    switchMode() {
        const newMode = this.currentMode === DAY_MODE ? NIGHT_MODE : DAY_MODE;
        this.applyMode(newMode);
        this.savePreference(newMode);
    }

    attachEventHandlers() {
        this.toggleButton.addEventListener('click', () => {
            this.switchMode();
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
            if (!localStorage.getItem(STORAGE_KEY)) {
                this.applyMode(event.matches ? NIGHT_MODE : DAY_MODE);
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AppearanceController();
});
