import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardMonitor } from './clipboard.js';
import { HistoryManager } from './historyManager.js';
import { RecallDialog } from './ui/recallDialog.js';

//main entry point, just wires the clipboard monitor, history and popup together

export default class RecallExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedIds = [];

        //watches the clipboard and gives us entries when something new gets copied
        this._clipboardMonitor = new ClipboardMonitor({
            cacheDir: undefined,
        });

        this._clipboardMonitor.setPrivateMode(
            this._settings.get_boolean('private-mode')
        );
        this._clipboardMonitor.setEnableImages(
            this._settings.get_boolean('enable-images')
        );

        //stores everything on disk and handles pinning, limits, search etc
        this._historyManager = new HistoryManager({
            settings: this._settings,
        });

        //every copy goes straight into history
        this._clipboardMonitor.onChange((entry) => {
            this._historyManager.addEntry(entry);

            if (this._settings.get_boolean('show-notifications')) {
                this._showNotification(entry);
            }
        });

        this._dialog = new RecallDialog({
            historyManager: this._historyManager,
            clipboardMonitor: this._clipboardMonitor,
            settings: this._settings,
            openPreferences: () => this.openPreferences(),
        });

        //super+v by default, mutter rebinds it by itself if the setting changes
        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                this._dialog.toggle();
            }
        );

        this._connectSettings();

        this._clipboardMonitor.start();
    }

    //gnome requires everything we created to be torn down here
    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');

        this._disconnectSettings();

        if (this._clipboardMonitor) {
            this._clipboardMonitor.destroy();
            this._clipboardMonitor = null;
        }

        if (this._dialog) {
            this._dialog.destroy();
            this._dialog = null;
        }

        if (this._historyManager) {
            this._historyManager.destroy();
            this._historyManager = null;
        }

        this._settings = null;
    }

    //these two need to reach the monitor live, the rest are read when the popup opens
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

    _disconnectSettings() {
        if (this._settings && this._settingsChangedIds) {
            for (const id of this._settingsChangedIds) {
                this._settings.disconnect(id);
            }
            this._settingsChangedIds = [];
        }
    }

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
