/* extension.js — Main entry point for GNOME Recall
 *
 * A Windows 11-style clipboard history extension for GNOME Shell.
 * Press Super+V to browse, search, pin, and paste from your clipboard history.
 *
 * Compatible with GNOME 46-50 (Ubuntu 24.04 through 26.04).
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardMonitor } from './clipboard.js';
import { HistoryManager } from './historyManager.js';
import { RecallDialog } from './ui/recallDialog.js';

export default class RecallExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedIds = [];

        // Initialize clipboard monitor
        this._clipboardMonitor = new ClipboardMonitor({
            cacheDir: undefined, // uses default
        });

        // Apply settings to monitor
        this._clipboardMonitor.setPrivateMode(
            this._settings.get_boolean('private-mode')
        );
        this._clipboardMonitor.setEnableImages(
            this._settings.get_boolean('enable-images')
        );

        // Initialize history manager
        this._historyManager = new HistoryManager({
            settings: this._settings,
        });

        // Connect clipboard monitor to history manager
        this._clipboardMonitor.onChange((entry) => {
            this._historyManager.addEntry(entry);

            // Show notification if enabled
            if (this._settings.get_boolean('show-notifications')) {
                this._showNotification(entry);
            }
        });

        // Initialize the popup dialog
        this._dialog = new RecallDialog({
            historyManager: this._historyManager,
            clipboardMonitor: this._clipboardMonitor,
            settings: this._settings,
            openPreferences: () => this.openPreferences(),
        });

        // Register the keybinding
        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                this._dialog.toggle();
            }
        );

        // Watch for settings changes
        this._connectSettings();

        // Start monitoring the clipboard
        this._clipboardMonitor.start();
    }

    disable() {
        // Remove keybinding
        Main.wm.removeKeybinding('toggle-shortcut');

        // Disconnect settings
        this._disconnectSettings();

        // Stop clipboard monitor
        if (this._clipboardMonitor) {
            this._clipboardMonitor.destroy();
            this._clipboardMonitor = null;
        }

        // Destroy dialog
        if (this._dialog) {
            this._dialog.destroy();
            this._dialog = null;
        }

        // Destroy history manager
        if (this._historyManager) {
            this._historyManager.destroy();
            this._historyManager = null;
        }

        this._settings = null;
    }

    /**
     * Connect to GSettings change signals for live updates.
     */
    _connectSettings() {
        const watchKeys = [
            {
                key: 'private-mode',
                callback: () => {
                    this._clipboardMonitor.setPrivateMode(
                        this._settings.get_boolean('private-mode')
                    );
                }
            },
            {
                key: 'enable-images',
                callback: () => {
                    this._clipboardMonitor.setEnableImages(
                        this._settings.get_boolean('enable-images')
                    );
                }
            },
        ];

        for (const { key, callback } of watchKeys) {
            const id = this._settings.connect(`changed::${key}`, callback);
            this._settingsChangedIds.push(id);
        }
    }

    /**
     * Disconnect all settings change handlers.
     */
    _disconnectSettings() {
        if (this._settings && this._settingsChangedIds) {
            for (const id of this._settingsChangedIds) {
                this._settings.disconnect(id);
            }
            this._settingsChangedIds = [];
        }
    }

    /**
     * Show a brief notification when something is copied.
     */
    _showNotification(entry) {
        let text;
        if (entry.type === 'image') {
            text = 'Image copied to clipboard';
        } else if (entry.type === 'link') {
            text = 'Link copied to clipboard';
        } else if (entry.type === 'color') {
            text = `Color copied: ${entry.content.trim()}`;
        } else {
            const preview = entry.content.substring(0, 40).replace(/\s+/g, ' ');
            text = `Copied: ${preview}${entry.content.length > 40 ? '…' : ''}`;
        }

        Main.notify('Recall', text);
    }
}
